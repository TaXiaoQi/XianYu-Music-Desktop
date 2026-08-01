/**
 * 构建后脚本 —— 将 Tauri 构建产物复制到根目录的 releases/ 文件夹
 *
 * 触发条件：
 *   1. 通过 npm posttauri 钩子运行（npm run tauri build 后自动触发）
 *   2. 仅当检测到是 build 子命令时执行
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

// 检测是否是 build 命令（通过 npm_config_argv）
let isBuildCommand = false;
try {
  if (process.env.npm_config_argv) {
    const args = JSON.parse(process.env.npm_config_argv);
    isBuildCommand = args.original && args.original.includes('build');
  }
} catch { /* ignore */ }

// 只在 build 命令时运行
if (!isBuildCommand) {
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

// 递归收集所有安装包文件
function collectBundles(srcDir, files) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      collectBundles(srcPath, files);
    } else if (BUNDLE_EXTENSIONS.test(entry.name)) {
      files.push(srcPath);
    }
  }
}

const files = [];
collectBundles(bundleDir, files);

if (files.length === 0) {
  console.log('[move-bundles] 未找到构建产物，跳过');
  process.exit(0);
}

console.log('[move-bundles] 正在复制构建产物到 releases/ ...');
for (const file of files) {
  const fileName = path.basename(file);
  const destPath = path.join(releasesDir, fileName);
  fs.copyFileSync(file, destPath);
  console.log(`[move-bundles] 已复制: ${fileName}`);
}
console.log(`[move-bundles] 完成，共复制 ${files.length} 个文件到 releases/`);
