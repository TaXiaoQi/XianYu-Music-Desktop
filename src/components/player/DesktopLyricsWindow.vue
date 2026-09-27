<script setup lang="ts">
import {
  computed, ref,
} from 'vue';

import DesktopLyricsToolbar from './DesktopLyricsToolbar.vue';
import {
  useDesktopLyricsDisplay,
} from '../../composables/useDesktopLyricsDisplay';
import {
  useDesktopLyricsWindowController,
} from '../../composables/useDesktopLyricsWindowController';

// 拖拽投影的显隐由窗口控制器在指针事件里回写
const dragShadowVisible = ref(false);

// 显示层状态：解构时重命名以贴合本组件内的语义
const {
  playbackTime: clockRef,
  isPlaying: playingRef,
  settings: prefs,
  lyricsAlignmentClass: alignmentClass,
  fallbackStateText: placeholderText,
  lyricsPlayerStyle: playerVars,
  widgetStyle: widgetVars,
  activeLyricLine: currentLine,
  isFavorite: favorited,
  blockTransitionKey: blockKey,
  visibleLyricLines: displayRows,
  blockStyle: blockVars,
  handlePayload: applyState,
  handlePlaybackPayload: applyPlayback,
  emitAction: sendAction,
  getWordStyle: mainWordStyle,
  getRomajiWordStyle: romajiWordStyle,
  getRomajiLineStyle: romajiLineStyle,
} = useDesktopLyricsDisplay(dragShadowVisible);

// 窗口控制层：悬浮显隐、拖拽与锁定交互
const desktopWindowController = useDesktopLyricsWindowController({
  showDragShadow: dragShadowVisible, settings: prefs, playbackTime: clockRef,
  isPlaying: playingRef, handlePayload: applyState, handlePlaybackPayload: applyPlayback,
});
const { isSystemHidden, isSurfaceVisible, isCursorOverLockButton, widgetShellStyle } = desktopWindowController;
const { handlePointerEnter, handlePointerMove, handlePointerLeave, startWindowDrag } = desktopWindowController;

// 工具栏悬浮显隐：表面可见，或锁定状态下指针悬停锁按钮
const toolbarStateClass = computed(() => ({
  'desktop-widget-toolbar--visible': isSurfaceVisible.value || (prefs.value.isLocked && isCursorOverLockButton.value),
}));

// 主题面板：拖拽时压暗，表面可见时铺底色
const widgetStateClass = computed(() => [
  alignmentClass.value,
  {
    'desktop-widget--dragging': dragShadowVisible.value,
    'desktop-widget--surface-visible': isSurfaceVisible.value,
  },
]);

// 行级状态类：激活/次行/双行阶梯布局
const rowStateClass = (row: { active: boolean; lineIndex: number }) => ({
  'desktop-lyric-row--active': row.active,
  'desktop-lyric-row--inactive': !row.active,
  'desktop-lyric-row--second-line': prefs.value.showDoubleLine && !row.active,
  'desktop-lyric-row--stair-left': prefs.value.showDoubleLine && row.lineIndex % 2 === 0,
  'desktop-lyric-row--stair-right': prefs.value.showDoubleLine && row.lineIndex % 2 === 1,
});

// 行/词/副行的过渡 key，与行内容一一对应
const rowKey = (row: { line: { time: number; text: string }; lineIndex: number }) =>
  `${row.line.time}:${row.line.text}:${row.lineIndex}`;
const wordKey = (word: { start: number; end: number }, index: number) => `${word.start}-${word.end}-${index}`;
const subKey = (row: { lineIndex: number }, sub: { kind: string; text: string }) =>
  `${row.lineIndex}:${sub.kind}:${sub.text}`;
</script>

<template>
  <div
    class="desktop-lyrics-window h-screen w-screen overflow-visible bg-transparent"
  >
    <div
      class="flex h-full w-full items-center justify-center overflow-visible p-0"
    >
      <div
        class="relative desktop-widget-shell h-full w-full transition-all duration-300" :style="widgetShellStyle"
        @mousemove="handlePointerMove" @mouseenter="handlePointerEnter" @mouseleave="handlePointerLeave"
      >
        <DesktopLyricsToolbar class="desktop-widget-toolbar" :class="toolbarStateClass"
          :is-playing="playingRef" :is-favorite="favorited" :is-locked="prefs.isLocked"
          :is-hovering-lock="isCursorOverLockButton" @action="sendAction"
        />

        <div
          class="desktop-widget relative flex h-full w-full select-none flex-col overflow-hidden" :class="widgetStateClass" :style="widgetVars" @mousedown="startWindowDrag"
        >
          <div class="desktop-lyrics-body" :style="playerVars">
            <div class="desktop-lyrics-host h-full min-h-0 w-full min-w-0" :class="alignmentClass">
              <div class="h-full min-h-0 w-full min-w-0 desktop-lyrics-mask-shell">
                <div class="h-full min-h-0 w-full min-w-0 desktop-lyrics-position-frame">
                  <transition mode="out-in" name="desktop-block">
                    <div v-if="currentLine" :key="blockKey" class="desktop-lyric-block" :style="blockVars">
                      <transition-group name="desktop-line" tag="div" class="desktop-lyric-rows">
                        <div v-for="row in displayRows" :key="rowKey(row)" class="desktop-lyric-row" :class="rowStateClass(row)">
                          <div class="desktop-lyric-main" :class="{ 'desktop-lyric-main--solid': !row.words.length, 'desktop-lyric-main--inactive': !row.active }">
                            <template v-if="row.words.length">
                              <span v-for="(word, wordIndex) in row.words" :key="wordKey(word, wordIndex)" class="desktop-lyric-word" :class="{ 'desktop-lyric-word--with-romaji': row.hasAlignedRomaji }">
                                <span class="desktop-lyric-word-main" :style="row.active ? mainWordStyle(word.start, word.end) : undefined">{{ word.text }}</span>
                                <span v-if="row.hasAlignedRomaji" class="desktop-lyric-word-romaji" :style="row.active ? romajiWordStyle(word.start, word.end) : undefined">{{ word.romaji?.trim() }}</span>
                              </span>
                            </template>
                            <template v-else>{{ row.line.text }}</template>
                          </div>

                          <div v-for="sub in row.secondaryLines" :key="subKey(row, sub)" class="desktop-lyric-sub" :class="`desktop-lyric-sub--${sub.kind}`"
                            :style="sub.kind === 'romaji' && row.active ? romajiLineStyle(row.line, row.lineIndex) : undefined">{{ sub.text }}</div>
                        </div>
                      </transition-group>
                    </div>

                    <div v-else :key="'empty-' + blockKey" class="flex h-full items-center justify-center text-center desktop-empty-state">
                      {{ placeholderText }}
                    </div>
                  </transition>
                </div>
              </div>
            </div>
          </div>

          <div v-if="isSystemHidden" class="desktop-system-hide-indicator">
            Fullscreen app detected</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.desktop-lyrics-window { background: transparent; }

.desktop-widget-shell { overflow: visible; will-change: opacity, transform; }

/* 工具栏默认隐藏，仅悬浮时淡入 */
.desktop-widget-toolbar {
  position: absolute; inset: 0; z-index: 20;
  opacity: 0; pointer-events: none; transition: opacity 200ms ease;
}

.desktop-widget-toolbar--visible { opacity: 1; }

/* 主题面板：透明底 + 悬浮/拖拽时的渐变毛玻璃 */
.desktop-widget {
  position: absolute; inset: 0; overflow: hidden;
  border: 1px solid transparent; border-radius: 0;
  background: transparent; box-shadow: none;
  backdrop-filter: none; -webkit-backdrop-filter: none;
  transition: background 220ms ease, box-shadow 220ms ease, border-color 220ms ease, border-radius 220ms ease, outline-color 220ms ease;
}

.desktop-widget--surface-visible {
  border-radius: 14px; background: linear-gradient(180deg, rgba(45, 46, 50, 0.88), rgba(28, 29, 32, 0.88));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 18px 48px rgba(0, 0, 0, 0.32), 0 6px 18px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(255, 255, 255, 0.07);
}

.desktop-widget::before { content: none; }

.desktop-widget--dragging { backdrop-filter: none; -webkit-backdrop-filter: none; }

/* 歌词主体：垂直居中的弹性容器 */
.desktop-lyrics-body {
  flex: 1 1 auto; min-height: 0; height: 100%;
  display: flex; align-items: center; justify-content: center;
  padding: 20px 24px; box-sizing: border-box; transition: padding 220ms ease;
}

.desktop-widget--surface-visible .desktop-lyrics-body { padding: 56px 28px 68px; }

.desktop-lyrics-host { display: flex; align-items: center; justify-content: center; }

.desktop-lyrics-mask-shell {
  position: relative; overflow: visible; isolation: isolate;
  display: flex; align-items: center; justify-content: center;
}

/* 位移层：由 CSS 变量驱动水平/垂直偏移 */
.desktop-lyrics-position-frame {
  transform: translate3d(var(--lyrics-offset-x, 0%), var(--lyrics-offset-y, 0%), 0); transition: transform 180ms ease; will-change: transform;
  display: flex; align-items: var(--lyrics-vertical-align, center); justify-content: var(--lyrics-horizontal-align, center);
  min-height: 100%; padding: 16px 0; box-sizing: border-box;
}

.desktop-lyric-block {
  width: min(100%, 1180px); max-width: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: calc(0.22rem * var(--desktop-line-gap, 1)); text-align: var(--lyrics-text-align, center);
  font-family: var(--lyrics-font-family, system-ui, sans-serif); transform-origin: var(--lyrics-line-transform-origin, 50%) center;
  -webkit-text-stroke: var(--desktop-text-outline-width, 0px) var(--desktop-text-outline-color, #000000); paint-order: stroke fill;
  transition: -webkit-text-stroke-width 180ms ease;
}

.desktop-lyric-rows {
  position: relative; width: 100%;
  display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: calc(0.22rem * var(--desktop-line-gap, 1));
}

.desktop-lyric-row {
  width: 100%; display: flex; flex-direction: column;
  gap: calc(0.12rem * var(--desktop-line-gap, 1)); opacity: 1;
  transform: translate3d(0, 0, 0) scale(1); filter: none; will-change: opacity, transform, filter;
  transition: opacity 480ms cubic-bezier(0.22, 1, 0.36, 1), transform 560ms cubic-bezier(0.22, 1, 0.36, 1), filter 480ms ease;
}

/* 双行切换时整行的进出场 */
.desktop-line-move, .desktop-line-enter-active, .desktop-line-leave-active {
  transition: opacity 520ms cubic-bezier(0.22, 1, 0.36, 1), transform 640ms cubic-bezier(0.22, 1, 0.36, 1), filter 520ms ease;
}

.desktop-line-enter-from { opacity: 0; transform: translate3d(0, 12px, 0) scale(0.985); filter: blur(6px); }

.desktop-line-leave-to { opacity: 0; transform: translate3d(0, -12px, 0) scale(0.985); filter: blur(6px); }

.desktop-line-leave-active {
  position: absolute; inset-inline: 0;
}

.desktop-lyric-row--active { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }

.desktop-lyric-row--inactive { opacity: 0.74; transform: translate3d(0, 2px, 0) scale(0.992); filter: saturate(0.94); }

.desktop-lyric-row.desktop-line-enter-from { opacity: 0; transform: translate3d(0, 12px, 0) scale(0.985); filter: blur(6px); }

.desktop-lyric-row.desktop-line-leave-to { opacity: 0; transform: translate3d(0, -12px, 0) scale(0.985); filter: blur(6px); }

.desktop-lyric-row.desktop-line-leave-active { position: absolute; inset-inline: 0; pointer-events: none; z-index: 0; }

/* 主行文本：字号随视口伸缩，阴影由设置驱动 */
.desktop-lyric-main {
  width: 100%; font-size: calc(max(26px, min(4.8vw, 6vh)) * var(--desktop-font-scale, 1)); font-weight: 700;
  line-height: 1.18; letter-spacing: 0.01em;
  color: var(--desktop-text-primary); overflow-wrap: anywhere; word-break: break-word;
  filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.55)))
    drop-shadow(0 0 var(--desktop-first-line-text-shadow-blur, 0px) rgb(var(--desktop-text-shadow-color, 0 0 0) / var(--desktop-first-line-text-shadow-alpha, 0))) drop-shadow(0 0 24px color-mix(in srgb, var(--desktop-accent-a) 14%, transparent));
  transition: color 460ms ease, font-size 560ms cubic-bezier(0.22, 1, 0.36, 1), font-weight 520ms ease, filter 460ms ease;
}

/* 次行：字号更小、透明度更高 */
.desktop-lyric-main--inactive {
  font-size: calc(max(20px, min(3.6vw, 4.8vh)) * var(--desktop-font-scale, 1)); font-weight: 650;
  color: color-mix(in srgb, var(--desktop-text-primary) 76%, transparent); filter: drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 var(--desktop-second-line-text-shadow-blur, 0px) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.86))) drop-shadow(0 0 18px color-mix(in srgb, var(--desktop-accent-c) 10%, transparent));
}

/* 纯色主行（关闭逐字特效时） */
.desktop-lyric-main--solid {
  color: var(--desktop-lyric-solid-color, var(--desktop-text-primary)); filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.55)))
    drop-shadow(0 0 var(--desktop-first-line-text-shadow-blur, 0px) rgb(var(--desktop-text-shadow-color, 0 0 0) / var(--desktop-first-line-text-shadow-alpha, 0))) drop-shadow(0 0 24px color-mix(in srgb, var(--desktop-lyric-solid-color, var(--desktop-accent-a)) 22%, transparent));
}

.desktop-lyric-main--solid.desktop-lyric-main--inactive {
  color: color-mix(in srgb, var(--desktop-lyric-solid-color, var(--desktop-text-primary)) 76%, transparent); filter: drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 var(--desktop-second-line-text-shadow-blur, 0px) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.86))) drop-shadow(0 0 18px color-mix(in srgb, var(--desktop-lyric-solid-color, var(--desktop-accent-c)) 14%, transparent));
}

.desktop-lyric-word {
  display: inline-block; white-space: pre-wrap;
  transition: color 420ms ease, opacity 420ms ease, filter 260ms linear, text-shadow 260ms linear;
}

/* 词元下方悬挂罗马音时的纵向排布 */
.desktop-lyric-word--with-romaji {
  display: inline-flex; flex-direction: column; align-items: center; justify-content: flex-end;
  text-align: center; vertical-align: bottom; white-space: nowrap;
}

.desktop-lyric-word-main { display: inline-block; white-space: pre-wrap; }

.desktop-lyric-word-romaji {
  display: block; margin-top: 0.08em;
  color: var(--desktop-romaji-unplayed-color); font-size: 0.46em; font-weight: 650;
  line-height: 1.05; letter-spacing: 0; white-space: pre;
  filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.86))) drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent));
}

/* 副行（罗马音 / 翻译） */
.desktop-lyric-sub {
  width: 100%; font-size: calc(max(14px, min(2.25vw, 2.75vh)) * var(--desktop-sub-font-scale, var(--desktop-font-scale, 1)));
  line-height: 1.36; letter-spacing: 0.03em; overflow-wrap: anywhere; word-break: break-word;
  transition: color 460ms ease, opacity 460ms ease, filter 460ms ease, transform 500ms ease;
}

.desktop-lyric-sub--romaji {
  color: var(--desktop-romaji-unplayed-color); filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.86))) drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent));
}

.desktop-lyric-sub--translation {
  color: var(--desktop-translation-color); filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.82))) drop-shadow(0 0 12px color-mix(in srgb, var(--desktop-translation-color) 18%, transparent));
}

/* 双行布局下，次行副行改用第二行阴影参数 */
.desktop-lyric-row--second-line .desktop-lyric-sub--romaji {
  filter: drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-second-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.86))) drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent));
}

.desktop-lyric-row--second-line .desktop-lyric-sub--translation {
  filter: drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-second-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.82))) drop-shadow(0 0 12px color-mix(in srgb, var(--desktop-translation-color) 18%, transparent));
}

/* 对齐档位：以 CSS 变量下发布局参数 */
.lyrics-align-left { --lyrics-horizontal-align: center; --lyrics-vertical-align: center; --lyrics-text-align: left; --lyrics-line-transform-origin: 0%; }

.lyrics-align-center { --lyrics-horizontal-align: center; --lyrics-vertical-align: center; --lyrics-text-align: center; --lyrics-line-transform-origin: 50%; }

.lyrics-align-right { --lyrics-horizontal-align: center; --lyrics-vertical-align: center; --lyrics-text-align: right; --lyrics-line-transform-origin: 100%; }

/* 对角布局：两行分别贴左上/右下 */
.lyrics-align-split-corners { --lyrics-horizontal-align: center; --lyrics-vertical-align: stretch; --lyrics-text-align: left; --lyrics-line-transform-origin: 0%; }

.lyrics-align-split-corners .desktop-lyric-block {
  width: 100%; height: 100%; max-width: 100%; align-items: stretch; justify-content: center; gap: 0;
}

.lyrics-align-split-corners .desktop-lyric-rows { height: 100%; justify-content: space-between; gap: 0; }

.lyrics-align-split-corners .desktop-lyric-row--stair-left { text-align: left; transform-origin: 0% center; }

.lyrics-align-split-corners .desktop-lyric-row--stair-right {
  --lyrics-text-align: right; --lyrics-line-transform-origin: 100%;
  text-align: right; transform-origin: 100% center;
}

/* 无歌词占位 */
.desktop-empty-state {
  color: var(--desktop-text-secondary); font-size: 1.1rem; font-weight: 600; letter-spacing: 0.02em;
  -webkit-text-stroke: var(--desktop-text-outline-width, 0px) var(--desktop-text-outline-color, #000000); paint-order: stroke fill;
  filter: drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.82))) drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-accent-a) 12%, transparent));
}

.desktop-block-enter-active, .desktop-block-leave-active {
  transition: opacity 180ms ease, transform 220ms ease,
    filter 220ms ease;
}

.desktop-block-enter-from, .desktop-block-leave-to {
  opacity: 0; transform: translateY(12px) scale(0.985); filter: blur(8px);
}

.desktop-system-hide-indicator {
  position: absolute; right: 16px; bottom: 12px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: rgba(255, 255, 255, 0.55); pointer-events: none;
}
</style>
