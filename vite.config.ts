

import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

const preserveRuntimeThemeAlpha = (): Plugin => ({
  name: 'xianyu-preserve-runtime-theme-alpha',
  enforce: 'post' as const,
  generateBundle(_options, bundle) {
    Object.values(bundle).forEach((asset) => {
      if (asset.type !== 'asset' || !asset.fileName.endsWith('.css') || typeof asset.source !== 'string') {
        return;
      }

      asset.source = asset.source.replace(
        /:#ec4141([0-9a-f]{2})(?=!important|[;}])/gi,
        (_match, alphaHex) => `:rgb(var(--theme-color-rgb) / ${(Number.parseInt(alphaHex, 16) / 255).toFixed(4)})`,
      );
    });
  },
});

export default defineConfig(async () => ({
  plugins: [vue(), wasm(), topLevelAwait(), preserveRuntimeThemeAlpha()],
  resolve: {
    alias: {
      path: fileURLToPath(new URL('./src/shims/pathBrowser.ts', import.meta.url)),
    },
  },
  // Web Worker 配置：插件沙箱使用 ES 模块格式的 Worker
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    // 桌面端 Tauri 包本地加载资源，当前主包约 1.6 MB；使用显式预算替代 Web 默认阈值。
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }
          if (id.includes('/@pixi/')) {
            return 'vendor-pixi';
          }
          if (id.includes('/@applemusic-like-lyrics/')) {
            return 'vendor-amll';
          }
          if (id.includes('/@tauri-apps/')) {
            return 'vendor-tauri';
          }
          // Vue 框架：主包是薄壳（re-export 存根），真正运行时在 /@vue/* 子包。
          // 二者必须同 chunk，否则正式构建跨 chunk 再导出会在 DOM 卸载路径触发
          // `remove` 时 parentNode 已为 null 的竞态崩溃（dev 常不触发）。
          if (
            id.includes('/@vue/')
            || id.includes('/vue/')
            || id.includes('/vue-router/')
            || id.includes('/pinia/')
          ) {
            return 'vendor-vue';
          }
          if (
            id.includes('/cheerio/')
            || id.includes('/htmlparser2/')
            || id.includes('/domhandler/')
            || id.includes('/domutils/')
            || id.includes('/css-select/')
            || id.includes('/parse5/')
            || id.includes('/entities/')
          ) {
            return 'vendor-html';
          }
          if (
            id.includes('/crypto-js/')
            || id.includes('/blueimp-md5/')
            || id.includes('/big-integer/')
            || id.includes('/buffer/')
          ) {
            return 'vendor-crypto';
          }
          if (id.includes('/dayjs/') || id.includes('/he/') || id.includes('/pinyin-pro/')) {
            return 'vendor-utils';
          }
          // 其余第三方库统一收入 vendor-misc，避免 node_modules 撑大入口 chunk。
          // 注意：axios/qs、cheerio、crypto-js 等有相互依赖的库统一并入 misc，
          // 若拆成独立 chunk 会与 misc 形成循环依赖、触发 Rollup 的循环 chunk 告警。
          return 'vendor-misc';
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
