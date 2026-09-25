/**
 * ARM64 Windows 构建辅助脚本 —— npm run tauri:build:arm64
 *
 * 交叉编译 aarch64-pc-windows-msvc 需要的工具链不在默认 PATH：
 *   - clang-cl（LLVM，ring 的 arm64 汇编硬性要求）
 *   - cmake（VS 组件版，opusic-sys 编译 opus 用）
 * 本脚本仅在构建会话内临时补齐 PATH 后调用 tauri build，不改系统环境。
 * 流程与 tauri:build:mac/linux 一致：sync-version → tauri build → move-bundles 归档。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const extraPaths = [
  path.join(os.homedir(), '.cargo', 'bin'),
  String.raw`C:\Program Files\LLVM\bin`,
  String.raw`C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin`,
].filter((p) => fs.existsSync(p));

const sep = process.platform === 'win32' ? ';' : ':';
process.env.PATH = `${extraPaths.join(sep)}${extraPaths.length ? sep : ''}${process.env.PATH ?? ''}`;

const sync = spawnSync(process.execPath, [path.join(__dirname, 'sync-version.js')], { stdio: 'inherit' });
if (sync.status !== 0) process.exit(sync.status ?? 1);

const build = spawnSync('npx tauri build --target aarch64-pc-windows-msvc', {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) process.exit(build.status ?? 1);

spawnSync(process.execPath, [path.join(__dirname, 'move-bundles.js')], { stdio: 'inherit' });
