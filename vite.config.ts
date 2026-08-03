

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [vue(), wasm(), topLevelAwait()],
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // 框架核心
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          // PIXI 渲染引擎（流光背景）
          'vendor-pixi': [
            '@pixi/app',
            '@pixi/core',
            '@pixi/display',
            '@pixi/sprite',
            '@pixi/filter-blur',
            '@pixi/filter-bulge-pinch',
            '@pixi/filter-color-matrix',
          ],
          // Apple Music 风格歌词
          'vendor-amll': [
            '@applemusic-like-lyrics/core',
            '@applemusic-like-lyrics/lyric',
            '@applemusic-like-lyrics/vue',
          ],
          // 工具库
          'vendor-utils': [
            'axios',
            'cheerio',
            'crypto-js',
            'blueimp-md5',
            'big-integer',
            'dayjs',
            'he',
            'qs',
            'pinyin-pro',
          ],
          // Tauri API
          'vendor-tauri': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-global-shortcut',
            '@tauri-apps/plugin-http',
            '@tauri-apps/plugin-opener',
          ],
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
