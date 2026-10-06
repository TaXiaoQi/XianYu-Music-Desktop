/**
 * Linux 构建辅助脚本 —— npm run tauri:build:linux
 *
 * Linux 包（deb/rpm/AppImage）只能在 Linux 环境产出，Windows 上直接跑 tauri build
 * 只会按宿主平台编译出 exe，不生成任何 Linux bundle。本脚本做一层转发：
 *
 * Windows 上执行：
 *   1. sync-version + npm run build 在 Windows 侧完成前端构建（dist 与平台无关）
 *   2. 转发到 WSL（默认发行版）内，仅执行 Rust 编译与打包：
 *      - CARGO_TARGET_DIR 复用 ~/xy-target（Linux 原生文件系统，避开 /mnt 慢盘，
 *        且可复用历史构建的增量缓存）
 *      - 以内联 JSON 配置关闭 beforeBuildCommand（dist 已就绪）
 *   3. move-bundles.js 在 WSL 内归档产物到项目 releases/linux
 *
 * 在 Linux/WSL 内直接执行时走原生链路：sync-version → tauri build → move-bundles。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const LINUX_CONF = 'src-tauri/tauri.linux.conf.json';

function runNative() {
  const sync = spawnSync(process.execPath, [path.join(__dirname, 'sync-version.js')], { stdio: 'inherit' });
  if (sync.status !== 0) process.exit(sync.status ?? 1);

  const build = spawnSync(`npx tauri build --config ${LINUX_CONF}`, { stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);

  spawnSync(process.execPath, [path.join(__dirname, 'move-bundles.js'), '--force'], { stdio: 'inherit' });
}

function toWslPath(windowsPath) {
  return `/mnt/${windowsPath[0].toLowerCase()}${windowsPath.slice(2).replace(/\\/g, '/')}`;
}

// 读取 Linux 配置并关闭 beforeBuildCommand（dist 已在 Windows 侧构建完成）
function readMergedLinuxConf() {
  const confPath = path.join(rootDir, LINUX_CONF);
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  conf.build = { ...(conf.build ?? {}), beforeBuildCommand: '' };
  return conf;
}

function runViaWsl() {
  // wsl.exe --status 探测 WSL 是否可用（未安装或无可用发行版时退出码非 0）
  const probe = spawnSync('wsl.exe', ['--status'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) {
    console.error('[build-linux] 未检测到可用的 WSL 环境，无法在 Windows 上产出 Linux 包。');
    console.error('  管理员 PowerShell 执行：wsl --install -d Ubuntu');
    console.error('  并在 WSL 内准备 Node.js 18+ 与 Rust（rustup）后重试。');
    process.exit(1);
  }

  // 1. Windows 侧完成版本同步与前端构建
  const sync = spawnSync(process.execPath, [path.join(__dirname, 'sync-version.js')], { stdio: 'inherit' });
  if (sync.status !== 0) process.exit(sync.status ?? 1);

  console.log('[build-linux] Windows 侧构建前端 dist（npm run build）...');
  const front = spawnSync('npm run build', { stdio: 'inherit', shell: true, cwd: rootDir });
  if (front.status !== 0) process.exit(front.status ?? 1);

  // 2. WSL 内仅执行 Rust 编译与打包。
  // 注意：wsl.exe 会把多个 argv 重新拼接后交给默认 shell，内联脚本中的引号会丢失，
  // 因此把内部脚本写到临时文件，以文件路径方式交给 WSL 内的 bash 执行。
  const wslDir = toWslPath(rootDir);
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const inner = [
    'set -e',
    'cd ' + q(wslDir),
    // rustup 的 PATH 不在 .profile/.bashrc 中，非交互 shell 需显式加载
    '[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"',
    '[ -d "$HOME/.cargo/bin" ] && export PATH="$HOME/.cargo/bin:$PATH"',
    'command -v node >/dev/null 2>&1 || { echo "[build-linux] WSL 内未找到 Node.js，请先在 WSL 内安装 Node.js 18+"; exit 1; }',
    'command -v cargo >/dev/null 2>&1 || { echo "[build-linux] WSL 内未找到 cargo，请先安装 Rust：curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }',
    'pkg-config --exists webkit2gtk-4.1 2>/dev/null || pkg-config --exists webkit2gtk-4.0 2>/dev/null || {',
    '  echo "[build-linux] WSL 内缺少 Tauri 系统依赖（webkit2gtk），请先执行：";',
    '  echo "  sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev";',
    '  exit 1;',
    '}',
    // 补装 Tauri CLI 的 Linux 平台二进制：npm pack + 解压到 node_modules，
    // 绝不触发依赖树重算（npm install 在 Linux 侧会把 Windows 平台可选依赖剪除，
    // 导致回到 Windows 后构建报 @rollup/rollup-win32-x64-msvc 缺失）
    'case "$(uname -m)" in',
    '  aarch64|arm64) cli_pkg="@tauri-apps/cli-linux-arm64-gnu" ;;',
    '  *) cli_pkg="@tauri-apps/cli-linux-x64-gnu" ;;',
    'esac',
    'if [ ! -d "node_modules/$cli_pkg" ]; then',
    '  cli_ver=$(node -p "require(\'./node_modules/@tauri-apps/cli/package.json\').version")',
    '  echo "[build-linux] 补装 Linux 版 Tauri CLI（$cli_pkg@$cli_ver，pack+解压）..."',
    '  npm pack --silent --pack-destination "$HOME" "$cli_pkg@$cli_ver" >/dev/null',
    '  tgz_name="${cli_pkg/@/}"; tgz_name="${tgz_name//\\//-}-$cli_ver.tgz"',
    '  mkdir -p "node_modules/$cli_pkg"',
    '  tar -xzf "$HOME/$tgz_name" -C "node_modules/$cli_pkg" --strip-components=1',
    '  rm -f "$HOME/$tgz_name"',
    'fi',
    // 复用 Linux 侧的 cargo 缓存目录，move-bundles 同样通过该环境变量定位产物
    'export CARGO_TARGET_DIR="$HOME/xy-target"',
    // AppImage 打包需要 type2 runtime 文件；linuxdeploy 内置 appimagetool 会从 GitHub
    // 直连下载，国内网络不稳定时失败。提前经加速镜像取好并通过 LDAI_RUNTIME_FILE 注入。
    'runtime_file="$HOME/.cache/appimage/runtime-x86_64"',
    'if [ ! -s "$runtime_file" ]; then',
    '  mkdir -p "$HOME/.cache/appimage"',
    '  base_url="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64"',
    '  for mirror in "https://ghfast.top/" "https://gh-proxy.com/" "https://ghproxy.net/" "https://gh.llkk.cc/" ""; do',
    '    curl -sfL --connect-timeout 12 --max-time 180 -o "$runtime_file" "$mirror$base_url" && [ -s "$runtime_file" ] && break',
    '  done',
    'fi',
    'if [ -s "$runtime_file" ]; then',
    '  export LDAI_RUNTIME_FILE="$runtime_file"',
    'else',
    '  echo "[build-linux] 警告：未能获取 AppImage runtime，AppImage 打包可能失败（deb/rpm 不受影响）"',
    'fi',
    'echo "[build-linux] WSL 内执行 Rust 编译与打包（CARGO_TARGET_DIR=$CARGO_TARGET_DIR）..."',
    `npx tauri build --config ${q(JSON.stringify(readMergedLinuxConf()))}`,
    'node scripts/move-bundles.js --force',
  ].join('\n');

  const innerWinPath = path.join(os.tmpdir(), 'xy-build-linux-inner.sh');
  const innerWslPath = toWslPath(innerWinPath);
  fs.writeFileSync(innerWinPath, inner + '\n', 'utf8');
  let exitStatus = 1;
  try {
    console.log(`[build-linux] 转发到 WSL 执行 Linux 构建：${wslDir}`);
    const build = spawnSync('wsl.exe', ['--cd', wslDir, 'bash', innerWslPath], { stdio: 'inherit' });
    exitStatus = build.status ?? 1;
  } finally {
    fs.rmSync(innerWinPath, { force: true });
  }
  process.exit(exitStatus);
}

if (os.platform() === 'win32') {
  runViaWsl();
} else {
  runNative();
}
