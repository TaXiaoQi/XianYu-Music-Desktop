import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const packageJsonPath = path.join(rootDir, 'package.json');
const outputDir = path.join(rootDir, 'releases');
const WIX_UPGRADE_CODE = '4fab41aa-9212-5640-9c2c-8dc5363dfdaa';

// Helper to read JSON
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Helper to write JSON
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Helper to run a command and log output
function runCommand(command, cwd) {
  console.log(`Running: ${command}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function toMsiCompatibleVersion(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)(?:-(.+))?$/);
  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }

  const [, baseVersion, prerelease] = match;
  if (!prerelease) {
    return baseVersion;
  }

  const numericIdentifier = prerelease.match(/\d+/)?.[0];
  if (!numericIdentifier) {
    throw new Error(
      `MSI requires numeric-only pre-release identifier, but got: ${version}`
    );
  }

  const numericValue = Number(numericIdentifier);
  if (!Number.isInteger(numericValue) || numericValue > 65535) {
    throw new Error(
      `MSI pre-release identifier must be an integer no greater than 65535, but got: ${numericIdentifier}`
    );
  }

  return `${baseVersion}-${numericValue}`;
}

async function main() {
  // 1. Backup original tauri.conf.json
  const originalConfigContent = fs.readFileSync(tauriConfigPath, 'utf8');
  const originalConfig = JSON.parse(originalConfigContent);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Read version
    const packageJson = readJson(packageJsonPath);
    const version = packageJson.version;
    const msiVersion = toMsiCompatibleVersion(version);
    console.log(`Building Lycia Player v${version}...`);
    console.log(`MSI compatible version: ${msiVersion}`);

    const buildTargets = [
      {
        type: 'skip',
        suffix: 'portable',
        label: 'Portable版本 (跳过 WebView2 检测)'
      },
      {
        type: 'downloadBootstrapper',
        suffix: 'standard',
        label: 'Standard标准版本 (检测并自动下载 WebView2)'
      }
    ];

    const installerLocales = [
      {
        language: 'zh-CN',
        suffix: 'zh-CN',
        productName: '弦予音乐',
        mainBinaryName: '弦予音乐',
        windowTitle: '弦予音乐',
        label: '中文安装包'
      },
      {
        language: 'en-US',
        suffix: 'en-US',
        productName: 'XianYu-Music',
        mainBinaryName: 'XianYu-Music',
        windowTitle: 'XianYu-Music',
        label: '英文安装包'
      }
    ];

    for (const target of buildTargets) {
      for (const locale of installerLocales) {
        console.log(`\n==================================================`);
        console.log(`开始构建: ${target.label} / ${locale.label}`);
        console.log(`==================================================`);

        // Modify tauri.conf.json
        const config = JSON.parse(originalConfigContent);
        config.productName = locale.productName;
        config.mainBinaryName = locale.mainBinaryName;
        config.version = msiVersion;
        if (Array.isArray(config.app?.windows)) {
          for (const windowConfig of config.app.windows) {
            if (windowConfig.title) {
              windowConfig.title = locale.windowTitle;
            }
          }
        }
        if (!config.bundle) {
          config.bundle = {};
        }
        if (!config.bundle.windows) {
          config.bundle.windows = {};
        }
        if (!config.bundle.windows.wix) {
          config.bundle.windows.wix = {};
        }
        config.bundle.windows.webviewInstallMode = {
          type: target.type
        };
        config.bundle.windows.wix.upgradeCode = WIX_UPGRADE_CODE;
        config.bundle.windows.wix.language = [locale.language];
        config.bundle.targets = ["msi"];
        writeJson(tauriConfigPath, config);

        // Clean old bundle output directory to avoid picking up old files
        const msiDir = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'msi');
        if (fs.existsSync(msiDir)) {
          console.log(`正在清理旧的打包输出: ${msiDir}`);
          fs.rmSync(msiDir, { recursive: true, force: true });
        }

        // Run tauri build
        // 设置 BUILD_RELEASES_MODE 避免 posttauri 钩子 (move-bundles.js) 重复复制
        process.env.BUILD_RELEASES_MODE = 'true';
        runCommand('npm run tauri build', rootDir);

        // Locate the built installer in msi directory
        if (!fs.existsSync(msiDir)) {
          throw new Error(`找不到构建输出目录: ${msiDir}`);
        }

        const files = fs.readdirSync(msiDir);
        const msiFiles = files.filter(f => f.endsWith('.msi'));

        if (msiFiles.length === 0) {
          throw new Error(`在 ${msiDir} 中未找到生成的 .msi 安装包`);
        }

        // We expect only one MSI, but process all .msi found just in case
        for (const msiFile of msiFiles) {
          const srcPath = path.join(msiDir, msiFile);
          
          // Target name formatting: replace spaces with dots, and append -suffix before .msi
          // e.g. "弦予音乐_1.1.2_x64_zh-CN.msi" -> "弦予音乐_1.1.2_x64_zh-CN-standard.msi"
          let destName = msiFile.replace(/\s+/g, '.');
          if (destName.endsWith('.msi')) {
            destName = destName.replace(/\.msi$/, `-${target.suffix}.msi`);
          } else {
            destName = `${destName}-${target.suffix}`;
          }

          const destPath = path.join(outputDir, destName);
          console.log(`复制并重命名安装包:`);
          console.log(`  源文件: ${srcPath}`);
          console.log(`  目标文件: ${destPath}`);
          fs.copyFileSync(srcPath, destPath);
        }
        
        console.log(`构建成功: ${target.label} / ${locale.label}`);
      }
    }

    console.log(`\n==================================================`);
    console.log(`所有构建任务完成！安装包已保存至: ${outputDir}`);
    console.log(`==================================================`);

  } catch (error) {
    console.error('打包过程中出错:', error);
    process.exitCode = 1;
  } finally {
    // Restore tauri.conf.json
    console.log('正在恢复 original tauri.conf.json...');
    fs.writeFileSync(tauriConfigPath, originalConfigContent, 'utf8');
  }
}

main();
