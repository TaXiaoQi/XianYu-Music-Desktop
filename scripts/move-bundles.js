/**
 * 构建后脚本 —— 将 Tauri 构建产物移动到根目录的 releases/<平台>/ 文件夹
 *
 * 触发方式：
 *   1. npm posttauri 钩子（npm run tauri build / npm run tauri dev 后均会触发）
 *   2. 各构建脚本显式调用：node scripts/move-bundles.js --force
 *
 * 归档意图：
 *   - 传入 --force 时，无条件归档 bundle 目录下的所有安装包（构建脚本用此模式）。
 *   - 未传 --force 时（posttauri 钩子），仅归档近 30 分钟内生成的产物，
 *     以避免 `tauri dev` 退出时误移旧产物；一旦跳过会打印发现的文件、修改时间与原因。
 *
 * 其他约定：
 *   - BUILD_RELEASES_MODE 为 true 时跳过（避免与 build-releases.js 冲突）。
 *   - 归档前清理“同版本、同平台、旧命名”的归档（如旧的 -Setup 变体），避免用户误取旧包。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 显式归档意图：构建脚本传入 --force 表示“本次确实完成了构建，无条件归档”。
const force = process.argv.includes('--force');

// 如果是 build-releases.js 触发的构建，跳过（它有自己的复制逻辑）
if (process.env.BUILD_RELEASES_MODE === 'true') {
  console.log('[move-bundles] BUILD_RELEASES_MODE=true，跳过归档');
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
  // 宿主产物在 target/release/bundle；交叉编译产物在 target/<triple>/release/bundle
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

// 检查是否存在 bundle 目录
if (bundleRoots.length === 0) {
  console.log('[move-bundles] 未发现任何 bundle 目录（src-tauri/target[/*]/release/bundle），跳过');
  process.exit(0);
}

// 安装包文件扩展名
const BUNDLE_EXTENSIONS = /\.(exe|msi|appimage|deb|rpm|dmg|app)$/i;

// 未指定 --force 时，仅归档最近 30 分钟内修改过的文件，避免在 `tauri dev` 退出后误移旧产物
const FRESH_THRESHOLD_MS = 30 * 60 * 1000;
const FRESH_THRESHOLD_MIN = FRESH_THRESHOLD_MS / 60000;
const now = Date.now();

function formatTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// 递归收集所有安装包文件（含修改时间），供“是否新鲜”与“跳过原因”判断使用
function collectBundles(srcDir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      collectBundles(srcPath, out);
    } else if (BUNDLE_EXTENSIONS.test(entry.name)) {
      try {
        out.push({ path: srcPath, mtimeMs: fs.statSync(srcPath).mtimeMs });
      } catch { /* ignore stat errors */ }
    }
  }
}

const allFiles = [];
for (const root of bundleRoots) {
  const found = [];
  collectBundles(root.dir, found);
  for (const f of found) {
    allFiles.push({ ...f, platform: root.platform });
  }
}

const freshFiles = allFiles.filter((f) => now - f.mtimeMs <= FRESH_THRESHOLD_MS);
// --force：构建脚本已明确表达归档意图，无条件归档；否则仅归档新鲜产物。
const targets = force ? allFiles : freshFiles;

if (targets.length === 0) {
  // 跳过时保持“响亮”：打印发现的文件、修改时间与跳过原因，避免再次静默隐藏问题
  console.log('[move-bundles] 跳过归档。');
  if (allFiles.length === 0) {
    console.log('[move-bundles] 原因：bundle 目录中未发现任何安装包文件。');
    for (const root of bundleRoots) {
      console.log(`[move-bundles]   已扫描: ${path.relative(rootDir, root.dir)}`);
    }
  } else {
    console.log(
      `[move-bundles] 原因：发现 ${allFiles.length} 个安装包，但均不在 ${FRESH_THRESHOLD_MIN} 分钟新鲜度阈值内` +
      '（未指定 --force，视为 tauri dev 退出，不作归档）。'
    );
    console.log('[move-bundles] 发现的文件：');
    for (const f of allFiles) {
      const ageMin = ((now - f.mtimeMs) / 60000).toFixed(1);
      console.log(
        `[move-bundles]   - ${path.relative(rootDir, f.path)} ` +
        `(平台=${f.platform}, 修改时间=${formatTime(f.mtimeMs)}, 距今=${ageMin} 分钟)`
      );
    }
    console.log('[move-bundles] 如需强制归档，请运行: node scripts/move-bundles.js --force');
  }
  process.exit(0);
}

if (force) {
  console.log(`[move-bundles] --force 已启用：归档 ${targets.length} 个安装包。`);
}

// 归档命名对齐移动端/腕上端标准：弦予音乐v<版本>-<平台>-<架构>.<扩展名>
// 版本号以 version.ts 为唯一源头（构建前 sync-version 已同步到各处）；
// 架构从 Tauri 产物名提取（如 弦予音乐_2.0.4_x64-setup.exe → X64），
// 识别不出架构时兜底旧规则（exe 用 -Setup 后缀，其余直接用扩展名）。
function readAppVersion() {
  const content = fs.readFileSync(path.join(rootDir, 'version.ts'), 'utf8');
  const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

// 从文件名（源产物名或归档名）提取架构标记，识别不出返回 null
function detectArch(name) {
  const m = name.match(/(?:^|[_-])(x64|x86|aarch64|arm64)(?=[_.-]|$)/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  if (raw === 'x64') return 'X64';
  if (raw === 'x86') return 'X86';
  return 'ARM64'; // aarch64 / arm64
}

function platformLabel(platform) {
  return platform === 'macos' ? 'MacOS' : platform === 'linux' ? 'Linux' : 'Desktop';
}

function archiveName(originalName, platform) {
  const ext = path.extname(originalName).toLowerCase();
  const version = readAppVersion();
  if (!version) return originalName; // 兜底：读不到版本号就保留原名
  const label = platformLabel(platform);
  const arch = detectArch(originalName);
  if (!arch) {
    const suffix = platform === 'windows' && ext === '.exe' ? '-Setup' : '';
    return `弦予音乐v${version}-${label}${suffix}${ext}`;
  }
  return `弦予音乐v${version}-${label}-${arch}${ext}`;
}

// 清理同版本、同平台、但命名不同的旧归档（如旧的 -Setup 变体），避免用户误取到旧包。
// 保护范围：不同版本、不同平台、仓库根 releases/ 下的历史文件一律不动；
//          同版本的其他架构产物（如同时保留 X64 与 ARM64）也保留。
function removeStaleArchives(releasesDir, platform, version, destName, destArch) {
  const prefix = `弦予音乐v${version}-${platformLabel(platform)}`;
  let entries = [];
  try {
    entries = fs.readdirSync(releasesDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name === destName) continue; // 本次写入的目标文件
    if (!name.startsWith(prefix)) continue; // 非同一版本或非同一平台
    const staleArch = detectArch(name);
    // 目标与旧包各自带有明确且不同的架构标记，视为不同交付物，保留
    if (staleArch && destArch && staleArch !== destArch) continue;
    fs.rmSync(path.join(releasesDir, name), { force: true });
    console.log(`[move-bundles] 已删除同版本旧归档: ${name}`);
  }
}

console.log('[move-bundles] 正在移动构建产物到 releases/ ...');
for (const { path: file, platform } of targets) {
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

  // 归档完成后清理同版本同平台的旧命名归档
  const version = readAppVersion();
  if (version) {
    removeStaleArchives(releasesDir, platform, version, destName, detectArch(fileName));
  }
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

console.log(`[move-bundles] 完成，共移动 ${targets.length} 个文件到 releases/`);
