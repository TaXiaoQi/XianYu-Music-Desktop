

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [vue(), wasm(), topLevelAwait()],
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
          if (id.includes('/vue/') || id.includes('/vue-router/') || id.includes('/pinia/')) {
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
          if (id.includes('/axios/') || id.includes('/qs/')) {
            return 'vendor-http';
          }
          if (id.includes('/dayjs/') || id.includes('/he/') || id.includes('/pinyin-pro/')) {
            return 'vendor-utils';
          }
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
