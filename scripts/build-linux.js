/**
 * Linux 构建辅助脚本 —— npm run tauri:build:linux / npm run tauri:build:linux:arm64
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
 * 带 arm64 参数时（tauri:build:linux:arm64）交叉编译 aarch64 包：
 *   - 产出 deb/rpm/appimage。AppImage 交叉打包依赖 qemu-user-static binfmt
 *     （x86 宿主上透明模拟运行 arm64 版 linuxdeploy），未安装时脚本退出并提示
 *   - WSL 内需先备好交叉环境：gcc-aarch64-linux-gnu + multiarch 的
 *     libwebkit2gtk-4.1-dev:arm64（缺失时脚本会打印准备命令并退出）
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
const CROSS_TRIPLE = 'aarch64-unknown-linux-gnu';

// node scripts/build-linux.js [arm64]
const crossArm64 = process.argv.slice(2).includes('arm64');

function runNative() {
  const cross = crossArm64 && os.arch() !== 'arm64';
  if (cross) prepareNativeCrossEnv();

  const sync = spawnSync(process.execPath, [path.join(__dirname, 'sync-version.js')], { stdio: 'inherit' });
  if (sync.status !== 0) process.exit(sync.status ?? 1);

  const targetArgs = cross ? ` --target ${CROSS_TRIPLE} --bundles deb,rpm,appimage` : '';
  const build = spawnSync(`npx tauri build --config ${LINUX_CONF}${targetArgs}`, { stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);

  spawnSync(process.execPath, [path.join(__dirname, 'move-bundles.js'), '--force'], { stdio: 'inherit' });
}

// x86_64 宿主上原生交叉编译 ARM64 的环境检查与注入（Linux/WSL 内直接执行时用）。
function prepareNativeCrossEnv() {
  const hasCrossGcc = spawnSync('aarch64-linux-gnu-gcc', ['--version'], { stdio: 'ignore' }).status === 0;
  if (!hasCrossGcc) {
    console.error('[build-linux] 未找到 aarch64-linux-gnu-gcc，无法交叉编译 ARM64。请先安装：');
    console.error('  sudo apt install -y gcc-aarch64-linux-gnu');
    process.exit(1);
  }
  const pcRoot = '/usr/lib/aarch64-linux-gnu/pkgconfig';
  const hasWebKit = fs.existsSync(path.join(pcRoot, 'webkit2gtk-4.1.pc'))
    || fs.existsSync(path.join(pcRoot, 'webkit2gtk-4.0.pc'));
  if (!hasWebKit) {
    console.error('[build-linux] 缺少 ARM64 架构的 webkit2gtk 开发库，请先启用 multiarch 并安装：');
    console.error('  sudo dpkg --add-architecture arm64');
    console.error('  echo "deb [arch=arm64] https://ports.ubuntu.com/ubuntu-ports $(. /etc/os-release && echo $VERSION_CODENAME) main universe" | sudo tee /etc/apt/sources.list.d/arm64-ports.list');
    console.error('  sudo apt update');
    console.error('  sudo apt install -y libwebkit2gtk-4.1-dev:arm64 libssl-dev:arm64');
    process.exit(1);
  }
  const target = spawnSync('rustup', ['target', 'add', CROSS_TRIPLE], { stdio: 'inherit' });
  if (target.status !== 0) process.exit(target.status ?? 1);

  // AppImage 交叉打包：arm64 版 linuxdeploy 需经 qemu binfmt 透明模拟运行
  if (!fs.existsSync('/proc/sys/fs/binfmt_misc/qemu-aarch64')) {
    console.error('[build-linux] 交叉打包 AppImage 需要 qemu binfmt 运行 arm64 版 linuxdeploy，请先执行：');
    console.error('  sudo apt install -y qemu-user-binfmt');
    console.error('  sudo update-binfmts --enable qemu-aarch64  # 未自动注册时手动开启');
    process.exit(1);
  }

  process.env.CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER = 'aarch64-linux-gnu-gcc';
  process.env.PKG_CONFIG_ALLOW_CROSS = '1';
  process.env.PKG_CONFIG_LIBDIR = '/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig';
}

function toWslPath(windowsPath) {
  return `/mnt/${windowsPath[0].toLowerCase()}${windowsPath.slice(2).replace(/\\/g, '/')}`;
}

// 读取 Linux 配置并关闭 beforeBuildCommand（dist 已在 Windows 侧构建完成）；
// 交叉编译 ARM64 时产出 deb/rpm/appimage（AppImage 经 qemu binfmt 运行 arm64 版 linuxdeploy）。
function readMergedLinuxConf() {
  const confPath = path.join(rootDir, LINUX_CONF);
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  conf.build = { ...(conf.build ?? {}), beforeBuildCommand: '' };
  if (crossArm64) {
    conf.bundle = { ...(conf.bundle ?? {}), targets: ['deb', 'rpm', 'appimage'] };
  }
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
    `XY_ARCH=${crossArm64 ? 'arm64' : 'x64'}`,
    'command -v node >/dev/null 2>&1 || { echo "[build-linux] WSL 内未找到 Node.js，请先在 WSL 内安装 Node.js 18+"; exit 1; }',
    'command -v cargo >/dev/null 2>&1 || { echo "[build-linux] WSL 内未找到 cargo，请先安装 Rust：curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }',
    'HOST_ARCH="$(uname -m)"',
    // 交叉编译 ARM64（x86_64 宿主）：检查交叉工具链与目标架构系统库；其余情况按宿主架构检查
    'if [ "$XY_ARCH" = "arm64" ] && [ "$HOST_ARCH" != "aarch64" ]; then',
    '  command -v aarch64-linux-gnu-gcc >/dev/null 2>&1 || {',
    '    echo "[build-linux] WSL 内缺少 ARM64 交叉编译器，请先在 WSL 内执行："',
    '    echo "  sudo apt install -y gcc-aarch64-linux-gnu";',
    '    exit 1;',
    '  }',
    '  [ -f /usr/lib/aarch64-linux-gnu/pkgconfig/webkit2gtk-4.1.pc ] || [ -f /usr/lib/aarch64-linux-gnu/pkgconfig/webkit2gtk-4.0.pc ] || {',
    '    echo "[build-linux] WSL 内缺少 ARM64 架构的 webkit2gtk 开发库，请先在 WSL 内启用 multiarch 并安装："',
    '    echo "  sudo dpkg --add-architecture arm64";',
    '    echo \'  echo "deb [arch=arm64] https://ports.ubuntu.com/ubuntu-ports $(. /etc/os-release && echo $VERSION_CODENAME) main universe" | sudo tee /etc/apt/sources.list.d/arm64-ports.list\';',
    '    echo "  sudo apt update";',
    '    echo "  sudo apt install -y libwebkit2gtk-4.1-dev:arm64 libssl-dev:arm64";',
    '    exit 1;',
    '  }',
    `  rustup target list --installed | grep -q "${CROSS_TRIPLE}" || rustup target add "${CROSS_TRIPLE}"`,
    `  export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc`,
    '  export PKG_CONFIG_ALLOW_CROSS=1',
    '  export PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig',
    'else',
    '  pkg-config --exists webkit2gtk-4.1 2>/dev/null || pkg-config --exists webkit2gtk-4.0 2>/dev/null || {',
    '  echo "[build-linux] WSL 内缺少 Tauri 系统依赖（webkit2gtk），请先执行：";',
    '  echo "  sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev";',
    '  exit 1;',
    '}',
    'fi',
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
    // AppImage 打包架构：ARM64 交叉时为 aarch64，其余按宿主架构
    'TARGET_IMG_ARCH="$HOST_ARCH"',
    'if [ "$XY_ARCH" = "arm64" ] && [ "$HOST_ARCH" != "aarch64" ]; then',
    '  TARGET_IMG_ARCH=aarch64',
    '  # linuxdeploy-aarch64 是 arm64 ELF，x86 宿主上经 qemu binfmt 透明模拟运行',
    '  if [ ! -f /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then',
    '    echo "[build-linux] 交叉打包 AppImage 需要 qemu binfmt 运行 arm64 版 linuxdeploy，请先执行："',
    '    echo "  sudo apt install -y qemu-user-binfmt"',
    '    echo "  sudo update-binfmts --enable qemu-aarch64  # 未自动注册时手动开启"',
    '    exit 1;',
    '  fi',
    '  # 库搜索指向 arm64：gtk 插件默认按宿主 multiarch（x86_64）拷库，',
    '  # linuxdeploy 的 ldconfig 查找同名库时也可能命中 x86 路径，均会混入错误架构的 .so',
    '  export LD_GTK_LIBRARY_PATH=/usr/lib/aarch64-linux-gnu',
    '  export LD_LIBRARY_PATH=/usr/lib/aarch64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}',
    '  # arm64 版 gtk-query-immodules / gdk-pixbuf-query-loaders 前置（binfmt 透明执行），',
    '  # 避免 x86 版工具处理 arm64 模块生成错误缓存',
    '  export PATH="/usr/lib/aarch64-linux-gnu/libgtk-3-0:/usr/lib/aarch64-linux-gnu/gdk-pixbuf-2.0:$PATH"',
    '  # 交叉 ldd shim：x86 宿主的 ldd 只认 x86 加载器（RTLDLIST），对 aarch64 ELF',
    '  # 一律输出 "not a dynamic executable"，而 linuxdeploy 的依赖收集完全依赖 ldd，',
    '  # 不修的话 AppImage 只会带上 plugin-gtk 的固定清单，缺整条 GTK/X11 依赖栈。',
    '  # 这里用 qemu + arm64 loader --list 顶替，让依赖树完整进入 AppImage。',
    '  SHIM_DIR="$HOME/.cache/tauri/ldd-shim-aarch64"',
    '  mkdir -p "$SHIM_DIR"',
    '  cat > "$SHIM_DIR/ldd" <<\'EOF\'',
    '#!/bin/bash',
    '# aarch64 ELF 交由 qemu + arm64 loader 解析依赖，其余交给系统 ldd',
    'f=""',
    'for a in "$@"; do case "$a" in -*) ;; *) f="$a" ;; esac; done',
    'if [ -n "$f" ] && [ -f "$f" ] && [ "$(od -An -tx1 -j18 -N2 "$f" 2>/dev/null | tr -d \' \\n\')" = "b700" ]; then',
    '  exec qemu-aarch64 /usr/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1 --list "$f"',
    'fi',
    'exec /usr/bin/ldd "$@"',
    'EOF',
    '  chmod +x "$SHIM_DIR/ldd"',
    '  export PATH="$SHIM_DIR:$PATH"',
    '  # linuxdeploy 自带 strip 为 x86 版，无法识别 aarch64 文件会报错中断；$NO_STRIP 整体跳过',
    '  export NO_STRIP=1',
    'fi',
    // Tauri CLI 缺缓存时会直连 GitHub 下载，国内网络不稳定，提前经加速镜像取好：
    //   AppRun-{arch} 与 linuxdeploy-{arch}.AppImage 为硬依赖，
    //   plugin-appimage / plugin-gtk.sh / plugin-gstreamer.sh 失败时有内置兜底，不做预取。
    'for tool_file in "AppRun-$TARGET_IMG_ARCH" "linuxdeploy-$TARGET_IMG_ARCH.AppImage"; do',
    '  if [ ! -s "$HOME/.cache/tauri/$tool_file" ]; then',
    '    mkdir -p "$HOME/.cache/tauri"',
    '    case "$tool_file" in',
    '      AppRun-*) tool_url="https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/$tool_file" ;;',
    '      *)',
    '        if [ "$TARGET_IMG_ARCH" = "aarch64" ]; then',
    '          # tauri 镜像仓库的 linuxdeploy-aarch64 停留在 2024 年老构建，与 x86_64 新版行为不一致，改用上游 continuous',
    '          tool_url="https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/$tool_file"',
    '        else',
    '          tool_url="https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/$tool_file"',
    '        fi ;;',
    '    esac',
    '    echo "[build-linux] 获取 $tool_file ..."',
    '    for mirror in "https://ghfast.top/" "https://gh-proxy.com/" "https://ghproxy.net/" "https://gh.llkk.cc/" ""; do',
    '      curl -fL --connect-timeout 12 --max-time 300 -o "$HOME/.cache/tauri/$tool_file" "$mirror$tool_url" && [ -s "$HOME/.cache/tauri/$tool_file" ] && break',
    '      rm -f "$HOME/.cache/tauri/$tool_file"',
    '    done',
    '  fi',
    '  [ -s "$HOME/.cache/tauri/$tool_file" ] || { echo "[build-linux] 无法获取 $tool_file，AppImage 打包将失败（deb/rpm 不受影响）"; }',
    'done',
    // AppImage 打包需要 type2 runtime 文件；linuxdeploy 的 appimage 插件默认从 GitHub
    // 直连下载，国内网络不稳定时失败。提前经加速镜像取好并通过 LDAI_RUNTIME_FILE 注入。
    'runtime_file="$HOME/.cache/appimage/runtime-$TARGET_IMG_ARCH"',
    'if [ ! -s "$runtime_file" ]; then',
    '  mkdir -p "$HOME/.cache/appimage"',
    '  base_url="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-$TARGET_IMG_ARCH"',
    '  for mirror in "https://ghfast.top/" "https://gh-proxy.com/" "https://ghproxy.net/" "https://gh.llkk.cc/" ""; do',
    '    curl -sfL --connect-timeout 12 --max-time 180 -o "$runtime_file" "$mirror$base_url" && [ -s "$runtime_file" ] && break',
    '    rm -f "$runtime_file"',
    '  done',
    'fi',
    'if [ -s "$runtime_file" ]; then',
    '  export LDAI_RUNTIME_FILE="$runtime_file"',
    'else',
    '  echo "[build-linux] 警告：未能获取 AppImage runtime，AppImage 打包可能失败（deb/rpm 不受影响）"',
    'fi',
    'echo "[build-linux] WSL 内执行 Rust 编译与打包（CARGO_TARGET_DIR=$CARGO_TARGET_DIR）..."',
    crossArm64
      ? `npx tauri build --target ${CROSS_TRIPLE} --config ${q(JSON.stringify(readMergedLinuxConf()))}`
      : `npx tauri build --config ${q(JSON.stringify(readMergedLinuxConf()))}`,
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
