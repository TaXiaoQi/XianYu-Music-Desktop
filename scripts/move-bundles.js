/**
 * 构建后脚本 —— 将 Tauri 构建产物移动到根目录的 releases/ 文件夹
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

const bundleDir = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle');
const releasesDir = path.join(rootDir, 'releases');

// 检查 bundle 目录是否存在
if (!fs.existsSync(bundleDir)) {
  process.exit(0);
}

// 确保 releases 目录存在
if (!fs.existsSync(releasesDir)) {
  fs.mkdirSync(releasesDir, { recursive: true });
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
collectFreshBundles(bundleDir, files);

if (files.length === 0) {
  console.log('[move-bundles] 未检测到新生成的构建产物，跳过');
  process.exit(0);
}

console.log('[move-bundles] 正在移动构建产物到 releases/ ...');
for (const file of files) {
  const fileName = path.basename(file);
  const destPath = path.join(releasesDir, fileName);
  // 优先使用 rename（同盘原子操作），失败则回退到复制+删除
  try {
    fs.renameSync(file, destPath);
  } catch {
    fs.copyFileSync(file, destPath);
    fs.rmSync(file, { force: true });
  }
  console.log(`[move-bundles] 已移动: ${fileName}`);
}

// 清理 bundle 目录下剩余的空文件夹（nsis/msi 等）
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
cleanupEmptyDirs(bundleDir);

console.log(`[move-bundles] 完成，共移动 ${files.length} 个文件到 releases/`);
