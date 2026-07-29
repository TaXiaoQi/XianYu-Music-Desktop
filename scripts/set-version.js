#!/usr/bin/env node

/**
 * 版本号设置脚本
 *
 * 用法：
 *   node scripts/set-version.js patch     # 递增 patch 版本 (1.0.5 → 1.0.6)
 *   node scripts/set-version.js minor     # 递增 minor 版本 (1.0.5 → 1.1.0)
 *   node scripts/set-version.js major     # 递增 major 版本 (1.0.5 → 2.0.0)
 *   node scripts/set-version.js 1.2.3     # 设置为指定版本号
 *   node scripts/set-version.js 1.2.3-beta.1  # 设置为带预发布标签的版本号
 *
 * 会先更新 version.ts，然后自动同步到所有配置文件。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const versionTsPath = path.join(rootDir, 'version.ts');

function readVersionFromTs(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    console.error(`Could not find APP_VERSION in ${filePath}`);
    process.exit(1);
  }
  return match[1];
}

function writeVersionToTs(filePath, version) {
  const content = fs.readFileSync(filePath, 'utf8');
  const nextContent = content.replace(
    /APP_VERSION\s*=\s*['"][^'"]+['"]/,
    `APP_VERSION = '${version}'`
  );
  fs.writeFileSync(filePath, nextContent, 'utf8');
}

function parseSemver(version) {
  // 解析 "1.0.5" 或 "1.0.5-fix2" 或 "1.0.5-beta.1"
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    console.error(`Invalid version format: ${version}`);
    process.exit(1);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  };
}

function bumpVersion(current, bumpType) {
  const parsed = parseSemver(current);
  switch (bumpType) {
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'major':
      return `${parsed.major + 1}.0.0`;
    default:
      return null;
  }
}

const arg = process.argv[2];

if (!arg) {
  console.error('Usage: node scripts/set-version.js <patch|minor|major|version>');
  console.error('Examples:');
  console.error('  node scripts/set-version.js patch');
  console.error('  node scripts/set-version.js minor');
  console.error('  node scripts/set-version.js 1.2.3');
  console.error('  node scripts/set-version.js 1.2.3-beta.1');
  process.exit(1);
}

const currentVersion = readVersionFromTs(versionTsPath);
let newVersion;

if (arg === 'patch' || arg === 'minor' || arg === 'major') {
  newVersion = bumpVersion(currentVersion, arg);
  console.log(`Bumping ${arg} version: ${currentVersion} → ${newVersion}`);
} else {
  // 验证版本号格式
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(arg)) {
    console.error(`Invalid version format: ${arg}`);
    console.error('Expected format: X.Y.Z or X.Y.Z-prerelease');
    process.exit(1);
  }
  newVersion = arg;
  console.log(`Setting version: ${currentVersion} → ${newVersion}`);
}

// 写入 version.ts
writeVersionToTs(versionTsPath, newVersion);
console.log(`Updated version.ts`);

// 同步到所有配置文件
execSync('node scripts/sync-version.js', { stdio: 'inherit', cwd: rootDir });
