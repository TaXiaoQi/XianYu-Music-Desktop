#!/usr/bin/env node // 实现

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

import fs from 'node:fs'; // 实现
import path from 'node:path'; // 实现
import { fileURLToPath } from 'node:url'; // 实现

const __filename = fileURLToPath(import.meta.url); // 实现
const __dirname = path.dirname(__filename); // 实现
const rootDir = path.resolve(__dirname, '..'); // 实现

const versionTsPath = path.join(rootDir, 'version.ts');
const packageJsonPath = path.join(rootDir, 'package.json'); // 实现
const packageLockPath = path.join(rootDir, 'package-lock.json');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json'); // 实现
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml'); // 实现
const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock'); // 实现

function readJson(filePath) { // 实现
  return JSON.parse(fs.readFileSync(filePath, 'utf8')); // 实现
}

function writeJson(filePath, data) { // 实现
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8'); // 实现
}

function replaceInFile(filePath, pattern, replacement) { // 实现
  const content = fs.readFileSync(filePath, 'utf8'); // 实现
  const nextContent = content.replace(pattern, replacement); // 实现

  if (content === nextContent) { // 实现
    return false; // 实现
  }

  fs.writeFileSync(filePath, nextContent, 'utf8'); // 实现
  return true; // 实现
}

function updateCargoLockVersion(filePath, packageName, nextVersion) { // 实现
  if (!fs.existsSync(filePath)) { // 实现
    return 'missing'; // 实现
  }

  const content = fs.readFileSync(filePath, 'utf8'); // 实现
  const packagePattern = new RegExp( // 实现
    `(\\[\\[package\\]\\][\\s\\S]*?name = "${packageName}"\\r?\\nversion = ").*?(")`, // 实现
    'm'
  );
  const nextContent = content.replace(packagePattern, `$1${nextVersion}$2`); // 实现

  if (content === nextContent) { // 实现
    return 'unchanged'; // 实现
  }

  fs.writeFileSync(filePath, nextContent, 'utf8'); // 实现
  return 'updated'; // 实现
}

// --- 从 version.ts 读取版本号（唯一源头） ---
function readVersionFromTs(filePath) {
  const content = fs.readFileSync(filePath, 'utf8'); // 实现
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
  process.exit(1); // 实现
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
const tauriConfig = readJson(tauriConfigPath); // 实现
const tauriConfigUpdated = tauriConfig.version !== version;
if (tauriConfigUpdated) {
  tauriConfig.version = version;
  writeJson(tauriConfigPath, tauriConfig);
}

// --- 同步到 Cargo.toml ---
const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8'); // 实现
const cargoPackageNameMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"$/m); // 实现

if (!cargoPackageNameMatch) { // 实现
  console.error('Could not find package name in src-tauri/Cargo.toml'); // 实现
  process.exit(1); // 实现
}

const cargoPackageName = cargoPackageNameMatch[1]; // 实现
const cargoTomlUpdated = replaceInFile( // 实现
  cargoTomlPath, // 实现
  /^version\s*=\s*".*"$/m, // 实现
  `version = "${version}"` // 实现
);

// --- 同步到 Cargo.lock ---
const cargoLockStatus = updateCargoLockVersion(cargoLockPath, cargoPackageName, version); // 实现

// --- 输出结果 ---
console.log(`Synchronized version ${version} (source: version.ts)`);
console.log(`- package.json${packageJsonUpdated ? '' : ' (already up to date)'}`);
console.log(`- package-lock.json${packageLockUpdated ? '' : (fs.existsSync(packageLockPath) ? ' (already up to date)' : ' (not found)')}`);
console.log(`- src-tauri/tauri.conf.json${tauriConfigUpdated ? '' : ' (already up to date)'}`);
console.log(`- src-tauri/Cargo.toml${cargoTomlUpdated ? '' : ' (already up to date)'}`); // 实现
console.log( // 实现
  `- src-tauri/Cargo.lock${ // 实现
    cargoLockStatus === 'updated' // 实现
      ? ''
      : cargoLockStatus === 'missing' // 实现
        ? ' (not found)' // 实现
        : ' (already up to date)' // 实现
  }`
);
