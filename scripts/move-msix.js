/**
 * MSIX 商店版构建后脚本 —— 将 MSIX 产物移动到根目录的 releases/ 文件夹
 *
 * 由 npm script tauri:build:store:msix 在构建完成后调用。
 * @choochmeque/tauri-windows-bundle 固定输出到 src-tauri/target/msix/，
 * 不会被 move-bundles.js 覆盖（后者只扫 target/release/bundle）。
 *
 * 仅移动最近 30 分钟内新生成的 .msix/.msixbundle，避免误移历史产物。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const msixDir = path.join(rootDir, 'src-tauri', 'target', 'msix');
const releasesDir = path.join(rootDir, 'releases');

if (!fs.existsSync(msixDir)) {
  process.exit(0);
}

if (!fs.existsSync(releasesDir)) {
  fs.mkdirSync(releasesDir, { recursive: true });
}

const MSIX_EXTENSIONS = /\.(msix|msixbundle)$/i;
const FRESH_THRESHOLD_MS = 30 * 60 * 1000;
const now = Date.now();

const files = [];
for (const entry of fs.readdirSync(msixDir, { withFileTypes: true })) {
  if (entry.isDirectory() || !MSIX_EXTENSIONS.test(entry.name)) continue;
  const srcPath = path.join(msixDir, entry.name);
  try {
    const stat = fs.statSync(srcPath);
    if (now - stat.mtimeMs <= FRESH_THRESHOLD_MS) {
      files.push(srcPath);
    }
  } catch { /* ignore stat errors */ }
}

if (files.length === 0) {
  console.log('[move-msix] 未检测到新生成的 MSIX 产物，跳过');
  process.exit(0);
}

console.log('[move-msix] 正在移动 MSIX 产物到 releases/ ...');
for (const file of files) {
  const fileName = path.basename(file);
  const destPath = path.join(releasesDir, fileName);
  try {
    fs.renameSync(file, destPath);
  } catch {
    fs.copyFileSync(file, destPath);
    fs.rmSync(file, { force: true });
  }
  console.log(`[move-msix] 已移动: ${fileName}`);
}

console.log(`[move-msix] 完成，共移动 ${files.length} 个文件到 releases/`);
