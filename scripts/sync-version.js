#!/usr/bin/env node

/**
 * 版本号同步脚本
 *
 * 从项目根目录的 version.ts 读取 APP_VERSION 作为唯一版本号源头，
 * 同步到以下文件：
 *   - package.json
 *   - package-lock.json
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/Cargo.toml
 *   - src-tauri/Cargo.lock
 *
 * 用法：修改 version.ts 中的 APP_VERSION 后运行 `npm run version`
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const versionTsPath = path.join(rootDir, 'version.ts');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function replaceInFile(filePath, pattern, replacement) {
  const content = fs.readFileSync(filePath, 'utf8');
  const nextContent = content.replace(pattern, replacement);

  if (content === nextContent) {
    return false;
  }

  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

function updateCargoLockVersion(filePath, packageName, nextVersion) {
  if (!fs.existsSync(filePath)) {
    return 'missing';
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const packagePattern = new RegExp(
    `(\\[\\[package\\]\\][\\s\\S]*?name = "${packageName}"\\r?\\nversion = ").*?(")`,
    'm'
  );
  const nextContent = content.replace(packagePattern, `$1${nextVersion}$2`);

  if (content === nextContent) {
    return 'unchanged';
  }

  fs.writeFileSync(filePath, nextContent, 'utf8');
  return 'updated';
}

// --- 从 version.ts 读取版本号（唯一源头） ---
function readVersionFromTs(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    console.error(`Could not find APP_VERSION in ${filePath}`);
    process.exit(1);
  }
  return match[1];
}

const version = readVersionFromTs(versionTsPath);

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  console.error(`Invalid version in version.ts: ${version}`);
  process.exit(1);
}

// --- 同步到 package.json ---
const packageJson = readJson(packageJsonPath);
const packageJsonUpdated = packageJson.version !== version;
if (packageJsonUpdated) {
  packageJson.version = version;
  writeJson(packageJsonPath, packageJson);
}

// --- 同步到 package-lock.json ---
let packageLockUpdated = false;
if (fs.existsSync(packageLockPath)) {
  const packageLock = readJson(packageLockPath);
  if (packageLock.version !== version) {
    packageLock.version = version;
    if (packageLock.packages && packageLock.packages['']) {
      packageLock.packages[''].version = version;
    }
    writeJson(packageLockPath, packageLock);
    packageLockUpdated = true;
  }
}

// --- 同步到 tauri.conf.json ---
const tauriConfig = readJson(tauriConfigPath);
const tauriConfigUpdated = tauriConfig.version !== version;
if (tauriConfigUpdated) {
  tauriConfig.version = version;
  writeJson(tauriConfigPath, tauriConfig);
}

// --- 同步到 Cargo.toml ---
const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
const cargoPackageNameMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"$/m);

if (!cargoPackageNameMatch) {
  console.error('Could not find package name in src-tauri/Cargo.toml');
  process.exit(1);
}

const cargoPackageName = cargoPackageNameMatch[1];
const cargoTomlUpdated = replaceInFile(
  cargoTomlPath,
  /^version\s*=\s*".*"$/m,
  `version = "${version}"`
);

// --- 同步到 Cargo.lock ---
const cargoLockStatus = updateCargoLockVersion(cargoLockPath, cargoPackageName, version);

// --- 输出结果 ---
console.log(`Synchronized version ${version} (source: version.ts)`);
console.log(`- package.json${packageJsonUpdated ? '' : ' (already up to date)'}`);
console.log(`- package-lock.json${packageLockUpdated ? '' : (fs.existsSync(packageLockPath) ? ' (already up to date)' : ' (not found)')}`);
console.log(`- src-tauri/tauri.conf.json${tauriConfigUpdated ? '' : ' (already up to date)'}`);
console.log(`- src-tauri/Cargo.toml${cargoTomlUpdated ? '' : ' (already up to date)'}`);
console.log(
  `- src-tauri/Cargo.lock${
    cargoLockStatus === 'updated'
      ? ''
      : cargoLockStatus === 'missing'
        ? ' (not found)'
        : ' (already up to date)'
  }`
);
