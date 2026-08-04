<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { LyricLine as AmlLyricLine, LyricLineMouseEvent } from '@applemusic-like-lyrics/core';
import {
  convertLyricsToAmlLines,
  DEFAULT_PLAYER_ALIGNMENT,
  DEFAULT_PLAYER_FONT_PRESET,
  DEFAULT_PLAYER_FONT_SCALE,
  DEFAULT_PLAYER_LINE_GAP,
  DEFAULT_PLAYER_OFFSET_X,
  DEFAULT_PLAYER_OFFSET_Y,
  getLyricsFontFamily,
  LYRICS_FONT_OPTIONS,
  MAX_PLAYER_FONT_SCALE,
  MAX_PLAYER_LINE_GAP,
  MAX_PLAYER_OFFSET_X,
  MAX_PLAYER_OFFSET_Y,
  MIN_PLAYER_FONT_SCALE,
  MIN_PLAYER_LINE_GAP,
  MIN_PLAYER_OFFSET_X,
  MIN_PLAYER_OFFSET_Y,
  loadSystemLyricsFonts,
  normalizeLyricsFontPreset,
  systemLyricsFontOptions,
  type LyricsFontPreset,
  type LyricsPlayerAlignment,
  useLyrics,
} from '../../composables/lyrics';
import { usePlayer } from '../../composables/player';
import { useSettingsStore } from '../../features/settings/store';
// [修复防御]: AmlLyricPlayer 静态导入会拉入 PatchedLyricPlayer → @applemusic-like-lyrics/core → @pixi/*
// 整条重型依赖链到主入口 chunk，导致启动时强制加载 PIXI/AMLL（200-400KB+ JS）。
// 改为 defineAsyncComponent 后，该依赖链仅在 PlayerDetail 打开且渲染歌词时按需加载，
// 切断 dist/index.html 对 vendor-amll/vendor-pixi 的 modulepreload，显著缩短启动 TTI。
//
// [修复防御]: 配置 errorComponent + timeout + onError 重试，避免 Vite HMR 热更新或
// 依赖预构建未完成时 "Failed to fetch dynamically imported module" 导致白屏。
const AmlLyricPlayer = defineAsyncComponent({
  loader: () => import('./AmlLyricPlayer.vue'),
  // 用 h() 渲染函数而非字符串 template：避免依赖 Vue 运行时编译器
  // （runtime-only 构建不含编译器，字符串 template 会触发警告）。
  loadingComponent: () => h('div', { class: 'amll-loading-placeholder' }),
  errorComponent: () =>
    h('div', { class: 'amll-load-error' }, '歌词组件加载失败，请刷新'),
  delay: 0,
  timeout: 10000,
});
import { getPlaybackSeekSecondsForAmlLine } from './amllSeekLayout';
import { getLyricsStylePanelPosition } from './lyricsStylePanelPosition';

const props = defineProps<{
  coverHidden?: boolean;
  disabled?: boolean;
}>();

const {
  parsedLyrics,
  lyricsSettings,
  lyricsStatus,
  showLyricsPlayerSettingsPanel,
} = useLyrics();
const { playAt, currentTime, isPlaying } = usePlayer();
const { audioDelay } = storeToRefs(useSettingsStore());

const FONT_SCALE_STEP = 0.05;
const LINE_GAP_STEP = 0.05;
const OFFSET_STEP = 1;
const PLAYER_ALIGNMENT_OPTIONS: Array<{ value: LyricsPlayerAlignment; label: string }> = [
  { value: 'left', label: '靠左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '靠右' },
];

const fontPanelRef = ref<HTMLElement | null>(null);
const fontPresetTriggerRef = ref<HTMLElement | null>(null);
const fontPresetMenuRef = ref<HTMLElement | null>(null);
// [修复防御]: 异步组件的 InstanceType 推断会丢失，改用显式接口描述 defineExpose 暴露的方法
interface AmlLyricPlayerInstance {
  syncSeekLayout: (timeMs: number, lineIndex?: number) => void;
}
const amlPlayerRef = ref<AmlLyricPlayerInstance | null>(null);
const isFontPresetMenuOpen = ref(false);
const fontPresetMenuStyle = ref<Record<string, string>>({});

/** 歌词样式面板动态定位样式：窄窗口下自动调整，防止溢出视口 */
const fontPanelDynamicStyle = ref<Record<string, string>>({});

const fontPanelStyle = computed(() => ({
  width: 'min(320px, calc(34vw - 24px))',
  marginRight: window.innerWidth >= 1536 ? '22vw' : '14vw',
  ...fontPanelDynamicStyle.value,
}));

/** 检测歌词样式面板是否溢出视口，溢出时动态调整位置/宽度 */
function updateFontPanelPosition() {
  if (!fontPanelRef.value) return;

  const container = fontPanelRef.value.parentElement;
  if (!container) return;

  const containerRect = container.getBoundingClientRect();
  fontPanelDynamicStyle.value = getLyricsStylePanelPosition(containerRect, window.innerWidth);
}

const amllLines = computed<AmlLyricLine[]>(() => {
  return convertLyricsToAmlLines(
    parsedLyrics.value,
    lyricsSettings.showTranslation,
    lyricsSettings.showRomaji,
    lyricsSettings.enableWordEffect,
  );
});

const amllCurrentTime = computed(() => {
  return Math.max(0, Math.floor((currentTime.value - audioDelay.value) * 1000));
});

const emptyStateText = computed(() => {
  if (lyricsStatus.value === 'loading') return 'Loading lyrics...';
  if (lyricsStatus.value === 'error') return 'Lyrics unavailable';
  return 'No synchronized lyrics';
});

const fontScalePercent = computed(() => `${Math.round(lyricsSettings.playerFontScale * 100)}%`);
const lineGapPercent = computed(() => `${Math.round(lyricsSettings.playerLineGap * 100)}%`);
const horizontalOffsetPercent = computed(() => formatOffsetValue(lyricsSettings.playerOffsetX));
const verticalOffsetPercent = computed(() => formatOffsetValue(lyricsSettings.playerOffsetY));
const availableFontOptions = computed(() => [
  ...LYRICS_FONT_OPTIONS,
  ...systemLyricsFontOptions.value,
]);
const selectedFontLabel = computed(() => {
  return availableFontOptions.value.find((option) => option.value === lyricsSettings.playerFontPreset)?.label
    ?? normalizeLyricsFontPreset(lyricsSettings.playerFontPreset);
});

const fontScaleProgress = computed(() => {
  return ((lyricsSettings.playerFontScale - MIN_PLAYER_FONT_SCALE) / (MAX_PLAYER_FONT_SCALE - MIN_PLAYER_FONT_SCALE)) * 100;
});

const lineGapProgress = computed(() => {
  return ((lyricsSettings.playerLineGap - MIN_PLAYER_LINE_GAP) / (MAX_PLAYER_LINE_GAP - MIN_PLAYER_LINE_GAP)) * 100;
});

const horizontalOffsetProgress = computed(() => {
  return ((lyricsSettings.playerOffsetX - MIN_PLAYER_OFFSET_X) / (MAX_PLAYER_OFFSET_X - MIN_PLAYER_OFFSET_X)) * 100;
});

const verticalOffsetProgress = computed(() => {
  return ((lyricsSettings.playerOffsetY - MIN_PLAYER_OFFSET_Y) / (MAX_PLAYER_OFFSET_Y - MIN_PLAYER_OFFSET_Y)) * 100;
});

const lyricsAlignmentClass = computed(() => `lyrics-align-${lyricsSettings.playerAlignment}`);

const wordFadeWidth = computed(() => lyricsSettings.enableWordEffect ? 0.5 : 0);

const lyricsPlayerStyle = computed(() => ({
  '--lyrics-font-scale': lyricsSettings.playerFontScale.toString(),
  '--lyrics-font-family': getLyricsFontFamily(lyricsSettings.playerFontPreset),
  '--lyrics-offset-x': `${lyricsSettings.playerOffsetX}%`,
  '--lyrics-offset-y': `${lyricsSettings.playerOffsetY}%`,
}));

function clampFontScale(value: number) {
  return Math.min(MAX_PLAYER_FONT_SCALE, Math.max(MIN_PLAYER_FONT_SCALE, value));
}

function clampLineGap(value: number) {
  return Math.min(MAX_PLAYER_LINE_GAP, Math.max(MIN_PLAYER_LINE_GAP, value));
}

function clampOffsetX(value: number) {
  return Math.min(MAX_PLAYER_OFFSET_X, Math.max(MIN_PLAYER_OFFSET_X, value));
}

function clampOffsetY(value: number) {
  return Math.min(MAX_PLAYER_OFFSET_Y, Math.max(MIN_PLAYER_OFFSET_Y, value));
}

function formatOffsetValue(value: number) {
  return `${value > 0 ? '+' : ''}${Math.round(value)}%`;
}

function setPlayerFontScale(value: number) {
  lyricsSettings.playerFontScale = Number(clampFontScale(value).toFixed(2));
}

function setPlayerLineGap(value: number) {
  lyricsSettings.playerLineGap = Number(clampLineGap(value).toFixed(2));
}

function setPlayerOffsetX(value: number) {
  lyricsSettings.playerOffsetX = Number(clampOffsetX(value).toFixed(0));
}

function setPlayerOffsetY(value: number) {
  lyricsSettings.playerOffsetY = Number(clampOffsetY(value).toFixed(0));
}

function setPlayerAlignment(value: LyricsPlayerAlignment) {
  lyricsSettings.playerAlignment = value;
}

function setPlayerFontPreset(value: LyricsFontPreset) {
  lyricsSettings.playerFontPreset = value;
}

function adjustPlayerFontScale(delta: number) {
  setPlayerFontScale(lyricsSettings.playerFontScale + delta);
}

function resetPlayerFontScale() {
  setPlayerFontScale(DEFAULT_PLAYER_FONT_SCALE);
}

function resetPlayerLineGap() {
  setPlayerLineGap(DEFAULT_PLAYER_LINE_GAP);
}

function resetPlayerAlignment() {
  setPlayerAlignment(DEFAULT_PLAYER_ALIGNMENT);
}

function resetPlayerOffsetX() {
  setPlayerOffsetX(DEFAULT_PLAYER_OFFSET_X);
}

function resetPlayerOffsetY() {
  setPlayerOffsetY(DEFAULT_PLAYER_OFFSET_Y);
}

function resetPlayerFontPreset() {
  setPlayerFontPreset(DEFAULT_PLAYER_FONT_PRESET);
}

function toggleTranslation() {
  lyricsSettings.showTranslation = !lyricsSettings.showTranslation;
}

function toggleRomaji() {
  lyricsSettings.showRomaji = !lyricsSettings.showRomaji;
}

function toggleWordEffect() {
  lyricsSettings.enableWordEffect = !lyricsSettings.enableWordEffect;
}

function handleFontScaleInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;

  setPlayerFontScale(Number(target.value));
}

function handleLineGapInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;

  setPlayerLineGap(Number(target.value));
}

function handleOffsetXInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;

  setPlayerOffsetX(Number(target.value));
}

function handleOffsetYInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;

  setPlayerOffsetY(Number(target.value));
}

function selectFontPreset(value: LyricsFontPreset) {
  setPlayerFontPreset(normalizeLyricsFontPreset(value));
}

function updateFontPresetMenuPosition() {
  const trigger = fontPresetTriggerRef.value;
  if (!trigger) return;

  const panel = trigger.closest('.pointer-events-auto');
  if (!panel) return;

  const panelRect = panel.getBoundingClientRect();
  const menuWidth = 280;
  const gap = 0; // 8px gap for a "tightly attached" floating effect. You can change to 0 if you want it glued perfectly.
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = panelRect.right + gap;
  if (left + menuWidth > viewportWidth - 16) {
    left = Math.max(16, panelRect.left - gap - menuWidth);
  }

  const bottomDist = viewportHeight - panelRect.bottom;

  fontPresetMenuStyle.value = {
    position: 'fixed',
    left: `${Math.round(left)}px`,
    bottom: `${Math.round(bottomDist)}px`,
    width: `${menuWidth}px`,
    maxHeight: `${Math.round(Math.min(420, panelRect.bottom - 16))}px`,
  };
}

async function toggleFontPresetMenu() {
  isFontPresetMenuOpen.value = !isFontPresetMenuOpen.value;
  if (isFontPresetMenuOpen.value) {
    await nextTick();
    updateFontPresetMenuPosition();

    const menuEl = fontPresetMenuRef.value;
    if (menuEl) {
      const activeItem = menuEl.querySelector('.active-font-preset') as HTMLElement | null;
      const scrollContainer = menuEl.querySelector('.custom-scrollbar') as HTMLElement | null;
      if (activeItem && scrollContainer) {
        // Disable smooth scrolling temporarily to jump instantly
        scrollContainer.style.scrollBehavior = 'auto';
        const itemTop = activeItem.offsetTop;
        const itemHeight = activeItem.offsetHeight;
        const containerHeight = scrollContainer.clientHeight;
        scrollContainer.scrollTop = itemTop - (containerHeight / 2) + (itemHeight / 2);
        // Restore smooth scrolling if needed
        scrollContainer.style.scrollBehavior = '';
      }
    }
  }
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (fontPanelRef.value?.contains(target)) return;
  if (fontPresetMenuRef.value?.contains(target)) return;
  isFontPresetMenuOpen.value = false;
  showLyricsPlayerSettingsPanel.value = false;
}

async function handleLineClick(event: LyricLineMouseEvent) {
  const lineStartTimeMs = event.line.getLine().startTime;
  amlPlayerRef.value?.syncSeekLayout(lineStartTimeMs, event.lineIndex);

  const targetSeconds = getPlaybackSeekSecondsForAmlLine(lineStartTimeMs, audioDelay.value);
  await playAt(targetSeconds);
}

onMounted(() => {
  window.addEventListener('mousedown', handleClickOutside);
  window.addEventListener('resize', updateFontPresetMenuPosition);
  window.addEventListener('resize', updateFontPanelPosition);
  void loadSystemLyricsFonts();
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handleClickOutside);
  window.removeEventListener('resize', updateFontPresetMenuPosition);
  window.removeEventListener('resize', updateFontPanelPosition);
  showLyricsPlayerSettingsPanel.value = false;
  isFontPresetMenuOpen.value = false;
});

// 面板可见性变化时重新检测位置
watch(showLyricsPlayerSettingsPanel, async (visible) => {
  if (visible) {
    await nextTick();
    updateFontPanelPosition();
  } else {
    fontPanelDynamicStyle.value = {};
  }
});

// Hiding the cover changes the lyrics container's position and width. Recompute
// the relative offset so the settings panel stays at its viewport anchor.
watch(() => props.coverHidden, async () => {
  if (!showLyricsPlayerSettingsPanel.value) return;
  await nextTick();
  updateFontPanelPosition();
});
</script>

<template>
  <div class="group/lyrics-view relative h-full min-h-0 w-full min-w-0">
    <div
      v-show="amllLines.length > 0"
      ref="fontPanelRef"
      class="pointer-events-none absolute right-[100%] top-2 bottom-12 z-[85] flex min-h-0 min-w-[260px] max-w-[320px] flex-col justify-center"
      :style="fontPanelStyle"
    >
      <transition name="font-panel">
        <div
          v-if="showLyricsPlayerSettingsPanel"
          class="lyrics-settings-glass pointer-events-auto flex max-h-[100%] min-h-0 w-full flex-col rounded-3xl border border-white/15 text-white shadow-[0_28px_70px_rgba(0,0,0,0.48)]"
          @click.stop
          @mousedown.stop
        >
          <div class="min-h-0 overflow-y-auto px-4 py-4 custom-scrollbar">
          <div class="mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Lyrics</div>
            <div class="mt-1.5 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-medium text-white/85">字体大小</span>
                <button
                  v-if="lyricsSettings.playerFontScale !== DEFAULT_PLAYER_FONT_SCALE"
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="resetPlayerFontScale"
                  title="重置"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
              </div>
              <span class="text-xs font-medium tabular-nums text-white/60">{{ fontScalePercent }}</span>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="lyricsSettings.playerFontScale <= MIN_PLAYER_FONT_SCALE"
              @click="adjustPlayerFontScale(-FONT_SCALE_STEP)"
            >
              A-
            </button>

            <input
              class="font-size-slider h-1 flex-1 cursor-pointer appearance-none rounded-full"
              :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${fontScaleProgress}%, rgba(255,255,255,0.12) ${fontScaleProgress}%)` }"
              type="range"
              :min="MIN_PLAYER_FONT_SCALE"
              :max="MAX_PLAYER_FONT_SCALE"
              :step="FONT_SCALE_STEP"
              :value="lyricsSettings.playerFontScale"
              @input="handleFontScaleInput"
            />

            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="lyricsSettings.playerFontScale >= MAX_PLAYER_FONT_SCALE"
              @click="adjustPlayerFontScale(FONT_SCALE_STEP)"
            >
              A+
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Spacing</div>
            <div class="mt-1.5 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-medium text-white/85">歌词间距</span>
                <button
                  v-if="lyricsSettings.playerLineGap !== DEFAULT_PLAYER_LINE_GAP"
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="resetPlayerLineGap"
                  title="重置"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
              </div>
              <span class="text-xs font-medium tabular-nums text-white/60">{{ lineGapPercent }}</span>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-base font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="lyricsSettings.playerLineGap <= MIN_PLAYER_LINE_GAP"
              @click="setPlayerLineGap(lyricsSettings.playerLineGap - LINE_GAP_STEP)"
            >
              -
            </button>

            <input
              class="font-size-slider h-1 flex-1 cursor-pointer appearance-none rounded-full"
              :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${lineGapProgress}%, rgba(255,255,255,0.12) ${lineGapProgress}%)` }"
              type="range"
              :min="MIN_PLAYER_LINE_GAP"
              :max="MAX_PLAYER_LINE_GAP"
              :step="LINE_GAP_STEP"
              :value="lyricsSettings.playerLineGap"
              @input="handleLineGapInput"
            />

            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-base font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="lyricsSettings.playerLineGap >= MAX_PLAYER_LINE_GAP"
              @click="setPlayerLineGap(lyricsSettings.playerLineGap + LINE_GAP_STEP)"
            >
              +
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Subtitles</div>
            <div class="mt-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-white/85">副行显示</span>
              <span class="text-[11px] font-medium text-white/42">
                {{ Number(lyricsSettings.showTranslation) + Number(lyricsSettings.showRomaji) }}/2
              </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="flex h-10 items-center justify-center rounded-2xl border px-3 text-sm font-medium transition"
              :class="lyricsSettings.showTranslation
                ? 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'"
              @click="toggleTranslation"
            >
              显示翻译
            </button>

            <button
              type="button"
              class="flex h-10 items-center justify-center rounded-2xl border px-3 text-sm font-medium transition"
              :class="lyricsSettings.showRomaji
                ? 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'"
              @click="toggleRomaji"
            >
              显示罗马音
            </button>
          </div>

          <div class="mt-4">
            <button
              type="button"
              class="flex h-10 w-full items-center justify-center rounded-2xl border px-3 text-sm font-medium transition"
              :class="lyricsSettings.enableWordEffect
                ? 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'"
              @click="toggleWordEffect"
            >
              逐字歌词效果
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Alignment</div>
            <div class="mt-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-white/85">歌词位置</span>
              <button
                v-if="lyricsSettings.playerAlignment !== DEFAULT_PLAYER_ALIGNMENT"
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                @click="resetPlayerAlignment"
                title="Reset"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="option in PLAYER_ALIGNMENT_OPTIONS"
              :key="option.value"
              type="button"
              class="flex h-9 items-center justify-center rounded-2xl border px-3 text-xs font-medium transition"
              :class="lyricsSettings.playerAlignment === option.value
                ? 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'"
              @click="setPlayerAlignment(option.value)"
            >
              {{ option.label }}
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Offset</div>
            <div class="mt-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-white/85">歌词偏移</span>
              <div class="flex items-center gap-1">
                <button
                  v-if="lyricsSettings.playerOffsetX !== DEFAULT_PLAYER_OFFSET_X"
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="resetPlayerOffsetX"
                  title="Reset horizontal offset"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
                <button
                  v-if="lyricsSettings.playerOffsetY !== DEFAULT_PLAYER_OFFSET_Y"
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="resetPlayerOffsetY"
                  title="Reset vertical offset"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-white/70">水平</span>
                <span class="text-[11px] font-medium tabular-nums text-white/48">{{ horizontalOffsetPercent }}</span>
              </div>
              <input
                class="font-size-slider h-1 w-full cursor-pointer appearance-none rounded-full"
                :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${horizontalOffsetProgress}%, rgba(255,255,255,0.12) ${horizontalOffsetProgress}%)` }"
                type="range"
                :min="MIN_PLAYER_OFFSET_X"
                :max="MAX_PLAYER_OFFSET_X"
                :step="OFFSET_STEP"
                :value="lyricsSettings.playerOffsetX"
                @input="handleOffsetXInput"
              />
            </div>

            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-white/70">垂直</span>
                <span class="text-[11px] font-medium tabular-nums text-white/48">{{ verticalOffsetPercent }}</span>
              </div>
              <input
                class="font-size-slider h-1 w-full cursor-pointer appearance-none rounded-full"
                :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${verticalOffsetProgress}%, rgba(255,255,255,0.12) ${verticalOffsetProgress}%)` }"
                type="range"
                :min="MIN_PLAYER_OFFSET_Y"
                :max="MAX_PLAYER_OFFSET_Y"
                :step="OFFSET_STEP"
                :value="lyricsSettings.playerOffsetY"
                @input="handleOffsetYInput"
              />
            </div>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Font</div>
            <div class="mt-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-white/85">歌词字体</span>
              <button
                v-if="lyricsSettings.playerFontPreset !== DEFAULT_PLAYER_FONT_PRESET"
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                @click="resetPlayerFontPreset"
                title="Reset"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
            </div>
          </div>

          <div class="relative overflow-visible">
            <button
              ref="fontPresetTriggerRef"
              type="button"
              class="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-white transition hover:border-white/20 hover:bg-white/[0.06]"
              :class="isFontPresetMenuOpen ? 'border-white/25 bg-white/[0.08] shadow-[0_18px_36px_rgba(0,0,0,0.16)]' : ''"
              @click="toggleFontPresetMenu"
            >
              <span class="truncate">{{ selectedFontLabel }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="shrink-0 text-white/45 transition-transform duration-200"
                :class="isFontPresetMenuOpen ? 'rotate-180 text-white/70' : ''"
              >
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>

            <transition name="font-preset-menu">
              <div
                v-if="false"
                class="lyrics-settings-glass absolute left-[calc(100%+14px)] top-1/2 z-20 w-[280px] -translate-y-1/2 flex flex-col overflow-hidden rounded-3xl border border-white/15 p-2 text-white shadow-[0_28px_70px_rgba(0,0,0,0.48)]"
              >
                <div class="min-h-0 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                  <button
                    v-for="option in availableFontOptions"
                    :key="option.value"
                    type="button"
                    class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition"
                    :class="lyricsSettings.playerFontPreset === option.value
                      ? 'bg-white/[0.14] text-white'
                      : 'text-white/72 hover:bg-white/[0.07] hover:text-white'"
                    @click="selectFontPreset(option.value)"
                  >
                    <span>{{ option.label }}</span>
                    <span
                      v-if="lyricsSettings.playerFontPreset === option.value"
                      class="text-[11px] font-medium text-white/50"
                    >
                      当前
                    </span>
                  </button>
                </div>
              </div>
            </transition>
          </div>

          </div>
        </div>
      </transition>
    </div>

    <div
      v-if="amllLines.length > 0"
      class="lyrics-mask-shell h-full min-h-0 w-full min-w-0"
      :class="lyricsAlignmentClass"
      :style="lyricsPlayerStyle"
    >
      <div class="lyrics-position-frame h-full min-h-0 w-full min-w-0">
        <AmlLyricPlayer
          ref="amlPlayerRef"
          class="amll-host h-full min-h-0 w-full min-w-0"
          :lyric-lines="amllLines"
          :current-time="amllCurrentTime"
          :playing="isPlaying"
          :disabled="disabled"
          :layout-version="lyricsSettings.playerFontPreset"
          align-anchor="center"
          :align-position="0.42"
          :enable-spring="true"
          :enable-blur="true"
          :enable-scale="true"
          :hide-passed-lines="false"
          :word-fade-width="wordFadeWidth"
          :line-gap="lyricsSettings.playerLineGap"
          @line-click="handleLineClick"
        />
      </div>
    </div>

    <div
      v-else
      class="no-lyrics flex h-full items-center justify-center text-2xl font-medium text-white/30"
    >
      {{ emptyStateText }}
    </div>

    <Teleport to="body">
      <transition name="font-preset-menu">
        <div
          v-if="isFontPresetMenuOpen"
          ref="fontPresetMenuRef"
          class="lyrics-settings-glass z-[120] flex flex-col overflow-hidden rounded-3xl border border-white/15 p-2 text-white shadow-[0_28px_70px_rgba(0,0,0,0.48)]"
          :style="fontPresetMenuStyle"
          @click.stop
          @mousedown.stop
        >
          <div class="min-h-0 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
            <button
              v-for="option in availableFontOptions"
              :key="option.value"
              type="button"
              class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition"
              :class="lyricsSettings.playerFontPreset === option.value
                ? 'bg-white/[0.14] text-white active-font-preset'
                : 'text-white/72 hover:bg-white/[0.07] hover:text-white'"
              @click="selectFontPreset(option.value)"
            >
              <span>{{ option.label }}</span>
              <span
                v-if="lyricsSettings.playerFontPreset === option.value"
                class="text-[11px] font-medium text-white/50"
              >
                当前
              </span>
            </button>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.lyrics-settings-glass {
  background: rgba(8, 8, 12, 0.74);
  -webkit-backdrop-filter: blur(32px) saturate(135%);
  backdrop-filter: blur(32px) saturate(135%);
}

.lyrics-mask-shell {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  --lyrics-edge-fade: 12%;
  --lyrics-edge-softness: 8%;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.24) var(--lyrics-edge-softness),
    black var(--lyrics-edge-fade),
    black calc(100% - var(--lyrics-edge-fade)),
    rgba(0, 0, 0, 0.24) calc(100% - var(--lyrics-edge-softness)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.24) var(--lyrics-edge-softness),
    black var(--lyrics-edge-fade),
    black calc(100% - var(--lyrics-edge-fade)),
    rgba(0, 0, 0, 0.24) calc(100% - var(--lyrics-edge-softness)),
    transparent 100%
  );
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}

.amll-host {
  min-width: 0;
  min-height: 0;
}

.lyrics-position-frame {
  transform: translate3d(var(--lyrics-offset-x, 0%), var(--lyrics-offset-y, 0%), 0);
  transition: transform 180ms ease;
  will-change: transform;
}

.amll-host :deep(.amll-lyric-player) {
  --amll-lp-color: rgba(255, 255, 255, 0.95);
  --amll-lp-bg-color: transparent;
  --amll-lp-font-size: calc(max(max(5vh, 2.5vw), 12px) * var(--lyrics-font-scale, 1));
  font-family: var(--lyrics-font-family, system-ui, sans-serif);
}

.amll-host :deep(.amll-lyric-player [class*="_lyricLine_"]) {
  text-align: var(--lyrics-text-align, left);
  transform-origin: var(--lyrics-line-transform-origin, 0%) center;
  display: flex;
  flex-direction: column;
}

.amll-host :deep(.amll-lyric-player [class*="_lyricLine_"] > :nth-child(2)) {
  order: 2;
}

.amll-host :deep(.amll-lyric-player [class*="_lyricLine_"] > :nth-child(3)) {
  order: 1;
}

.lyrics-align-left {
  --lyrics-text-align: left;
  --lyrics-line-transform-origin: 0%;
}

.lyrics-align-center {
  --lyrics-text-align: center;
  --lyrics-line-transform-origin: 50%;
}

.lyrics-align-right {
  --lyrics-text-align: right;
  --lyrics-line-transform-origin: 100%;
}

@media screen and (max-width: 768px) {
  .amll-host :deep(.amll-lyric-player) {
    --amll-lp-font-size: calc(max(8vw, 12px) * var(--lyrics-font-scale, 1));
  }
}

.font-panel-enter-active,
.font-panel-leave-active {
  transition: opacity 180ms ease, transform 180ms ease, backdrop-filter 180ms ease;
  will-change: transform, opacity;
}

.font-panel-enter-from,
.font-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
  backdrop-filter: blur(0px);
}

.font-preset-menu-enter-active,
.font-preset-menu-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.font-preset-menu-enter-from,
.font-preset-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.font-size-slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0,0,0,0.05);
}

.font-size-slider::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0,0,0,0.05);
}

.font-size-slider::-moz-range-track {
  height: 4px;
  border-radius: 9999px;
  background: transparent;
}
</style>
