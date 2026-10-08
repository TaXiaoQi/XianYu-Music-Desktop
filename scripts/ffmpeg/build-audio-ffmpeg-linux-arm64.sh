#!/usr/bin/env bash
# ===== 弦予桌面端 audio-only ffmpeg 精简交叉构建（Linux aarch64）=====
# 用途：产出 src-tauri/bin/ffmpeg-aarch64-unknown-linux-gnu（tauri externalBin sidecar）
# 用法：WSL 内执行  bash scripts/ffmpeg/build-audio-ffmpeg-linux-arm64.sh <repo-root-wsl-path>
#       例如       bash scripts/ffmpeg/build-audio-ffmpeg-linux-arm64.sh /mnt/d/XianYu-Music/XianYu-Music-Desktop
# 依赖：WSL 内 apt 安装 gcc-aarch64-linux-gnu（libc6-dev-arm64-cross 随附静态 glibc）
# 工作区：$HOME/xy-ffbuild（WSL 原生文件系统，避开 /mnt 慢盘）；重编删除该目录即可
# 源码：复用 scripts/ffmpeg/src/ 下与 build.sh 相同版本的官方压缩包，仅编译目标不同
set -euo pipefail

REPO_ROOT="${1:?usage: build-audio-ffmpeg-linux-arm64.sh <repo-root-wsl-path>}"
SCRIPT_DIR="$REPO_ROOT/scripts/ffmpeg"
SRC_TARBALLS="$SCRIPT_DIR/src"
WORK="$HOME/xy-ffbuild"
DEPS="$WORK/deps"
OUT="$WORK/out"
JOBS="$(nproc 2>/dev/null || echo 4)"

FFMPEG_VER="7.1.1"
LAME_VER="3.100"
LIBOGG_VER="1.3.5"
LIBVORVIS_VER="1.3.7"
OPUS_VER="1.5.2"

CROSS="aarch64-linux-gnu-"
HOST_ARGS=(--host=aarch64-linux-gnu CC="${CROSS}gcc" CXX="${CROSS}g++")
FFMPEG_CROSS_ARGS=(--enable-cross-compile --cross-prefix="$CROSS" --arch=aarch64 --target-os=linux --pkg-config=pkg-config)
# 交叉编译无法运行 CPU 检测程序，opus 关闭 asm/rtcd（与 Windows arm64 处理一致）
OPUS_ASM_ARGS=(--disable-asm --disable-rtcd)
STATIC_FLAGS="--disable-shared --enable-static --disable-dependency-tracking"

for tool in "${CROSS}gcc" "${CROSS}strip" make pkg-config curl tar xz; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[x] 缺少工具：$tool（sudo apt install -y gcc-aarch64-linux-gnu）"
    exit 1
  fi
done

mkdir -p "$WORK" "$DEPS" "$OUT"

# 从源码压缩包干净解压（避免混入其他架构的 .o/.a）
cd "$WORK"
[ -d "ffmpeg-$FFMPEG_VER" ]     || tar -xJf "$SRC_TARBALLS/ffmpeg-$FFMPEG_VER.tar.xz"
[ -d "lame-$LAME_VER" ]         || tar -xzf "$SRC_TARBALLS/lame-$LAME_VER.tar.gz"
[ -d "libogg-$LIBOGG_VER" ]     || tar -xJf "$SRC_TARBALLS/libogg-$LIBOGG_VER.tar.xz"
[ -d "libvorbis-$LIBVORVIS_VER" ] || tar -xJf "$SRC_TARBALLS/libvorbis-$LIBVORVIS_VER.tar.xz"
[ -d "opus-$OPUS_VER" ]         || tar -xzf "$SRC_TARBALLS/opus-$OPUS_VER.tar.gz"

export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig"

build_dep() {
  local name="$1" marker="$2"
  shift 2
  if [ -f "$DEPS/lib/$marker" ]; then
    echo "[=] $name 已构建，跳过"
    return 0
  fi
  echo "[build] $name"
  (
    cd "$WORK/$name"
    ./configure --prefix="$DEPS" $STATIC_FLAGS "${HOST_ARGS[@]}" "$@" >/dev/null
    make -j"$JOBS" >/dev/null
    make install >/dev/null
  )
}

build_dep "lame-$LAME_VER" "libmp3lame.a" --disable-frontend --disable-gtktest
build_dep "libogg-$LIBOGG_VER" "libogg.a"
build_dep "libvorbis-$LIBVORVIS_VER" "libvorbis.a"
build_dep "opus-$OPUS_VER" "libopus.a" --disable-extra-programs --disable-doc "${OPUS_ASM_ARGS[@]}"

# ---- ffmpeg（audio-only，配置清单与 build.sh 保持一致）----
cd "$WORK/ffmpeg-$FFMPEG_VER"
if [ ! -x "$OUT/bin/ffmpeg" ]; then
  echo "[configure] ffmpeg $FFMPEG_VER（audio-only LGPL，target=linux/aarch64）"
  ./configure \
    --prefix="$OUT" \
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
    --extra-cflags="-I$DEPS/include" \
    --extra-ldflags="-L$DEPS/lib -static" \
    --pkg-config-flags=--static \
    "${FFMPEG_CROSS_ARGS[@]}"

  echo "[make] ffmpeg（-j$JOBS）"
  make -j"$JOBS"
  make install
fi

"${CROSS}strip" "$OUT/bin/ffmpeg" 2>/dev/null || true

DEST="$REPO_ROOT/src-tauri/bin/ffmpeg-aarch64-unknown-linux-gnu"
cp "$OUT/bin/ffmpeg" "$DEST"
chmod 0755 "$DEST"
echo "[✓] 已产出：$DEST"
ls -lh "$DEST"
