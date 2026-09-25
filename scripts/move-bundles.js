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
const targetRoot = path.join(rootDir, 'src-tauri', 'target');

function platformForTargetDir(name) {
  if (name.includes('windows')) return 'windows';
  if (name.includes('darwin')) return 'macos';
  if (name.includes('linux')) return 'linux';
  return null;
}

const bundleRoots = [];
for (const entry of fs.existsSync(targetRoot)
  ? fs.readdirSync(targetRoot, { withFileTypes: true })
  : []) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(targetRoot, entry.name, 'release', 'bundle');
  const platform = entry.name === 'release'
    ? 'windows'
    : platformForTargetDir(entry.name);
  if (platform && fs.existsSync(dir)) {
    bundleRoots.push({ dir, platform });
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
    files.push({ path: f, platform: root.platform });
  }
}

if (files.length === 0) {
  console.log('[move-bundles] 未检测到新生成的构建产物，跳过');
  process.exit(0);
}

// 归档命名对齐移动端/腕上端标准：弦予音乐v<版本>-Desktop-<架构>.<扩展名>
// 版本号以 version.ts 为唯一源头（构建前 sync-version 已同步到各处）；
// 架构从 Tauri 产物名提取（如 弦予音乐_2.0.4_x64-setup.exe → X64），
// 识别不出架构时兜底旧规则（exe 用 -Setup 后缀，其余直接用扩展名）。
function readAppVersion() {
  const content = fs.readFileSync(path.join(rootDir, 'version.ts'), 'utf8');
  const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function detectArch(originalName) {
  const m = originalName.match(/_(x64|x86|aarch64|arm64)(?:_|-|\.|$)/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  if (raw === 'x64') return 'X64';
  if (raw === 'x86') return 'X86';
  return 'ARM64'; // aarch64 / arm64
}

function archiveName(originalName, platform) {
  const ext = path.extname(originalName).toLowerCase();
  const version = readAppVersion();
  if (!version) return originalName; // 兜底：读不到版本号就保留原名
  const platformLabel = platform === 'macos' ? 'MacOS' : platform === 'linux' ? 'Linux' : 'Desktop';
  const arch = detectArch(originalName);
  if (!arch) {
    const suffix = platform === 'windows' && ext === '.exe' ? '-Setup' : '';
    return `弦予音乐v${version}-${platformLabel}${suffix}${ext}`;
  }
  return `弦予音乐v${version}-${platformLabel}-${arch}${ext}`;
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
