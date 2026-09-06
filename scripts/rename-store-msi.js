/**
 * 商店版构建后脚本 —— 将 MSI 重命名为英文文件名 XianYu-Music-<版本>-<架构>.msi
 *
 * 触发条件：npm run tauri:build:store 链尾（move-bundles.js 之后）执行。
 * 仅处理 releases/ 目录下的 *_<版本>_<架构>_<语言>.msi，官网 NSIS 包不受影响。
 * 目的：避免中文文件名在 Partner Center 包 URL 里的百分号编码问题。
 */
import fs from 'node:fs';
import path from 'node:path';

const releasesDir = path.resolve(import.meta.dirname, '..', 'releases');
const MSI_PATTERN = /^[^_]+_(\d+\.\d+\.\d+)_(x86|x64|arm64|arm)_[^.]+\.msi$/i;

if (!fs.existsSync(releasesDir)) process.exit(0);

for (const entry of fs.readdirSync(releasesDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const m = entry.name.match(MSI_PATTERN);
  if (!m) continue;
  const [, version, arch] = m;
  const newName = `XianYu-Music-${version}-${arch}.msi`;
  if (newName === entry.name) continue;

  const oldPath = path.join(releasesDir, entry.name);
  const newPath = path.join(releasesDir, newName);

  if (fs.existsSync(newPath)) {
    const oldSize = fs.statSync(oldPath).size;
    const newSize = fs.statSync(newPath).size;
    if (oldSize === newSize) {
      fs.rmSync(oldPath);
      console.log(`[rename-store-msi] 已存在同名产物，移除旧文件: ${entry.name}`);
      continue;
    }
    fs.rmSync(newPath);
  }

  fs.renameSync(oldPath, newPath);
  console.log(`[rename-store-msi] ${entry.name} -> ${newName}`);
}
