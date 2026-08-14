@echo off
chcp 65001 >nul 2>&1
title XianYu Music Desktop - Cache Clean

echo ============================================
echo   XianYu Music Desktop - Cache Clean
echo ============================================
echo.

:: Set PATH (Cargo)
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

:: [1/5] Clean Rust build cache (src-tauri\target)
if exist "%~dp0src-tauri\target" (
    echo [1/5] Cleaning Rust build cache...
    cd /d "%~dp0src-tauri"
    cargo clean
    cd /d "%~dp0"
) else (
    echo [1/5] No cargo target, skip
)
echo.

:: [2/5] Clean Vite build output (dist)
if exist "%~dp0dist" (
    echo [2/5] Removing Vite build output...
    rmdir /s /q "%~dp0dist"
) else (
    echo [2/5] No dist, skip
)
echo.

:: [3/5] Clean Vite dev cache (node_modules\.vite)
if exist "%~dp0node_modules\.vite" (
    echo [3/5] Removing Vite dev cache [.vite]...
    rmdir /s /q "%~dp0node_modules\.vite"
) else (
    echo [3/5] No .vite cache, skip
)
echo.

:: [4/5] Clean TypeScript incremental cache (tsconfig*.tsbuildinfo)
set "TS_CLEANED=0"
if exist "%~dp0tsconfig.tsbuildinfo" (
    del /q "%~dp0tsconfig.tsbuildinfo"
    set "TS_CLEANED=1"
)
if exist "%~dp0tsconfig.node.tsbuildinfo" (
    del /q "%~dp0tsconfig.node.tsbuildinfo"
    set "TS_CLEANED=1"
)
if "%TS_CLEANED%"=="0" (
    echo [4/5] No tsbuildinfo, skip
) else (
    echo [4/5] Removing TypeScript incremental cache...
)
echo.

:: [5/5] Clean npm cache
echo [5/5] Cleaning npm cache...
call npm cache clean --force >nul 2>&1
echo       Done
echo.

echo ============================================
echo   Cache cleaned! Run npm run tauri:dev to rebuild.
echo ============================================
echo.
pause
