#!/usr/bin/env bash
# ===== 弦予桌面端 audio-only ffmpeg 精简构建 =====
# 产物：静态单文件 ffmpeg.exe（仅音频解码/编码，LGPL 组件）
# 工作区：scripts/ffmpeg/{src,build,out}（均不入库）
# 用法：由同目录 build-audio-ffmpeg.ps1 驱动，也可在 MSYS2 MINGW64 shell 内直接执行
# 参数：<repo-root> [force] [arch]；arch=x64（原生 MSYS2 gcc）| arm64（llvm-mingw 交叉）
set -euo pipefail

REPO_ROOT="${1:?usage: build.sh <repo-root> [force] [arch]}"
REPO_ROOT="$(cygpath -u "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")"
FORCE="${2:-0}"
ARCH="${3:-x64}"

SCRIPT_DIR="$REPO_ROOT/scripts/ffmpeg"
SRC_DIR="$SCRIPT_DIR/src"
BUILD_DIR="$SCRIPT_DIR/build"
OUT_DIR="$SCRIPT_DIR/out"
DEP_DIR="$BUILD_DIR/deps"

FFMPEG_VER="7.1.1"
LAME_VER="3.100"
LIBOGG_VER="1.3.5"
LIBVORVIS_VER="1.3.7"
OPUS_VER="1.5.2"

JOBS="$(nproc 2>/dev/null || echo 4)"

# ---- 交叉工具链（arm64）：llvm-mingw，由 ps1 驱动下载到 toolchain/llvm-mingw ----
CROSS_PREFIX_CMD=""
CROSS_HOST_ARGS=()
FFMPEG_CROSS_ARGS=()
OPUS_ASM_ARGS=()
STRIP_CMD="strip"

if [ "$ARCH" = "arm64" ]; then
  CROSS_BIN="$SCRIPT_DIR/toolchain/llvm-mingw/bin"
  if [ ! -x "$CROSS_BIN/aarch64-w64-mingw32-gcc.exe" ]; then
    echo "[x] 未找到 llvm-mingw 交叉工具链：$CROSS_BIN"
    echo "    请由 build-audio-ffmpeg.ps1 -Arch arm64 驱动（自动下载）"
    exit 1
  fi
  export PATH="$CROSS_BIN:$PATH"
  CROSS_PREFIX_CMD="aarch64-w64-mingw32-"
  CROSS_HOST_ARGS=(--host=aarch64-w64-mingw32 CC=aarch64-w64-mingw32-gcc CXX=aarch64-w64-mingw32-g++)
  FFMPEG_CROSS_ARGS=(--enable-cross-compile --cross-prefix="$CROSS_PREFIX_CMD" --arch=aarch64 --target-os=mingw32 --pkg-config=pkg-config)
  # opus 的 ARM RTCD（celt/arm/armcpu.c）在 clang 交叉编译下无 CPU 检测方法，关闭 asm+rtcd
  OPUS_ASM_ARGS=(--disable-asm --disable-rtcd)
  BUILD_DIR="$SCRIPT_DIR/build-arm64"
  OUT_DIR="$SCRIPT_DIR/out-arm64"
  DEP_DIR="$BUILD_DIR/deps"
  STRIP_CMD="aarch64-w64-mingw32-strip"
  for tool in aarch64-w64-mingw32-gcc aarch64-w64-mingw32-strip make pkg-config diff curl tar xz; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "[x] 缺少工具：$tool"
      exit 1
    fi
  done
else
  for tool in gcc nasm make pkg-config diff curl tar xz strip; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "[x] 缺少工具：$tool"
      echo "    请在 MSYS2 MINGW64 中执行："
      echo "    pacman -S --needed mingw-w64-x86_64-toolchain mingw-w64-x86_64-nasm mingw-w64-x86_64-pkgconf make diffutils"
      exit 1
    fi
  done
fi

mkdir -p "$SRC_DIR" "$BUILD_DIR" "$OUT_DIR" "$DEP_DIR"

# x64/arm64 共用源码树，切换架构时必须清理旧架构的 .o/.a，否则 make 会复用错架构产物
LAST_ARCH=""
[ -f "$SRC_DIR/.built-arch" ] && LAST_ARCH="$(cat "$SRC_DIR/.built-arch")"
if [ -n "$LAST_ARCH" ] && [ "$LAST_ARCH" != "$ARCH" ]; then
  echo "[i] 检测到架构切换 $LAST_ARCH -> $ARCH，清理源码树旧产物"
  for d in lame-$LAME_VER libogg-$LIBOGG_VER libvorbis-$LIBVORVIS_VER opus-$OPUS_VER ffmpeg-$FFMPEG_VER; do
    if [ -d "$SRC_DIR/$d" ]; then
      (cd "$SRC_DIR/$d" && make distclean >/dev/null 2>&1) || true
    fi
  done
  rm -f "$DEP_DIR"/lib/*.a "$DEP_DIR"/lib/pkgconfig/*.pc
fi
echo "$ARCH" > "$SRC_DIR/.built-arch"

fetch() {
  local name="$1" url="$2"
  if [ -d "$SRC_DIR/$name" ]; then
    echo "[=] $name 源码已存在，跳过下载"
    return 0
  fi
  local archive="$SRC_DIR/$name.tar"
  echo "[↓] 下载 $name"
  case "$url" in
    *.tar.xz) curl -fL --retry 3 -o "$archive.xz" "$url" && tar -xJf "$archive.xz" -C "$SRC_DIR" ;;
    *.tar.gz) curl -fL --retry 3 -o "$archive.gz" "$url" && tar -xzf "$archive.gz" -C "$SRC_DIR" ;;
    *) echo "[x] 未知压缩格式：$url"; exit 1 ;;
  esac
}

if [ -f "$OUT_DIR/ffmpeg.exe" ] && [ "$FORCE" != "1" ]; then
  echo "[=] ffmpeg.exe 已存在（scripts/ffmpeg/out），如需重编传入 -Force"
  exit 0
fi

# mingw64 版 pkgconf 用 Windows 语义：只认 D:/ 风格路径且分隔符是 ';'，
# 登录 shell 注入的 '/mingw64/...' POSIX 条目会污染整串，故 arm64 只导出 deps 单路径
if [ "$ARCH" = "arm64" ]; then
  export PKG_CONFIG_PATH="$(cygpath -m "$DEP_DIR")/lib/pkgconfig"
else
  export PKG_CONFIG_PATH="$DEP_DIR/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
fi
STATIC_FLAGS="--disable-shared --enable-static --disable-dependency-tracking"

# ---- lame（MP3 编码，ffmpeg 无原生 MP3 编码器）----
fetch "lame-$LAME_VER" "https://downloads.sourceforge.net/project/lame/lame/$LAME_VER/lame-$LAME_VER.tar.gz"
if [ ! -f "$DEP_DIR/lib/libmp3lame.a" ]; then
  echo "[build] lame"
  cd "$SRC_DIR/lame-$LAME_VER"
  ./configure --prefix="$DEP_DIR" $STATIC_FLAGS --disable-frontend --disable-gtktest "${CROSS_HOST_ARGS[@]}" >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
fi

# ---- libogg / libvorbis / libopus ----
fetch "libogg-$LIBOGG_VER" "https://downloads.xiph.org/releases/ogg/libogg-$LIBOGG_VER.tar.xz"
if [ ! -f "$DEP_DIR/lib/libogg.a" ]; then
  echo "[build] libogg"
  cd "$SRC_DIR/libogg-$LIBOGG_VER"
  ./configure --prefix="$DEP_DIR" $STATIC_FLAGS "${CROSS_HOST_ARGS[@]}" >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
fi

fetch "libvorbis-$LIBVORVIS_VER" "https://downloads.xiph.org/releases/vorbis/libvorbis-$LIBVORVIS_VER.tar.xz"
if [ ! -f "$DEP_DIR/lib/libvorbis.a" ]; then
  echo "[build] libvorbis"
  cd "$SRC_DIR/libvorbis-$LIBVORVIS_VER"
  ./configure --prefix="$DEP_DIR" $STATIC_FLAGS "${CROSS_HOST_ARGS[@]}" >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
fi

fetch "opus-$OPUS_VER" "https://downloads.xiph.org/releases/opus/opus-$OPUS_VER.tar.gz"
if [ ! -f "$DEP_DIR/lib/libopus.a" ]; then
  echo "[build] libopus"
  cd "$SRC_DIR/opus-$OPUS_VER"
  ./configure --prefix="$DEP_DIR" $STATIC_FLAGS --disable-extra-programs --disable-doc "${CROSS_HOST_ARGS[@]}" "${OPUS_ASM_ARGS[@]}" >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
fi

# ---- ffmpeg（audio-only）----
fetch "ffmpeg-$FFMPEG_VER" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VER.tar.xz"
cd "$SRC_DIR/ffmpeg-$FFMPEG_VER"

echo "[configure] ffmpeg $FFMPEG_VER（audio-only LGPL）"
./configure \
  --prefix="$OUT_DIR" \
  --disable-everything \
  --enable-protocol=file \
  --enable-demuxer=aac,aiff,ape,asf,flac,mov,mp3,ogg,wav,ac3,ac4,dts,mlp \
  --enable-muxer=adts,aiff,ape,asf,flac,ipod,mp3,mp4,ogg,wav \
  --enable-decoder=aac,aac_latm,alac,ape,flac,mp1,mp1float,mp2,mp2float,mp3,mp3float,mp3adu,mp3adufloat,mp3on4,mp3on4float,opus,vorbis,wmav1,wmav2,ac3,eac3,ac4,dca,mlp,truehd,pcm_u8,pcm_s8,pcm_s16be,pcm_s16be_planar,pcm_s16le,pcm_s16le_planar,pcm_s24be,pcm_s24le,pcm_s24le_planar,pcm_s32be,pcm_s32le,pcm_s32le_planar,pcm_u16be,pcm_u16le,pcm_u24be,pcm_u24le,pcm_u32be,pcm_u32le,pcm_f32be,pcm_f32le,pcm_f64be,pcm_f64le,pcm_alaw,pcm_mulaw,adpcm_ima_wav,adpcm_ms,adpcm_yamaha \
  --enable-encoder=libmp3lame,aac,alac,wmav2,ape,flac,libopus,libvorbis,pcm_u8,pcm_s16be,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_alaw,pcm_mulaw \
  --enable-parser=aac,flac,mp3,opus,vorbis,ac3,ac4,dca,mlp \
  --enable-filter=aformat,anull,aresample,volume \
  --enable-libmp3lame \
  --enable-libopus \
  --enable-libvorbis \
  --disable-autodetect \
  --disable-network \
  --disable-doc \
  --disable-debug \
  --disable-ffprobe \
  --disable-ffplay \
  --disable-iconv \
  --disable-zlib \
  --disable-bzlib \
  --disable-lzma \
  --disable-swscale \
  --disable-sdl2 \
  --extra-cflags="-I$DEP_DIR/include" \
  --extra-ldflags="-L$DEP_DIR/lib -static" \
  --pkg-config-flags=--static \
  "${FFMPEG_CROSS_ARGS[@]}"

echo "[make] ffmpeg（-j$JOBS，首次约 5-15 分钟）"
make -j"$JOBS"
make install

"$STRIP_CMD" "$OUT_DIR/bin/ffmpeg.exe" 2>/dev/null || true
ls -lh "$OUT_DIR/bin/ffmpeg.exe"
echo "[✓] 构建完成：$OUT_DIR/bin/ffmpeg.exe"
