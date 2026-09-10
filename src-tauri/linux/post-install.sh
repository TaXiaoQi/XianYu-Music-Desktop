#!/bin/sh
# deb/rpm 安装后刷新桌面数据库，让 xianyu:// 深链的
# MimeType 关联（com.xymusic.desktop.desktop）立即生效。
# 最小系统可能没有该命令，失败不阻塞安装。
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
fi
