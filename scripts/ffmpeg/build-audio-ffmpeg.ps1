# ===== XianYu Desktop audio-only ffmpeg build driver =====
# Flow: locate MSYS2 (system path -> -Msys2Root -> portable download into scripts/ffmpeg/toolchain/msys64)
#       -> toolchain check/install -> build audio-only ffmpeg -> copy as Tauri sidecar
# Output: scripts/ffmpeg/out/ffmpeg.exe + src-tauri/bin/ffmpeg-x86_64-pc-windows-msvc.exe
#         arm64: scripts/ffmpeg/out-arm64/ + src-tauri/bin/ffmpeg-aarch64-pc-windows-msvc.exe
# Usage: .\scripts\ffmpeg\build-audio-ffmpeg.ps1 [-Arch x64|arm64] [-Msys2Root C:\msys64] [-Force] [-SkipDeps]
#        arm64 uses a portable llvm-mingw cross toolchain (auto-downloaded into toolchain/llvm-mingw)
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI)
# NOTE: MSYS2 children cannot write to PowerShell job pipes (stdout becomes a bad fd),
#       so every bash call must go through Start-Process with real file redirection.
param(
  [ValidateSet("x64", "arm64")]
  [string]$Arch = "x64",
  [string]$Msys2Root = "",
  [switch]$Force,
  [switch]$SkipDeps
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ToolchainDir = Join-Path $PSScriptRoot "toolchain"
$PortableMsys2 = Join-Path $ToolchainDir "msys64"
$OutLog = Join-Path $ToolchainDir "bash-out.log"
$ErrLog = Join-Path $ToolchainDir "bash-err.log"

$script:BashExe = ""

function Invoke-Bash([string]$Cmd) {
  if (-not (Test-Path $script:BashExe)) { Write-Host "[x] bash.exe not set"; exit 1 }
  $p = Start-Process -FilePath $script:BashExe `
    -ArgumentList @("-lc", "`"$Cmd`"") `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
  if (Test-Path $OutLog) { Get-Content $OutLog -Tail 2000 | Write-Host }
  if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 2000 | Write-Host }
  return $p.ExitCode
}

# ---- 1. Locate MSYS2 ----
$MsysRoot = ""
$candidates = @()
if ($Msys2Root -ne "") { $candidates += $Msys2Root }
$candidates += @("C:\msys64", "D:\msys64", $PortableMsys2)

foreach ($c in $candidates) {
  if ($c -and (Test-Path (Join-Path $c "usr\bin\bash.exe"))) {
    $script:BashExe = Join-Path $c "usr\bin\bash.exe"
    $MsysRoot = $c
    Write-Host "[i] Using MSYS2: $c"
    break
  }
}

# ---- 2. No MSYS2 -> download portable copy into scripts/ffmpeg/toolchain/ ----
if (-not $script:BashExe) {
  Write-Host "[i] MSYS2 not found, downloading portable copy to $PortableMsys2 (~100MB, first run only)"
  New-Item -ItemType Directory -Force -Path $ToolchainDir | Out-Null
  $sfx = Join-Path $ToolchainDir "msys2-base.sfx.exe"
  $url = "https://repo.msys2.org/distrib/msys2-x86_64-latest.sfx.exe"
  curl.exe -fL --retry 3 -o $sfx $url
  if ($LASTEXITCODE -ne 0) { Write-Host "[x] MSYS2 download failed"; exit 1 }
  Write-Host "[i] Extracting..."
  Push-Location $ToolchainDir
  & $sfx -y | Out-Null
  Pop-Location
  Remove-Item -Force $sfx -ErrorAction SilentlyContinue
  if (-not (Test-Path (Join-Path $PortableMsys2 "usr\bin\bash.exe"))) {
    Write-Host "[x] Portable MSYS2 extraction failed"
    exit 1
  }
  $script:BashExe = Join-Path $PortableMsys2 "usr\bin\bash.exe"
  $MsysRoot = $PortableMsys2
  Write-Host "[i] Initializing MSYS2 (first-run keys/db, a few minutes)"
  if ((Invoke-Bash "true") -ne 0) { Write-Host "[x] bash first-run failed"; exit 1 }
  if ((Invoke-Bash "pacman-key --init && pacman-key --populate msys2") -ne 0) {
    Write-Host "[x] pacman keyring init failed"; exit 1
  }
  if ((Invoke-Bash "pacman -Sy --noconfirm") -ne 0) {
    Write-Host "[x] pacman -Sy failed"; exit 1
  }
}

# ---- 3. ARM64: portable llvm-mingw cross toolchain ----
$LlvmMingwBin = Join-Path $ToolchainDir "llvm-mingw\bin"
if ($Arch -eq "arm64") {
  if (Test-Path (Join-Path $LlvmMingwBin "aarch64-w64-mingw32-gcc.exe")) {
    Write-Host "[i] Using llvm-mingw: $LlvmMingwBin"
  } else {
    Write-Host "[i] llvm-mingw not found, downloading portable copy (~200MB, first run only)"
    $zip = Join-Path $ToolchainDir "llvm-mingw.zip"
    $asset = ""
    try {
      $rel = Invoke-RestMethod "https://api.github.com/repos/mstorsjo/llvm-mingw/releases/latest"
      $asset = ($rel.assets | Where-Object { $_.name -match '^llvm-mingw-.*-ucrt-x86_64\.zip$' } | Select-Object -First 1).browser_download_url
    } catch { Write-Host "[i] GitHub API unavailable, falling back to pinned release" }
    if (-not $asset) {
      $asset = "https://github.com/mstorsjo/llvm-mingw/releases/download/20260922/llvm-mingw-20260922-ucrt-x86_64.zip"
    }
    Write-Host "[i] Downloading: $asset"
    curl.exe -fL --retry 3 --ssl-no-revoke -o $zip $asset
    if ($LASTEXITCODE -ne 0) { Write-Host "[x] llvm-mingw download failed"; exit 1 }
    Write-Host "[i] Extracting..."
    $tmp = Join-Path $ToolchainDir "llvm-mingw-extract"
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    Move-Item $inner.FullName (Join-Path $ToolchainDir "llvm-mingw")
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    if (-not (Test-Path (Join-Path $LlvmMingwBin "aarch64-w64-mingw32-gcc.exe"))) {
      Write-Host "[x] llvm-mingw extraction failed"
      exit 1
    }
    Write-Host "[OK] llvm-mingw ready: $LlvmMingwBin"
  }
}

# ---- 3b. Toolchain check / install ----
$env:MSYSTEM = "MINGW64"
$env:CHERE_INVOKING = "1"
$RepoPosix = $RepoRoot -replace '\\', '/'
$NeedDeps = if ($SkipDeps) { "0" } else { "1" }

if ($Arch -eq "arm64") {
  # arm64 cross build: only needs MSYS2 host tools (make/pkgconf/diff); compiler comes from llvm-mingw
  Write-Host "[i] MSYS2 host tools check (repo=$RepoPosix)"
  $code = Invoke-Bash "pacman -S --needed --noconfirm make diffutils mingw-w64-x86_64-pkgconf >/dev/null 2>&1; for t in make pkg-config diff curl tar xz; do command -v `$t >/dev/null 2>&1 || { echo missing: `$t; exit 1; }; done; echo host-tools-ok"
  if ($code -ne 0) {
    Write-Host "[x] MSYS2 host tools check failed (exit=$code)"
    exit $code
  }
} else {
  Write-Host "[i] Toolchain check (repo=$RepoPosix)"
  $code = Invoke-Bash "cd '$RepoPosix' && bash scripts/ffmpeg/bootstrap-deps.sh $NeedDeps"
  if ($code -ne 0) {
    Write-Host "[x] Toolchain check failed (exit=$code)"
    exit $code
  }
}

# ---- 4. Build ----
$ForceArg = if ($Force) { "1" } else { "0" }
Write-Host "[i] Building (repo=$RepoPosix, arch=$Arch)"
$code = Invoke-Bash "cd '$RepoPosix' && bash scripts/ffmpeg/build.sh '$RepoPosix' $ForceArg $Arch"
if ($code -ne 0) {
  Write-Host "[x] Build failed (exit=$code)"
  exit $code
}

# ---- 5. Copy as Tauri sidecar name (must exist at build time) ----
$outDirName = if ($Arch -eq "arm64") { "out-arm64" } else { "out" }
$sidecarName = if ($Arch -eq "arm64") { "ffmpeg-aarch64-pc-windows-msvc.exe" } else { "ffmpeg-x86_64-pc-windows-msvc.exe" }
$built = Join-Path $RepoRoot "scripts\ffmpeg\$outDirName\bin\ffmpeg.exe"
if (-not (Test-Path $built)) {
  Write-Host "[x] Build artifact not found (checked scripts\ffmpeg\$outDirName\bin\ffmpeg.exe)"
  exit 1
}
$binDir = Join-Path $RepoRoot "src-tauri\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Copy-Item -Force $built (Join-Path $binDir $sidecarName)
Write-Host "[OK] Copied: src-tauri/bin/$sidecarName"
Write-Host "[OK] All done. Run tauri dev / build (sidecar ships with the installer)"
