/**
 * MSIX 商店版构建桥接脚本
 *
 * @choochmeque/tauri-windows-bundle 的 build 命令固定执行 "<runner> tauri build
 * --target <triple> --no-bundle"，其中 <runner> 是任意 shell 前缀。借助这一点，
 * 用本脚本接管构建：转发 --target/--debug 等参数，并注入商店版硬性要求：
 *
 * 1. --features store-build：禁用应用内自更新（MSIX 沙盒内自更新会损坏应用，
 *    更新必须完全交给 Microsoft Store 接管）
 * 2. 通过 node 直接调用 @tauri-apps/cli 的 tauri.js，不依赖 PATH 里有没有 tauri
 *
 * 用法（由 npm script tauri:build:store:msix 间接调用，不手动执行）：
 *   node scripts/msix-bridge.js tauri build --target x86_64-pc-windows-msvc --no-bundle
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 工具的命令模板固定为 "<runner> tauri build ..."，去掉前导的 "tauri"
const forwarded = process.argv.slice(2);
if (forwarded[0] === 'tauri') forwarded.shift();

if (forwarded[0] !== 'build') {
  console.error(`[msix-bridge] 意外的命令: ${forwarded.join(' ')}`);
  process.exit(1);
}

if (!forwarded.includes('--no-bundle')) {
  console.error('[msix-bridge] 缺少 --no-bundle，拒绝执行（MSIX 构建必须跳过 MSI/NSIS 打包）');
  process.exit(1);
}

const tauriCli = path.join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const finalArgs = ['build', '--features', 'store-build', ...forwarded.slice(1)];

console.log(`[msix-bridge] node ${path.relative(projectRoot, tauriCli)} ${finalArgs.join(' ')}`);

const result = spawnSync(process.execPath, [tauriCli, ...finalArgs], {
  cwd: projectRoot,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
