#!/usr/bin/env node

/**
 * 托盘守护进程 sidecar 复制脚本（tauri beforeBundleCommand，Windows 打包专用）
 *
 * cargo build 会把 [[bin]] xianyu-tray-daemon 编进 target/{profile}/，而
 * externalBin 约定从 src-tauri/bin/<name>-<target-triple>.exe 读取打包文件。
 * 本脚本在 cargo 构建之后、打包之前把守护进程复制为 sidecar 命名。
 *
 * 非 Windows 平台直接跳过（守护进程仅 Windows 实装，且 ffmpeg sidecar
 * 在 Linux/macOS 打包时已各自备好，无需本脚本处理）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcTauriDir = path.resolve(__dirname, '..', 'src-tauri');

if (process.platform !== 'win32') {
  process.exit(0);
}

const triple =
  process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';

// 常规构建产物在 target/release；--target 交叉构建在 target/<triple>/release
const candidates = [
  path.join(srcTauriDir, 'target', triple, 'release', 'xianyu-tray-daemon.exe'),
  path.join(srcTauriDir, 'target', 'release', 'xianyu-tray-daemon.exe'),
];

const source = candidates.find((candidate) => fs.existsSync(candidate));
if (!source) {
  console.error(
    `copy-tray-daemon: xianyu-tray-daemon.exe not found in:\n  ${candidates.join('\n  ')}`
  );
  process.exit(1);
}

const dest = path.join(srcTauriDir, 'bin', `xianyu-tray-daemon-${triple}.exe`);
fs.copyFileSync(source, dest);
console.log(`copy-tray-daemon: ${source} -> ${dest}`);
