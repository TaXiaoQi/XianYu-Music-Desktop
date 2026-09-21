#!/usr/bin/env bash
# ===== 弦予 ffmpeg 构建前置工具链检查/补齐（MSYS2 pacman）=====
# $1: 1=需要检查并安装（默认），0=跳过
set -uo pipefail

NEED_DEPS="${1:-1}"

MISSING=()
for tool in gcc nasm make pkg-config diff curl tar xz; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    MISSING+=("$tool")
  fi
done

if [ "${#MISSING[@]}" -eq 0 ]; then
  echo "[✓] 工具链齐全"
  exit 0
fi

echo "[i] 缺少工具：${MISSING[*]}"
if [ "$NEED_DEPS" != "1" ]; then
  echo "[x] -SkipDeps 模式下不自动安装，请手动补齐"
  exit 1
fi

echo "[i] pacman 自动安装缺失工具链（首次约几分钟）"
pacman -S --needed --noconfirm \
  mingw-w64-x86_64-gcc \
  mingw-w64-x86_64-nasm \
  mingw-w64-x86_64-pkgconf \
  mingw-w64-x86_64-make \
  make \
  diffutils
if [ $? -ne 0 ]; then
  echo "[x] pacman 安装失败"
  exit 1
fi

STILL=()
for tool in gcc nasm make pkg-config diff curl tar xz; do
  command -v "$tool" >/dev/null 2>&1 || STILL+=("$tool")
done
if [ "${#STILL[@]}" -ne 0 ]; then
  echo "[x] 安装后仍缺失：${STILL[*]}"
  exit 1
fi
echo "[✓] 工具链已就绪"
