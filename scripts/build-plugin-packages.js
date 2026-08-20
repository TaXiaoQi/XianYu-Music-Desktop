/**
 * 插件宿主依赖包打包脚本 —— esbuild 生成单个 IIFE bundle
 *
 * 产物写入 src-tauri/src/plugin_host/packages_bundle.js，
 * 由 Rust 侧 include_str! 嵌入，在每个 QuickJS 插件上下文中执行，
 * 将 cheerio/crypto-js/axios 等依赖挂到 globalThis.__xyPackages。
 *
 * 用法：npm run build:plugin-packages
 */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryFile = resolve(rootDir, 'scripts/plugin-packages-entry.js');
const outFile = resolve(rootDir, 'src-tauri/src/plugin_host/packages_bundle.js');

mkdirSync(dirname(outFile), { recursive: true });

const result = await build({
  entryPoints: [entryFile],
  outfile: outFile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  // QuickJS 无 Node 环境：把 Node 全局改写为 QuickJS 等价物
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
  },
});

if (result.errors.length > 0) {
  process.exitCode = 1;
} else {
  const kb = (result.outputFiles?.[0]?.contents?.length ?? 0) / 1024;
  console.log(`plugin packages bundle: ${outFile} (${kb.toFixed(1)} KB)`);
}
