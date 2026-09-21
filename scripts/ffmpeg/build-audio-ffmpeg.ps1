# ===== XianYu Desktop audio-only ffmpeg build driver =====
# Flow: locate MSYS2 (system path -> -Msys2Root -> portable download into scripts/ffmpeg/toolchain/msys64)
#       -> toolchain check/install -> build audio-only ffmpeg -> copy as Tauri sidecar
# Output: scripts/ffmpeg/out/ffmpeg.exe + src-tauri/bin/ffmpeg-x86_64-pc-windows-msvc.exe
# Usage: .\scripts\ffmpeg\build-audio-ffmpeg.ps1 [-Msys2Root C:\msys64] [-Force] [-SkipDeps]
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI)
# NOTE: MSYS2 children cannot write to PowerShell job pipes (stdout becomes a bad fd),
#       so every bash call must go through Start-Process with real file redirection.
param(
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

# ---- 3. Toolchain check / install ----
$env:MSYSTEM = "MINGW64"
$env:CHERE_INVOKING = "1"
$RepoPosix = $RepoRoot -replace '\\', '/'
$NeedDeps = if ($SkipDeps) { "0" } else { "1" }

Write-Host "[i] Toolchain check (repo=$RepoPosix)"
$code = Invoke-Bash "cd '$RepoPosix' && bash scripts/ffmpeg/bootstrap-deps.sh $NeedDeps"
if ($code -ne 0) {
  Write-Host "[x] Toolchain check failed (exit=$code)"
  exit $code
}

# ---- 4. Build ----
$ForceArg = if ($Force) { "1" } else { "0" }
Write-Host "[i] Building (repo=$RepoPosix)"
$code = Invoke-Bash "cd '$RepoPosix' && bash scripts/ffmpeg/build.sh '$RepoPosix' $ForceArg"
if ($code -ne 0) {
  Write-Host "[x] Build failed (exit=$code)"
  exit $code
}

# ---- 5. Copy as Tauri sidecar name (must exist at build time) ----
$built = Join-Path $RepoRoot "scripts\ffmpeg\out\bin\ffmpeg.exe"
if (-not (Test-Path $built)) {
  $built = Join-Path $RepoRoot "scripts\ffmpeg\out\ffmpeg.exe"
}
if (-not (Test-Path $built)) {
  Write-Host "[x] Build artifact not found (checked out\bin\ffmpeg.exe and out\ffmpeg.exe)"
  exit 1
}
$binDir = Join-Path $RepoRoot "src-tauri\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$targets = @(
  "ffmpeg-x86_64-pc-windows-msvc.exe"
)
foreach ($t in $targets) {
  Copy-Item -Force $built (Join-Path $binDir $t)
  Write-Host "[OK] Copied: src-tauri/bin/$t"
}
Write-Host "[OK] All done. Run tauri dev / build (sidecar ships with the installer)"
