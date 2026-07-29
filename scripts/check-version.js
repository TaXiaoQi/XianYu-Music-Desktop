#!/usr/bin/env node

/**
 * 版本号一致性检查脚本
 *
 * 以 version.ts 中的 APP_VERSION 为源头，检查所有配置文件中的版本号是否一致。
 * 用法：`npm run version:check`
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

function readCargoVersion(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^version\s*=\s*"([^"]+)"$/m);

  if (!match) {
    throw new Error(`Could not find version in ${filePath}`);
  }

  return match[1];
}

function readCargoLockVersion(filePath, packageName) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(
    new RegExp(`\\[\\[package\\]\\][\\s\\S]*?name = "${packageName}"\\r?\\nversion = "([^"]+)"`, 'm')
  );

  if (!match) {
    throw new Error(`Could not find package ${packageName} in ${filePath}`);
  }

  return match[1];
}

function readVersionFromTs(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error(`Could not find APP_VERSION in ${filePath}`);
  }
  return match[1];
}

const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf8');
const cargoPackageNameMatch = cargoTomlContent.match(/^name\s*=\s*"([^"]+)"$/m);

if (!cargoPackageNameMatch) {
  console.error('Could not find package name in src-tauri/Cargo.toml');
  process.exit(1);
}

const cargoPackageName = cargoPackageNameMatch[1];

const versions = {
  'version.ts': readVersionFromTs(versionTsPath),
  'package.json': readJson(packageJsonPath).version,
  'package-lock.json': readJson(packageLockPath).version,
  'src-tauri/tauri.conf.json': readJson(tauriConfigPath).version,
  'src-tauri/Cargo.toml': readCargoVersion(cargoTomlPath),
  'src-tauri/Cargo.lock': readCargoLockVersion(cargoLockPath, cargoPackageName)
};

console.log('Current versions:');
for (const [file, version] of Object.entries(versions)) {
  console.log(`- ${file}: ${version}`);
}

const uniqueVersions = [...new Set(Object.values(versions))];
if (uniqueVersions.length === 1) {
  console.log(`Version status: OK (${uniqueVersions[0]})`);
} else {
  console.log(`Version status: MISMATCH (${uniqueVersions.join(', ')})`);
  console.log('Run `npm run version` to synchronize from version.ts');
  process.exitCode = 1;
}
