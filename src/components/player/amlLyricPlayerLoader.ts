// AML 歌词播放器（AmlLyricPlayer.vue）的统一异步加载入口。
//
// 背景：AmlLyricPlayer.vue 静态导入会拉入 PatchedLyricPlayer →
// @applemusic-like-lyrics/core → @pixi/* 整条重型依赖链（200-400KB+ JS）。
// 若直接静态引入主入口 chunk，会强制在启动时加载 PIXI/AMLL，拖慢首屏 TTI。
//
// 因此：
// - LyricsView.vue 通过 defineAsyncComponent({ loader: loadAmlLyricPlayer })
//   在 PlayerDetail 打开且需要渲染歌词时才按需加载。
// - PlayerDetail.vue / playerPlayback.ts 在用户即将进入歌词页（打开详情页或
//   播放在线歌曲）时调用 preloadAmlLyricPlayer() 预热缓存，使后续真正渲染时
//   loader 命中已缓存的 Promise，避免可见的加载等待。
//
// 关键：所有加载请求共享同一个 Promise，保证不重复发起 import()。

type AmlLyricPlayerModule = typeof import('./AmlLyricPlayer.vue');

let loaderPromise: Promise<AmlLyricPlayerModule> | null = null;

/**
 * 异步加载 AmlLyricPlayer 组件模块（结果会被缓存）。
 * 作为 defineAsyncComponent 的 loader 使用，Vue 会自动解包 `.default`。
 */
export function loadAmlLyricPlayer(): Promise<AmlLyricPlayerModule> {
  if (!loaderPromise) {
    loaderPromise = import('./AmlLyricPlayer.vue');
  }
  return loaderPromise;
}

/**
 * 预加载 AmlLyricPlayer 组件（命中/填充共享缓存）。
 * 供 fire-and-forget 调用：失败时不抛错，仅清空缓存以便下次重试，
 * 真正渲染时 defineAsyncComponent 会重新触发 loader。
 */
export async function preloadAmlLyricPlayer(): Promise<void> {
  try {
    await loadAmlLyricPlayer();
  } catch {
    loaderPromise = null;
  }
}
