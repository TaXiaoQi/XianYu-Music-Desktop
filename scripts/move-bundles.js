/**
 * 构建后脚本 —— 将 Tauri 构建产物移动到根目录的 releases/windows/ 文件夹
 *
 * 触发条件：
 *   1. 通过 npm posttauri 钩子运行（npm run tauri build / npm run tauri dev 后均会触发）
 *   2. 仅当检测到近 30 分钟内新生成的安装包时执行移动（区分 build 与 dev）
 *   3. 当 BUILD_RELEASES_MODE 环境变量为 true 时跳过（避免与 build-releases.js 冲突）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 如果是 build-releases.js 触发的构建，跳过（它有自己的复制逻辑）
if (process.env.BUILD_RELEASES_MODE === 'true') {
  process.exit(0);
}

// 收集所有 bundle 根目录：宿主 target/release/bundle + 交叉编译 target/<triple>/release/bundle。
// 交叉目标按 triple 归档到对应平台目录（如 aarch64-pc-windows-msvc → releases/windows）。
// 设置了 CARGO_TARGET_DIR 时（如 WSL 构建转发），扫描该目录下 release/bundle 与各
// triple 子目录（交叉编译产物在 <target>/<triple>/release/bundle），平台按产物扩展名识别
// （deb/rpm/appimage → linux，dmg/app → macos，exe/msi → windows）。
const envTargetDir = process.env.CARGO_TARGET_DIR ? path.resolve(process.env.CARGO_TARGET_DIR) : null;
const targetRoot = envTargetDir ?? path.join(rootDir, 'src-tauri', 'target');

function platformForTargetDir(name) {
  if (name.includes('windows')) return 'windows';
  if (name.includes('darwin')) return 'macos';
  if (name.includes('linux')) return 'linux';
  return null;
}

function platformForBundleFile(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.deb':
    case '.rpm':
    case '.appimage':
      return 'linux';
    case '.dmg':
    case '.app':
      return 'macos';
    case '.exe':
    case '.msi':
      return 'windows';
    default:
      return null;
  }
}

const bundleRoots = [];
if (envTargetDir) {
  for (const entry of fs.existsSync(envTargetDir)
    ? fs.readdirSync(envTargetDir, { withFileTypes: true })
    : []) {
    if (!entry.isDirectory()) continue;
    // release 是宿主原生目录，其余按 triple 命名（交叉编译目标）
    const dir = entry.name === 'release'
      ? path.join(envTargetDir, 'release', 'bundle')
      : path.join(envTargetDir, entry.name, 'release', 'bundle');
    if (fs.existsSync(dir)) {
      bundleRoots.push({ dir, platform: 'auto' });
    }
  }
} else {
  for (const entry of fs.existsSync(targetRoot)
    ? fs.readdirSync(targetRoot, { withFileTypes: true })
    : []) {
    if (!entry.isDirectory()) continue;
    // 宿主原生目录是 target/release/bundle，交叉目标是 target/<triple>/release/bundle
    const dir = entry.name === 'release'
      ? path.join(targetRoot, 'release', 'bundle')
      : path.join(targetRoot, entry.name, 'release', 'bundle');
    const platform = entry.name === 'release'
      ? 'windows'
      : platformForTargetDir(entry.name);
    if (platform && fs.existsSync(dir)) {
      bundleRoots.push({ dir, platform });
    }
  }
}

// 检查是否存在 bundle 目录
if (bundleRoots.length === 0) {
  process.exit(0);
}

// 安装包文件扩展名
const BUNDLE_EXTENSIONS = /\.(exe|msi|appimage|deb|rpm|dmg|app)$/i;

// 仅移动最近 30 分钟内修改过的文件，避免在 `tauri dev` 退出后误移旧产物
const FRESH_THRESHOLD_MS = 30 * 60 * 1000;
const now = Date.now();

// 递归收集所有新鲜的安装包文件
function collectFreshBundles(srcDir, files) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      collectFreshBundles(srcPath, files);
    } else if (BUNDLE_EXTENSIONS.test(entry.name)) {
      try {
        const stat = fs.statSync(srcPath);
        if (now - stat.mtimeMs <= FRESH_THRESHOLD_MS) {
          files.push(srcPath);
        }
      } catch { /* ignore stat errors */ }
    }
  }
}

const files = [];
for (const root of bundleRoots) {
  const found = [];
  collectFreshBundles(root.dir, found);
  for (const f of found) {
    const platform = root.platform === 'auto' ? platformForBundleFile(f) : root.platform;
    if (platform) {
      files.push({ path: f, platform });
    }
  }
}

if (files.length === 0) {
  console.log('[move-bundles] 未检测到新生成的构建产物，跳过');
  process.exit(0);
}

// 归档命名三端（Windows/macOS/Linux）统一标准：弦予音乐v<版本>-Desktop-<架构>.<扩展名>
// 版本号以 version.ts 为唯一源头（构建前 sync-version 已同步到各处）；
// 架构从 Tauri 产物名提取（如 弦予音乐_2.0.4_x64-setup.exe → X64、弦予音乐_2.0.5_amd64.deb → X64、
// 弦予音乐_2.0.5_aarch64.dmg → ARM64），识别不出架构时兜底旧规则
// （exe 用 -Setup 后缀，其余直接用扩展名）。
function readAppVersion() {
  const content = fs.readFileSync(path.join(rootDir, 'version.ts'), 'utf8');
  const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

// 各平台产物名的架构段写法不一：Windows/macOS 用 x64/aarch64，
// Linux（deb/rpm/AppImage）用 amd64/x86_64/aarch64，rpm 还用点分隔（xianyu-2.0.5.x86_64.rpm）。
function detectArch(originalName) {
  const m = originalName.match(/[._-](x86_64|x64|amd64|x86|aarch64|arm64)(?:[._-]|$)/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  if (raw === 'x86') return 'X86';
  if (raw === 'aarch64' || raw === 'arm64') return 'ARM64';
  return 'X64'; // x64 / amd64 / x86_64
}

function archiveName(originalName, platform) {
  // 保留原始扩展名大小写：AppImage 桌面集成按大写 .AppImage 识别，其余扩展名本身即小写
  const ext = path.extname(originalName);
  const version = readAppVersion();
  if (!version) return originalName; // 兜底：读不到版本号就保留原名
  const arch = detectArch(originalName);
  if (!arch) {
    const suffix = platform === 'windows' && ext === '.exe' ? '-Setup' : '';
    return `弦予音乐v${version}-Desktop${suffix}${ext}`;
  }
  return `弦予音乐v${version}-Desktop-${arch}${ext}`;
}

console.log('[move-bundles] 正在移动构建产物到 releases/ ...');
for (const { path: file, platform } of files) {
  const fileName = path.basename(file);
  const destName = archiveName(fileName, platform);
  const releasesDir = path.join(rootDir, 'releases', platform);
  if (!fs.existsSync(releasesDir)) {
    fs.mkdirSync(releasesDir, { recursive: true });
  }
  const destPath = path.join(releasesDir, destName);
  // 优先使用 rename（同盘原子操作），失败则回退到复制+删除
  try {
    fs.renameSync(file, destPath);
  } catch {
    fs.copyFileSync(file, destPath);
    fs.rmSync(file, { force: true });
  }
  console.log(destName === fileName
    ? `[move-bundles] 已移动: ${fileName}`
    : `[move-bundles] 已归档: ${fileName} -> ${destName}`);
}

// 清理 bundle 目录下剩余的空文件夹（msi/wix 等）
function cleanupEmptyDirs(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subDir = path.join(dir, entry.name);
      cleanupEmptyDirs(subDir);
      try {
        fs.rmdirSync(subDir);
      } catch { /* 非空目录保留 */ }
    }
  }
}
for (const root of bundleRoots) {
  cleanupEmptyDirs(root.dir);
}

console.log(`[move-bundles] 完成，共移动 ${files.length} 个文件到 releases/`);
