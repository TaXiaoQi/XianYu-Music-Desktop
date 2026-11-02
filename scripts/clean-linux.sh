#!/usr/bin/env bash
# ============================================================
#   弦予音乐桌面版 · 一键清理脚本（Linux 版）
#   用法：
#     bash scripts/clean-linux.sh          # 清理构建缓存（保留依赖与发布产物）
#     bash scripts/clean-linux.sh --all    # 额外删除 node_modules（需重装依赖）
#     bash scripts/clean-linux.sh --yes    # 跳过确认，直接执行
#   说明：
#     - 永远不会触碰 releases/ 下的最终安装包（deb/rpm/AppImage）
#     - 永远不会触碰 src-tauri/vendor/ 与 .git
# ============================================================
set -u

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

CLEAN_ALL=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --all) CLEAN_ALL=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,2\}//'
      exit 0
      ;;
    *)
      echo "未知参数：$arg（可用 --all / --yes / --help）"
      exit 1
      ;;
  esac
done

# 体积统计（目录不存在则返回 -）
size_of() {
  if [ -e "$1" ]; then du -sh "$1" 2>/dev/null | cut -f1; else echo "-"; fi
}

echo "============================================"
echo "  弦予音乐桌面版 · 一键清理（Linux）"
echo "  项目目录：$ROOT"
echo "============================================"
echo

# 汇总清理清单
ITEMS=()            # "路径|说明"
TARGET_DIR="$ROOT/src-tauri/target"
DIST_DIR="$ROOT/dist"
VITE_CACHE="$ROOT/node_modules/.vite"
TSBUILD_FILES=()
for f in tsconfig.tsbuildinfo tsconfig.node.tsbuildinfo; do
  [ -f "$ROOT/$f" ] && TSBUILD_FILES+=("$ROOT/$f")
done
NODE_MODULES="$ROOT/node_modules"

[ -d "$TARGET_DIR" ]  && ITEMS+=("$TARGET_DIR|Rust 构建缓存（cargo target，含各架构产物）")
[ -d "$DIST_DIR" ]    && ITEMS+=("$DIST_DIR|Vite 前端构建输出")
[ -d "$VITE_CACHE" ]  && ITEMS+=("$VITE_CACHE|Vite 开发缓存")
[ -d "$NODE_MODULES" ] && [ "$CLEAN_ALL" -eq 1 ] && ITEMS+=("$NODE_MODULES|前端依赖（清理后需重新 npm install）")
[ ${#TSBUILD_FILES[@]} -gt 0 ] && ITEMS+=("tsbuildinfo|TypeScript 增量编译缓存")

if [ ${#ITEMS[@]} -eq 0 ]; then
  echo "没有发现可清理的内容，环境已是干净状态。"
  exit 0
fi

echo "将清理以下内容："
echo
for item in "${ITEMS[@]}"; do
  path="${item%%|*}"; desc="${item#*|}"
  if [ "$path" = "tsbuildinfo" ]; then
    sz=$(du -chk "${TSBUILD_FILES[@]}" 2>/dev/null | tail -1 | cut -f1)
    printf "  · %-14s %s\n" "$sz" "$desc"
  else
    printf "  · %-14s %s\n" "$(size_of "$path")" "$desc"
  fi
done
echo
echo "保留不动：releases/（最终安装包）、src-tauri/vendor/、.git"
echo

if [ "$ASSUME_YES" -ne 1 ]; then
  printf "确认清理？[y/N] "
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "已取消。"; exit 0 ;;
  esac
  echo
fi

# 执行清理
STEP=0
TOTAL=${#ITEMS[@]}

for item in "${ITEMS[@]}"; do
  STEP=$((STEP + 1))
  path="${item%%|*}"; desc="${item#*|}"
  echo "[$STEP/$TOTAL] 清理：$desc"
  case "$path" in
    tsbuildinfo)
      rm -f "${TSBUILD_FILES[@]}"
      ;;
    *)
      rm -rf "$path"
      ;;
  esac
  echo "      完成"
  echo
done

echo "============================================"
echo "  清理完成！重新构建："
echo "    开发调试：npm run tauri:dev"
echo "    打包发布：npm run tauri:build:linux"
echo "              npm run tauri:build:linux:arm64"
[ "$CLEAN_ALL" -eq 1 ] && echo "    （已删除 node_modules，请先执行 npm install）"
echo "============================================"
