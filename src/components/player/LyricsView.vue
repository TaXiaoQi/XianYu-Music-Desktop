<script setup lang="ts"> // 实现
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'; // 实现
import { storeToRefs } from 'pinia'; // 实现
import {
  convertLyricsToAmlLines, getLyricsFontFamily, loadSystemLyricsFonts, normalizeLyricsFontPreset, systemLyricsFontOptions,
  LYRICS_FONT_OPTIONS, DEFAULT_PLAYER_ALIGNMENT, DEFAULT_PLAYER_FONT_PRESET, DEFAULT_PLAYER_FONT_SCALE,
  DEFAULT_PLAYER_LINE_GAP, DEFAULT_PLAYER_OFFSET_X, DEFAULT_PLAYER_OFFSET_Y, DEFAULT_BACKGROUND_BLUR,
  DEFAULT_CUSTOM_BACKGROUND_IMAGE, MIN_BACKGROUND_BLUR, MAX_BACKGROUND_BLUR, MIN_PLAYER_FONT_SCALE,
  MAX_PLAYER_FONT_SCALE, MIN_PLAYER_LINE_GAP, MAX_PLAYER_LINE_GAP, MIN_PLAYER_OFFSET_X, MAX_PLAYER_OFFSET_X,
  MIN_PLAYER_OFFSET_Y, MAX_PLAYER_OFFSET_Y,
  type AmlPlayerLine, type LyricsFontPreset, type LyricsPlayerAlignment, useLyrics,
} from '../../composables/lyrics'; // 实现
import { usePlayer } from '../../features/playback';
import { useSettingsStore } from '../../features/settings/store'; // 实现
import { fileApi } from '../../services/tauri/fileApi';
import { useToast } from '../../composables/toast';
const WordLyricPlayer = defineAsyncComponent({
  loader: () => import('./WordLyricPlayer.vue'),
  loadingComponent: () => h('div', { class: 'word-lyric-loading-placeholder' }),
  errorComponent: () => // 实现
    h('div', { class: 'word-lyric-load-error' }, '歌词组件加载失败，请刷新'),
  delay: 0, // 实现
  timeout: 10000, // 实现
});
import { getPlaybackSeekSecondsForLyricLine } from './seekLayout';
import type { WordLyricLineClickEvent } from './WordLyricPlayer';
import RangeSlider from '../common/RangeSlider.vue';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { getLyricsStylePanelPosition } from './lyricsStylePanelPosition'; // 实现

const props = defineProps<{ // 实现
  coverHidden?: boolean; // 实现
  disabled?: boolean;
  /** 电影模式（背景视频接管外观）：由 PlayerDetail 透传，避免子组件重复计算同一份状态 */
  movieMode?: boolean;
}>();

// 歌词数据与样式设置（统一重命名，避免与桌面歌词侧概念混淆）
const {
  parsedLyrics: timeline,
  lyricsSettings: stylePrefs,
  lyricsStatus: loadState,
  showLyricsPlayerSettingsPanel: stylePanelOpen,
  rawLyrics: sourceText,
} = useLyrics(); // 实现
const { seekTo: performSeek, currentTime: clockSeconds, isPlaying: nowPlaying, currentSongPath: activeSongPath, togglePlay: flipPlayState } = usePlayer();
const { audioDelay: latency } = storeToRefs(useSettingsStore());
const { showToast: notify } = useToast();

const FONT_SIZE_STEP = 0.05;
const ROW_GAP_STEP = 0.05;
const SHIFT_STEP = 1;
const ALIGNMENT_CHOICES: Array<{ value: LyricsPlayerAlignment; label: string }> = [
  { value: 'left', label: '靠左' }, // 实现
  { value: 'center', label: '居中' }, // 实现
  { value: 'right', label: '靠右' }, // 实现
];

// 面板与字体菜单的锚点/容器引用
const panelAnchorRef = ref<HTMLElement | null>(null);
const menuAnchorRef = ref<HTMLElement | null>(null);
const menuPanelRef = ref<HTMLElement | null>(null);
interface WordPlayerHandle {
  syncSeekLayout: (timeMs: number, lineIndex?: number) => void; // 实现
} // 实现
const wordPlayerRef = ref<WordPlayerHandle | null>(null);
const isFontMenuVisible = ref(false);
const fontMenuPositionStyle = ref<Record<string, string>>({});
const fontMenuScope = ref<'unified' | 'cjk' | 'latin'>('unified');

const panelOffsetStyle = ref<Record<string, string>>({});

const PANEL_BASE_WIDTH = 'min(320px, calc(34vw - 24px))';
const panelStyle = computed(() => ({
  // 超宽屏（≥1536px）下面板需离歌词区更远
  marginRight: window.innerWidth >= 1536 ? '22vw' : '14vw',
  width: PANEL_BASE_WIDTH,
  ...panelOffsetStyle.value,
}));

// 面板打开或容器尺寸变化时，重新计算面板落点
function syncPanelPosition() {
  const anchor = panelAnchorRef.value;
  if (!anchor) return;

  const container = anchor.parentElement;
  if (!container) return;

  panelOffsetStyle.value = getLyricsStylePanelPosition(container.getBoundingClientRect(), window.innerWidth);
}

const amlLines = computed<AmlPlayerLine[]>(() => (
  convertLyricsToAmlLines(
    timeline.value,
    stylePrefs.showTranslation,
    stylePrefs.showRomaji,
    stylePrefs.enableWordEffect,
  )
));

const songTimeMs = computed(() => Math.max(0, Math.floor((clockSeconds.value - latency.value) * 1000)));

const mountWordPlayer = computed(() => amlLines.value.length > 0 && !props.disabled);

const idleStateText = computed(() => {
  if (loadState.value === 'loading') return 'Loading lyrics...';
  if (loadState.value === 'error') return 'Lyrics unavailable';
  return 'No synchronized lyrics'; // 实现
});

// 无时间轴的纯文本歌词：逐行 trim 后丢弃空行
const plainRows = computed(() => (
  sourceText.value
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
));
const showPlainRows = computed(() => (
  plainRows.value.length > 0
  && timeline.value.length === 0
  && loadState.value !== 'loading'
  && loadState.value !== 'error'
));

const fontSizePercent = computed(() => `${Math.round(stylePrefs.playerFontScale * 100)}%`);
const rowGapPercent = computed(() => `${Math.round(stylePrefs.playerLineGap * 100)}%`);
const shiftXPercent = computed(() => describeSignedPercent(stylePrefs.playerOffsetX));
const shiftYPercent = computed(() => describeSignedPercent(stylePrefs.playerOffsetY));
const fontOptions = computed(() => [
  ...LYRICS_FONT_OPTIONS, // 实现
  ...systemLyricsFontOptions.value, // 实现
]);
const activeFontLabel = computed(() => (
  fontOptions.value.find((option) => option.value === stylePrefs.playerFontPreset)?.label
  ?? normalizeLyricsFontPreset(stylePrefs.playerFontPreset)
));

const activeFontLabelCJK = computed(() => {
  const preset = stylePrefs.playerFontPresetCJK ?? DEFAULT_PLAYER_FONT_PRESET;
  return fontOptions.value.find((option) => option.value === preset)?.label
    ?? normalizeLyricsFontPreset(preset);
});

const activeFontLabelLatin = computed(() => {
  const preset = stylePrefs.playerFontPresetLatin ?? DEFAULT_PLAYER_FONT_PRESET;
  return fontOptions.value.find((option) => option.value === preset)?.label
    ?? normalizeLyricsFontPreset(preset);
});

// 把区间内取值换算成滑杆轨道的填充百分比
const ratioToPercent = (value: number, low: number, high: number) => ((value - low) / (high - low)) * 100;

const fontSizeProgress = computed(() => ratioToPercent(stylePrefs.playerFontScale, MIN_PLAYER_FONT_SCALE, MAX_PLAYER_FONT_SCALE));
const rowGapProgress = computed(() => ratioToPercent(stylePrefs.playerLineGap, MIN_PLAYER_LINE_GAP, MAX_PLAYER_LINE_GAP));
const shiftXProgress = computed(() => ratioToPercent(stylePrefs.playerOffsetX, MIN_PLAYER_OFFSET_X, MAX_PLAYER_OFFSET_X));
const shiftYProgress = computed(() => ratioToPercent(stylePrefs.playerOffsetY, MIN_PLAYER_OFFSET_Y, MAX_PLAYER_OFFSET_Y));

const alignClass = computed(() => `lyrics-align-${stylePrefs.playerAlignment}`);

const fadeWidth = computed(() => stylePrefs.enableWordEffect ? 0.5 : 0);

// 中西文分拆时，从字体栈里裁掉通用族，再以系统字体兜底拼接
const GENERIC_FAMILY_TAIL = /,\s*(system-ui|sans-serif|ui-sans-serif).*$/i;
const playerVars = computed(() => {
  let familyStack: string;
  if (stylePrefs.playerFontSplitEnabled) {
    const latinStack = getLyricsFontFamily(stylePrefs.playerFontPresetLatin ?? DEFAULT_PLAYER_FONT_PRESET).replace(GENERIC_FAMILY_TAIL, '').trim();
    const cjkStack = getLyricsFontFamily(stylePrefs.playerFontPresetCJK ?? DEFAULT_PLAYER_FONT_PRESET).replace(GENERIC_FAMILY_TAIL, '').trim();
    familyStack = [latinStack, cjkStack, 'system-ui', 'sans-serif'].filter(Boolean).join(', ');
  } else {
    familyStack = getLyricsFontFamily(stylePrefs.playerFontPreset);
  }
  return {
    '--lyrics-font-scale': stylePrefs.playerFontScale.toString(),
    '--lyrics-font-family': familyStack,
    '--lyrics-offset-x': `${stylePrefs.playerOffsetX}%`,
    '--lyrics-offset-y': `${stylePrefs.playerOffsetY}%`,
  };
});

const clampWithin = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const describeSignedPercent = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)}%`;

function assignFontSize(next: number) {
  stylePrefs.playerFontScale = Number(clampWithin(next, MIN_PLAYER_FONT_SCALE, MAX_PLAYER_FONT_SCALE).toFixed(2));
}

function assignRowGap(next: number) {
  stylePrefs.playerLineGap = Number(clampWithin(next, MIN_PLAYER_LINE_GAP, MAX_PLAYER_LINE_GAP).toFixed(2));
}

function assignShiftX(next: number) {
  stylePrefs.playerOffsetX = Number(clampWithin(next, MIN_PLAYER_OFFSET_X, MAX_PLAYER_OFFSET_X).toFixed(0));
}

function assignShiftY(next: number) {
  stylePrefs.playerOffsetY = Number(clampWithin(next, MIN_PLAYER_OFFSET_Y, MAX_PLAYER_OFFSET_Y).toFixed(0));
}

function assignAlignment(value: LyricsPlayerAlignment) {
  stylePrefs.playerAlignment = value;
}

function assignFontPreset(value: LyricsFontPreset) {
  stylePrefs.playerFontPreset = value;
}

function assignFontPresetCJK(value: LyricsFontPreset) {
  stylePrefs.playerFontPresetCJK = value;
}

function assignFontPresetLatin(value: LyricsFontPreset) {
  stylePrefs.playerFontPresetLatin = value;
}

function restoreFontPresetCJK() {
  stylePrefs.playerFontPresetCJK = DEFAULT_PLAYER_FONT_PRESET;
}

function restoreFontPresetLatin() {
  stylePrefs.playerFontPresetLatin = DEFAULT_PLAYER_FONT_PRESET;
}

function stepFontSize(delta: number) {
  assignFontSize(stylePrefs.playerFontScale + delta);
}

function restoreFontSize() {
  assignFontSize(DEFAULT_PLAYER_FONT_SCALE);
}

function restoreRowGap() {
  assignRowGap(DEFAULT_PLAYER_LINE_GAP);
}

function restoreAlignment() {
  assignAlignment(DEFAULT_PLAYER_ALIGNMENT);
}

function restoreShiftX() {
  assignShiftX(DEFAULT_PLAYER_OFFSET_X);
}

function restoreShiftY() {
  assignShiftY(DEFAULT_PLAYER_OFFSET_Y);
}

function restoreFontPreset() {
  assignFontPreset(DEFAULT_PLAYER_FONT_PRESET);
}

// —— 样式面板页签 ——
type StyleTab = 'background' | 'lyrics';
const activeStyleTab = ref<StyleTab>('background');

// —— 背景模糊 ——
const backgroundBlurPercent = computed(() => `${Math.round(stylePrefs.backgroundBlur)}%`);
const backgroundBlurProgress = computed(() => ratioToPercent(stylePrefs.backgroundBlur, MIN_BACKGROUND_BLUR, MAX_BACKGROUND_BLUR));

function assignBackgroundBlur(next: number) {
  stylePrefs.backgroundBlur = clampWithin(next, MIN_BACKGROUND_BLUR, MAX_BACKGROUND_BLUR);
}

function restoreBackgroundBlur() {
  assignBackgroundBlur(DEFAULT_BACKGROUND_BLUR);
}

function clearCustomBackgroundImage() {
  stylePrefs.customBackgroundImage = DEFAULT_CUSTOM_BACKGROUND_IMAGE;
}

// —— 播放详情页外观（与「设置 → 主题」里的同名开关共享同一份状态）——
const { theme: themeState, patchTheme: applyThemePatch } = useThemeSettings();
const vinylStyleOn = computed(() => themeState.value?.playerDetailStyle === 'vinyl');
const meshBackdropOn = computed(() => themeState.value?.playerDetailMeshBackground === true);

function flipVinylStyle() {
  applyThemePatch({ playerDetailStyle: vinylStyleOn.value ? 'classic' : 'vinyl' });
}

function flipMeshBackground() {
  applyThemePatch({ playerDetailMeshBackground: !meshBackdropOn.value });
}

/** 流动速度倍率的滑块范围（渲染侧 PlayerDetailMeshBackground 还会夹取一次兜底） */
const MESH_SPEED_MIN = 0;
const MESH_SPEED_MAX = 3;
const meshBackgroundSpeed = computed(() => themeState.value?.playerDetailMeshSpeed ?? 1);
const meshBackgroundSpeedProgress = computed(
  () => ((meshBackgroundSpeed.value - MESH_SPEED_MIN) / (MESH_SPEED_MAX - MESH_SPEED_MIN)) * 100,
);

function setMeshBackgroundSpeed(value: number) {
  applyThemePatch({ playerDetailMeshSpeed: value });
}
/** 电影模式下外观由背景视频接管：黑胶与多边形背景在 PlayerDetail 里都带 !isMovieMode 抑制 */
const movieModeActive = computed(() => Boolean(props.movieMode));
/** 模糊何时失效：多边形背景开启，或电影模式（后者把 backgroundBlur 强制置 0，退出时还原） */
const blurSettingOff = computed(() => meshBackdropOn.value || movieModeActive.value);
/** 失效原因提示：两处共用同一句文案 */
const blurDisabledHint = computed(() => (
  movieModeActive.value
    ? '电影模式下由背景视频接管，外观设置不生效'
    : '已启用多边形流光背景，模糊设置不生效'
));

const pickBackgroundImage = async () => {
  const { open } = await import('@tauri-apps/plugin-dialog'); // 实现
  const picked = await open({
    multiple: false, // 实现
    title: '选择背景图片', // 实现
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }], // 实现
  });
  if (picked && typeof picked === 'string') {
    stylePrefs.customBackgroundImage = picked;
  }
};

const writingSongBackground = ref(false);
const persistSongBackground = async () => {
  const songPath = activeSongPath.value;
  const bgPath = stylePrefs.customBackgroundImage;
  if (!songPath) {
    notify('当前没有播放的歌曲', 'error');
    return;
  }
  if (!bgPath) {
    notify('请先选择自定义背景图片', 'error');
    return;
  }
  writingSongBackground.value = true;
  try {
    await fileApi.saveSongBackground(songPath, bgPath);
    notify('已将背景图写入当前歌曲', 'success');
  } catch (err) {
    notify(`写入失败: ${err}`, 'error');
  } finally {
    writingSongBackground.value = false;
  }
};

const clearSongBackground = async () => {
  const songPath = activeSongPath.value;
  if (!songPath) {
    notify('当前没有播放的歌曲', 'error');
    return;
  }
  try {
    await fileApi.clearSongBackground(songPath);
    notify('已清除当前歌曲的背景图', 'success');
  } catch (err) {
    notify(`清除失败: ${err}`, 'error');
  }
};

function flipTranslation() {
  stylePrefs.showTranslation = !stylePrefs.showTranslation;
}

function flipRomaji() {
  stylePrefs.showRomaji = !stylePrefs.showRomaji;
}

function flipWordEffect() {
  stylePrefs.enableWordEffect = !stylePrefs.enableWordEffect;
} // 实现
const activeSubtitleCount = computed(() => Number(stylePrefs.showTranslation) + Number(stylePrefs.showRomaji));

// 滑杆轨道的渐变填充样式（进度值决定分界位置）
const trackGradient = (progress: number) => ({
  background: `linear-gradient(to right, rgba(255,255,255,0.85) ${progress}%, rgba(255,255,255,0.12) ${progress}%)`,
});

// 字体菜单选中项写入对应档位（统一 / 中文 / 外文）
function pickFontPreset(value: LyricsFontPreset) {
  const normalized = normalizeLyricsFontPreset(value);
  if (fontMenuScope.value === 'cjk') {
    assignFontPresetCJK(normalized);
  } else if (fontMenuScope.value === 'latin') {
    assignFontPresetLatin(normalized);
  } else {
    assignFontPreset(normalized);
  }
}

function launchFontMenu(scope: 'unified' | 'cjk' | 'latin', anchorEl: HTMLElement) {
  fontMenuScope.value = scope;
  menuAnchorRef.value = anchorEl;
  isFontMenuVisible.value = true;
  nextTick(() => {
    placeFontMenu();
    const menu = menuPanelRef.value;
    if (!menu) return;
    const activeItem = menu.querySelector('.active-font-preset') as HTMLElement | null;
    const scroller = menu.querySelector('.custom-scrollbar') as HTMLElement | null;
    if (!activeItem || !scroller) return;
    scroller.style.scrollBehavior = 'auto';
    scroller.scrollTop = activeItem.offsetTop + activeItem.offsetHeight / 2 - scroller.clientHeight / 2;
    scroller.style.scrollBehavior = '';
  });
}

// 菜单当前应高亮的字体档位
const currentMenuPreset = computed(() => {
  if (fontMenuScope.value === 'cjk') return stylePrefs.playerFontPresetCJK ?? DEFAULT_PLAYER_FONT_PRESET;
  if (fontMenuScope.value === 'latin') return stylePrefs.playerFontPresetLatin ?? DEFAULT_PLAYER_FONT_PRESET;
  return stylePrefs.playerFontPreset;
});

// 把菜单固定在触发按钮旁：优先右侧展开，越界则翻到左侧
function placeFontMenu() {
  const anchor = menuAnchorRef.value;
  if (!anchor) return;

  const hostPanel = anchor.closest('.pointer-events-auto');
  if (!hostPanel) return;

  const hostRect = hostPanel.getBoundingClientRect();
  const menuWidth = 280; // 实现
  const spacing = 0;

  let left = hostRect.right + spacing;
  if (left + menuWidth > window.innerWidth - 16) {
    left = Math.max(16, hostRect.left - spacing - menuWidth);
  }

  fontMenuPositionStyle.value = {
    position: 'fixed', // 实现
    left: `${Math.round(left)}px`, // 实现
    bottom: `${Math.round(window.innerHeight - hostRect.bottom)}px`,
    width: `${menuWidth}px`, // 实现
    maxHeight: `${Math.round(Math.min(420, hostRect.bottom - 16))}px`,
  };
}

function onGlobalPointerDown(event: MouseEvent) {
  const target = event.target as Node | null; // 实现
  if (!target) return; // 实现
  if (panelAnchorRef.value?.contains(target)) return;
  if (menuPanelRef.value?.contains(target)) return;
  isFontMenuVisible.value = false;
  stylePanelOpen.value = false;
}

let globalListenersBound = false;

function bindGlobalListeners() {
  if (globalListenersBound) return;

  window.addEventListener('mousedown', onGlobalPointerDown);
  window.addEventListener('resize', placeFontMenu);
  window.addEventListener('resize', syncPanelPosition);
  globalListenersBound = true;
}

function unbindGlobalListeners() {
  if (!globalListenersBound) return;

  window.removeEventListener('mousedown', onGlobalPointerDown);
  window.removeEventListener('resize', placeFontMenu);
  window.removeEventListener('resize', syncPanelPosition);
  globalListenersBound = false;
}

function resetTransientUi() {
  stylePanelOpen.value = false;
  isFontMenuVisible.value = false;
  panelOffsetStyle.value = {};
}

async function onLyricLineClick(event: WordLyricLineClickEvent) {
  const lineStartMs = event.line.startTime;
  wordPlayerRef.value?.syncSeekLayout(lineStartMs, event.lineIndex);

  const targetSeconds = getPlaybackSeekSecondsForLyricLine(lineStartMs, latency.value);
  const pausedBeforeSeek = !nowPlaying.value;
  await performSeek(targetSeconds);

  if (pausedBeforeSeek && !nowPlaying.value) {
    await flipPlayState();
  }
}

onMounted(() => { // 实现
  if (!props.disabled) {
    bindGlobalListeners();
  }
  void loadSystemLyricsFonts(); // 实现
});

onUnmounted(() => { // 实现
  unbindGlobalListeners();
  resetTransientUi();
});

watch(() => props.disabled, (disabled) => {
  if (disabled) {
    unbindGlobalListeners();
    resetTransientUi();
  } else {
    bindGlobalListeners();
  }
});

watch(stylePanelOpen, async (visible) => {
  if (visible) {
    await nextTick();
    syncPanelPosition();
  } else {
    panelOffsetStyle.value = {};
  }
});

watch(() => props.coverHidden, async () => { // 实现
  if (!stylePanelOpen.value) return;
  await nextTick(); // 实现
  syncPanelPosition();
});
</script>

<template>
  <div class="group/lyrics-view relative h-full min-h-0 w-full min-w-0"> 
    <div
      v-show="stylePanelOpen || amlLines.length > 0"
      ref="panelAnchorRef"
      class="pointer-events-none absolute top-2 bottom-12 right-[100%] z-[85] flex min-h-0 min-w-[260px] max-w-[320px] flex-col justify-center"
      :style="panelStyle"
    >
      <transition name="font-panel"> 
        <div
          v-if="stylePanelOpen"
          class="lyrics-settings-glass pointer-events-auto flex h-[640px] max-h-[100%] w-full flex-col rounded-3xl border border-white/15 text-white shadow-[0_28px_70px_rgba(0,0,0,0.48)]" 
          @click.stop
          @mousedown.stop 
        >
          <div class="relative flex shrink-0 border-b border-white/10 px-2 pt-2"> 
            <button
              type="button" 
              class="relative px-3 py-2 text-[12px] font-medium transition-colors" 
              :class="activeStyleTab !== 'lyrics' ? 'text-white' : 'text-white/40 hover:text-white/70'"
              @click="activeStyleTab = 'background'"
            >
              背景样式
              <span
                v-if="activeStyleTab !== 'lyrics'"
                class="absolute left-2 right-2 bottom-[-1px] h-[2px] rounded-full bg-[#EC4141]"
              ></span>
            </button>
            <button
              type="button" 
              class="relative px-3 py-2 text-[12px] font-medium transition-colors" 
              :class="activeStyleTab === 'lyrics' ? 'text-white' : 'text-white/40 hover:text-white/70'"
              @click="activeStyleTab = 'lyrics'"
            >
              歌词样式
              <span
                v-if="activeStyleTab === 'lyrics'"
                class="absolute left-2 right-2 bottom-[-1px] h-[2px] rounded-full bg-[#EC4141]"
              ></span>
            </button>
          </div>

          <div class="relative min-h-0 flex-1"> 
            <transition mode="out-in" name="tab-switch">
          <div v-if="activeStyleTab === 'background'" key="background" class="min-h-0 h-full overflow-y-auto px-4 py-4 custom-scrollbar">
            <div class="mb-6">
              <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Skin</div>

              <div
                class="transition-opacity duration-200"
                :class="movieModeActive ? 'opacity-40 pointer-events-none select-none' : ''"
                :aria-disabled="movieModeActive"
              >
                <div class="mt-2 flex items-center justify-between gap-3">
                  <span class="text-[13px] text-white/85 font-medium">黑胶唱片</span>
                  <button
                    type="button"
                    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200"
                    :class="!vinylStyleOn ? 'bg-white/15' : 'bg-[#EC4141]'"
                    :disabled="movieModeActive"
                    @click="flipVinylStyle"
                  >
                    <span
                      class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200"
                      :class="!vinylStyleOn ? 'translate-x-0.5' : 'translate-x-4'"
                    />
                  </button>
                </div>

                <div class="mt-3 flex items-center justify-between gap-3">
                  <span class="text-[13px] text-white/85 font-medium">多边形流光背景</span>
                  <button
                    type="button"
                    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200"
                    :class="!meshBackdropOn ? 'bg-white/15' : 'bg-[#EC4141]'"
                    :disabled="movieModeActive"
                    @click="flipMeshBackground"
                  >
                    <span
                      class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200"
                      :class="!meshBackdropOn ? 'translate-x-0.5' : 'translate-x-4'"
                    />
                  </button>
                </div>
              </div>

              <div v-if="movieModeActive" class="mt-1.5 text-[10px] text-[#EC4141]/85">{{ blurDisabledHint }}</div>
              <div v-else class="mt-1.5 text-[10px] text-white/30">与「设置 → 主题」里的同名开关是同一份设置</div>

              <div v-if="meshBackdropOn" class="mt-3">
                <div class="flex items-center justify-between">
                  <span class="text-[13px] font-medium text-white/85">流动速度</span>
                  <span class="text-xs font-medium tabular-nums text-white/60">{{ meshBackgroundSpeed.toFixed(1) }}×</span>
                </div>
                <div class="mt-2 flex items-center gap-3">
                  <span class="text-[10px] text-white/40 w-6 text-right">0×</span>
                  <RangeSlider
                    variant="compact-sm"
                    class="h-1 flex-1"
                    :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${meshBackgroundSpeedProgress}%, rgba(255,255,255,0.12) ${meshBackgroundSpeedProgress}%)` }"
                    :min="MESH_SPEED_MIN"
                    :max="MESH_SPEED_MAX"
                    :step="0.1"
                    :disabled="movieModeActive"
                    :model-value="meshBackgroundSpeed"
                    @update:model-value="setMeshBackgroundSpeed"
                  />
                  <span class="text-[10px] text-white/40 w-6">3×</span>
                </div>
                <div class="mt-1.5 text-[10px] text-white/30">数值越大流动越快，0 为静止</div>
              </div>
            </div>
            <!-- 多边形流光背景会整体替换模糊封面背景；电影模式下模糊同样被强制归零，两种情况都禁用此设置 -->
            <div
              class="transition-opacity duration-200"
              :class="blurSettingOff ? 'opacity-40 pointer-events-none select-none' : ''"
              :aria-disabled="blurSettingOff"
            >
              <div class="mb-3">
                <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Blur</div>
                <div class="mt-1.5 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-[13px] text-white/85 font-medium">背景模糊程度</span>
                    <button
                      v-if="stylePrefs.backgroundBlur !== DEFAULT_BACKGROUND_BLUR"
                      type="button"
                      class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed"
                      :disabled="blurSettingOff"
                      @click="restoreBackgroundBlur"
                      title="重置"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                        <path d="M3 3v5h5"/>
                      </svg>
                    </button>
                  </div>
                  <span class="text-xs font-medium tabular-nums text-white/60">{{ backgroundBlurPercent }}</span>
                </div>
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[10px] text-white/40 w-6 text-right">0%</span>
                <RangeSlider
                  variant="compact-sm"
                  class="h-1 flex-1"
                  :style="trackGradient(backgroundBlurProgress)"
                  :min="MIN_BACKGROUND_BLUR"
                  :max="MAX_BACKGROUND_BLUR"
                  :step="1"
                  :disabled="blurSettingOff"
                  :model-value="stylePrefs.backgroundBlur"
                  @update:model-value="assignBackgroundBlur"
                />
                <span class="text-[10px] text-white/40 w-6">100%</span>
              </div>
              <div class="mt-1.5 text-[10px] text-white/30">数值越小越清晰，越大越模糊</div>
            </div>
            <div v-if="blurSettingOff" class="mt-1.5 text-[10px] text-[#EC4141]/85">{{ blurDisabledHint }}</div>

            <div class="mt-6 mb-3"> 
              <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Custom</div>
              <div class="mt-1.5"> 
                <span class="text-[13px] text-white/85 font-medium">自定义背景</span>
              </div>
            </div>

            <div class="flex items-center gap-2"> 
              <button
                type="button" 
                class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-white/10 text-white/85 hover:bg-white/20 transition-colors" 
                @click="pickBackgroundImage"
              >选择图片</button> 
              <button
                v-if="stylePrefs.customBackgroundImage"
                type="button" 
                class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition-colors" 
                @click="clearCustomBackgroundImage"
              >清除</button> 
            </div>
            <div v-if="stylePrefs.customBackgroundImage" class="mt-2 text-[10px] text-white/30 truncate" :title="stylePrefs.customBackgroundImage">
              {{ stylePrefs.customBackgroundImage }}
            </div>
            <div v-else class="mt-2 text-[10px] text-white/30">未设置自定义背景，使用歌曲封面作为背景</div> 

            <div class="mt-4 pt-4 border-t border-white/8">
              <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Per-Song</div>
              <div class="mt-1.5"> 
                <span class="text-[13px] text-white/85 font-medium">单曲背景</span>
                <span class="ml-1.5 text-[10px] text-white/30">为当前歌曲单独保存背景图</span>
              </div>
              <div class="mt-2 flex items-center gap-2">
                <button
                  type="button" 
                  :disabled="writingSongBackground || !stylePrefs.customBackgroundImage"
                  class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[#EC4141]/80 text-white hover:bg-[#EC4141] disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
                  @click="persistSongBackground"
                >写入歌曲</button>
                <button
                  type="button" 
                  class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition-colors"
                  @click="clearSongBackground"
                >清除歌曲背景</button>
              </div>
              <div class="mt-2 text-[10px] text-white/25">写入后该歌曲将使用独立背景，不影响全局设置</div>
            </div>
          </div>

          <div v-else key="lyrics" class="min-h-0 h-full overflow-y-auto px-4 py-4 custom-scrollbar"> 
          <div class="mb-3"> 
            <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Lyrics</div>
            <div class="mt-1.5 flex items-center justify-between"> 
              <div class="flex items-center gap-2"> 
                <span class="text-[13px] text-white/85 font-medium">字体大小</span>
                <button
                  v-if="stylePrefs.playerFontScale !== DEFAULT_PLAYER_FONT_SCALE"
                  type="button" 
                  class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="restoreFontSize"
                  title="重置"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                </button>
              </div>
              <span class="text-xs font-medium tabular-nums text-white/60">{{ fontSizePercent }}</span>
            </div>
          </div>

          <div class="flex items-center gap-3"> 
            <button
              type="button" 
              class="flex h-8 w-8 items-center rounded-full justify-center text-xs font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="stylePrefs.playerFontScale <= MIN_PLAYER_FONT_SCALE"
              @click="stepFontSize(-FONT_SIZE_STEP)"
            >
              A-
            </button>

            <RangeSlider
              variant="compact-sm"
              class="h-1 flex-1"
              :style="trackGradient(fontSizeProgress)"
              :min="MIN_PLAYER_FONT_SCALE" 
              :max="MAX_PLAYER_FONT_SCALE" 
              :step="FONT_SIZE_STEP"
              :model-value="stylePrefs.playerFontScale"
              @update:model-value="assignFontSize"
            />

            <button
              type="button" 
              class="flex h-8 w-8 items-center rounded-full justify-center text-xs font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="stylePrefs.playerFontScale >= MAX_PLAYER_FONT_SCALE"
              @click="stepFontSize(FONT_SIZE_STEP)"
            >
              A+
            </button>
          </div>

          <div class="mt-6 mb-3"> 
            <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Spacing</div>
            <div class="mt-1.5 flex items-center justify-between"> 
              <div class="flex items-center gap-2"> 
                <span class="text-[13px] text-white/85 font-medium">歌词间距</span>
                <button
                  v-if="stylePrefs.playerLineGap !== DEFAULT_PLAYER_LINE_GAP"
                  type="button" 
                  class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="restoreRowGap"
                  title="重置"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                </button>
              </div>
              <span class="text-xs font-medium tabular-nums text-white/60">{{ rowGapPercent }}</span>
            </div>
          </div>

          <div class="flex items-center gap-3"> 
            <button
              type="button" 
              class="flex h-8 w-8 items-center rounded-full justify-center text-base font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="stylePrefs.playerLineGap <= MIN_PLAYER_LINE_GAP"
              @click="assignRowGap(stylePrefs.playerLineGap - ROW_GAP_STEP)"
            >
              -
            </button>

            <RangeSlider
              variant="compact-sm"
              class="h-1 flex-1"
              :style="trackGradient(rowGapProgress)"
              :min="MIN_PLAYER_LINE_GAP" 
              :max="MAX_PLAYER_LINE_GAP" 
              :step="ROW_GAP_STEP"
              :model-value="stylePrefs.playerLineGap"
              @update:model-value="assignRowGap"
            />

            <button
              type="button" 
              class="flex h-8 w-8 items-center rounded-full justify-center text-base font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="stylePrefs.playerLineGap >= MAX_PLAYER_LINE_GAP"
              @click="assignRowGap(stylePrefs.playerLineGap + ROW_GAP_STEP)"
            >
              +
            </button>
          </div>

          <div class="mt-6 mb-3"> 
            <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Subtitles</div>
            <div class="mt-1.5 flex items-center justify-between gap-3"> 
              <span class="text-[13px] text-white/85 font-medium">副行显示</span>
              <span class="text-[11px] font-medium text-white/42"> 
                {{ activeSubtitleCount }}/2
              </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2"> 
            <button
              type="button" 
              class="flex h-10 items-center justify-center rounded-2xl border px-3 text-sm font-medium transition" 
              :class="!stylePrefs.showTranslation
                ? 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
                : 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'"
              @click="flipTranslation"
            >
              显示翻译
            </button>

            <button
              type="button" 
              class="flex h-10 items-center justify-center rounded-2xl border px-3 text-sm font-medium transition" 
              :class="!stylePrefs.showRomaji
                ? 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
                : 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'"
              @click="flipRomaji"
            >
              显示罗马音
            </button>
          </div>

          <div class="mt-4"> 
            <button 
              type="button" 
              class="flex h-10 w-full items-center justify-center rounded-2xl border px-3 text-sm font-medium transition" 
              :class="!stylePrefs.enableWordEffect
                ? 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
                : 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'"
              @click="flipWordEffect"
            > 
              逐字歌词效果 
            </button> 
          </div> 
          <div class="mt-6 mb-3"> 
            <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Alignment</div>
            <div class="mt-1.5 flex items-center justify-between gap-3"> 
              <span class="text-[13px] text-white/85 font-medium">歌词位置</span>
              <button
                v-if="stylePrefs.playerAlignment !== DEFAULT_PLAYER_ALIGNMENT"
                type="button" 
                class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white"
                @click="restoreAlignment"
                title="Reset" 
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2"> 
            <button
              v-for="choice in ALIGNMENT_CHOICES"
              :key="choice.value"
              type="button" 
              class="flex h-9 items-center justify-center rounded-2xl border px-3 text-xs font-medium transition" 
              :class="stylePrefs.playerAlignment !== choice.value
                ? 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
                : 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'"
              @click="assignAlignment(choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>

          <div class="mt-6 mb-3"> 
            <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Offset</div>
            <div class="mt-1.5 flex items-center justify-between gap-3"> 
              <span class="text-[13px] text-white/85 font-medium">歌词偏移</span>
              <div class="flex items-center gap-1"> 
                <button
                  v-if="stylePrefs.playerOffsetX !== DEFAULT_PLAYER_OFFSET_X"
                  type="button" 
                  class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="restoreShiftX"
                  title="Reset horizontal offset" 
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                </button>
                <button
                  v-if="stylePrefs.playerOffsetY !== DEFAULT_PLAYER_OFFSET_Y"
                  type="button" 
                  class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="restoreShiftY"
                  title="Reset vertical offset" 
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div class="space-y-4"> 
            <div>
              <div class="mb-2 flex items-center justify-between gap-3"> 
                <span class="text-[12px] font-medium text-white/70">水平</span> 
                <span class="text-[11px] font-medium tabular-nums text-white/48">{{ shiftXPercent }}</span>
              </div>
              <RangeSlider
                variant="compact-sm"
                class="h-1 w-full"
                :style="trackGradient(shiftXProgress)"
                :min="MIN_PLAYER_OFFSET_X" 
                :max="MAX_PLAYER_OFFSET_X" 
                :step="SHIFT_STEP"
                :model-value="stylePrefs.playerOffsetX"
                @update:model-value="assignShiftX"
              />
            </div>

            <div>
              <div class="mb-2 flex items-center justify-between gap-3"> 
                <span class="text-[12px] font-medium text-white/70">垂直</span> 
                <span class="text-[11px] font-medium tabular-nums text-white/48">{{ shiftYPercent }}</span>
              </div>
              <RangeSlider
                variant="compact-sm"
                class="h-1 w-full"
                :style="trackGradient(shiftYProgress)"
                :min="MIN_PLAYER_OFFSET_Y" 
                :max="MAX_PLAYER_OFFSET_Y" 
                :step="SHIFT_STEP"
                :model-value="stylePrefs.playerOffsetY"
                @update:model-value="assignShiftY"
              />
            </div>
          </div>

          <div class="mt-6 mb-3"> 
            <div class="text-[9px] font-semibold uppercase text-white/30 tracking-[0.3em]">Font</div>
            <div class="mt-2 flex items-center justify-between gap-3">
              <span class="text-[12px] text-white/55">分别设置中/外文字体</span>
              <button
                type="button"
                class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200"
                :class="!stylePrefs.playerFontSplitEnabled ? 'bg-white/15' : 'bg-[#EC4141]'"
                @click="stylePrefs.playerFontSplitEnabled = !stylePrefs.playerFontSplitEnabled"
              >
                <span
                  class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200"
                  :class="!stylePrefs.playerFontSplitEnabled ? 'translate-x-0.5' : 'translate-x-4'"
                />
              </button>
            </div>
          </div>

          <template v-if="!stylePrefs.playerFontSplitEnabled">
            <div class="mb-2 flex items-center justify-between gap-3">
              <span class="text-[13px] text-white/85 font-medium">歌词字体</span>
              <button
                v-if="stylePrefs.playerFontPreset !== DEFAULT_PLAYER_FONT_PRESET"
                type="button" 
                class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white"
                @click="restoreFontPreset"
                title="Reset" 
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
            </div>
            <div class="relative overflow-visible">
              <button
                ref="menuAnchorRef"
                type="button"
                class="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-white transition hover:border-white/20 hover:bg-white/[0.06]"
                :class="isFontMenuVisible && fontMenuScope === 'unified' ? 'border-white/25 bg-white/[0.08] shadow-[0_18px_36px_rgba(0,0,0,0.16)]' : ''"
                @click="launchFontMenu('unified', $event.currentTarget as HTMLElement)"
              >
                <span class="truncate">{{ activeFontLabel }}</span>
                <svg class="shrink-0 text-white/45 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="isFontMenuVisible && fontMenuScope === 'unified' ? 'rotate-180 text-white/70' : ''"><path d="m6 9 6 6 6-6"/></svg>
              </button>
            </div>
          </template>

          <template v-else>
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] text-white/85 font-medium">中文字体</span>
              <button
                v-if="(stylePrefs.playerFontPresetCJK ?? DEFAULT_PLAYER_FONT_PRESET) !== DEFAULT_PLAYER_FONT_PRESET"
                type="button"
                class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white"
                @click="restoreFontPresetCJK"
                title="Reset"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
            </div>
            <div class="relative overflow-visible mb-3">
              <button
                type="button"
                class="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-white transition hover:border-white/20 hover:bg-white/[0.06]"
                :class="isFontMenuVisible && fontMenuScope === 'cjk' ? 'border-white/25 bg-white/[0.08] shadow-[0_18px_36px_rgba(0,0,0,0.16)]' : ''"
                @click="launchFontMenu('cjk', $event.currentTarget as HTMLElement)"
              >
                <span class="truncate">{{ activeFontLabelCJK }}</span>
                <svg class="shrink-0 text-white/45 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="isFontMenuVisible && fontMenuScope === 'cjk' ? 'rotate-180 text-white/70' : ''"><path d="m6 9 6 6 6-6"/></svg>
              </button>
            </div>
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] text-white/85 font-medium">外文字体</span>
              <button
                v-if="(stylePrefs.playerFontPresetLatin ?? DEFAULT_PLAYER_FONT_PRESET) !== DEFAULT_PLAYER_FONT_PRESET"
                type="button"
                class="flex h-5 w-5 items-center rounded-full justify-center text-white/40 transition hover:bg-white/10 hover:text-white"
                @click="restoreFontPresetLatin"
                title="Reset"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
            </div>
            <div class="relative overflow-visible">
              <button
                type="button"
                class="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-white transition hover:border-white/20 hover:bg-white/[0.06]"
                :class="isFontMenuVisible && fontMenuScope === 'latin' ? 'border-white/25 bg-white/[0.08] shadow-[0_18px_36px_rgba(0,0,0,0.16)]' : ''"
                @click="launchFontMenu('latin', $event.currentTarget as HTMLElement)"
              >
                <span class="truncate">{{ activeFontLabelLatin }}</span>
                <svg class="shrink-0 text-white/45 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="isFontMenuVisible && fontMenuScope === 'latin' ? 'rotate-180 text-white/70' : ''"><path d="m6 9 6 6 6-6"/></svg>
              </button>
            </div>
          </template>
          </div>
        </transition>
      </div>
    </div>
  </transition>
    </div>

    <div
      v-if="amlLines.length > 0"
      class="lyrics-mask-shell h-full min-h-0 w-full min-w-0" 
      :class="alignClass"
      :style="playerVars"
    >
      <div class="lyrics-position-frame h-full min-h-0 w-full min-w-0"> 
        <WordLyricPlayer
          v-if="mountWordPlayer"
          ref="wordPlayerRef"
          class="word-lyric-host h-full min-h-0 w-full min-w-0"
          :lyric-lines="amlLines"
          :current-time="songTimeMs"
          :playing="nowPlaying"
          :disabled="props.disabled"
          :layout-version="stylePrefs.playerFontPreset"
          align-anchor="center" 
          :align-position="0.42" 
          :enable-spring="true" 
          :enable-blur="true" 
          :enable-scale="true" 
          :hide-passed-lines="false" 
          :word-fade-width="fadeWidth"
          :line-gap="stylePrefs.playerLineGap"
          @line-click="onLyricLineClick"
        />
      </div>
    </div>

    <div
      v-else
      class="no-lyrics flex h-full w-full items-center px-10 justify-center text-2xl font-medium text-white/30"
    >
      <div
        v-if="showPlainRows"
        class="plain-lyrics h-full w-full overflow-y-auto py-6 text-center text-xl font-normal leading-relaxed text-white/70"
      >
        <p v-for="(row, rowIndex) in plainRows" :key="rowIndex" class="whitespace-pre-line">
          {{ row }}
        </p>
      </div>
      <template v-else>{{ idleStateText }}</template>
    </div>

    <Teleport to="body"> 
      <transition name="font-preset-menu"> 
        <div
          v-if="isFontMenuVisible"
          ref="menuPanelRef"
          class="lyrics-settings-glass z-[120] flex flex-col overflow-hidden rounded-3xl border border-white/15 p-2 text-white shadow-[0_28px_70px_rgba(0,0,0,0.48)]" 
          :style="fontMenuPositionStyle"
          @click.stop
          @mousedown.stop 
        >
          <div class="min-h-0 space-y-1 overflow-y-auto pr-1 custom-scrollbar"> 
            <button 
              v-for="item in fontOptions"
              :key="item.value"
              type="button" 
              class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition" 
              :class="currentMenuPreset !== item.value
                ? 'text-white/72 hover:bg-white/[0.07] hover:text-white'
                : 'bg-white/[0.14] text-white active-font-preset'"
              @click="pickFontPreset(item.value)"
            >
              <span>{{ item.label }}</span>
              <span 
                v-if="currentMenuPreset === item.value"
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

<style scoped> /* 样式 */
.lyrics-settings-glass { /* 样式 */
  backdrop-filter: blur(32px) saturate(135%); /* 样式 */
  -webkit-backdrop-filter: blur(32px) saturate(135%);
  background: rgba(8, 8, 12, 0.74);
}

/* 歌词区域的上下羽化遮罩 */
.lyrics-mask-shell { /* 样式 */
  position: relative; /* 样式 */
  overflow: visible;
  isolation: isolate; /* 样式 */
  box-sizing: border-box;
  --lyrics-mask-bleed: 1.5em;
  --lyrics-edge-fade: 12%;
  --lyrics-edge-softness: 8%;
  width: calc(100% + var(--lyrics-mask-bleed) * 2) !important;
  margin-inline: calc(-1 * var(--lyrics-mask-bleed));
  padding-inline: var(--lyrics-mask-bleed);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.24) var(--lyrics-edge-softness), black var(--lyrics-edge-fade), black calc(100% - var(--lyrics-edge-fade)), rgba(0, 0, 0, 0.24) calc(100% - var(--lyrics-edge-softness)), transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.24) var(--lyrics-edge-softness), black var(--lyrics-edge-fade), black calc(100% - var(--lyrics-edge-fade)), rgba(0, 0, 0, 0.24) calc(100% - var(--lyrics-edge-softness)), transparent 100%);
  -webkit-mask-repeat: no-repeat; /* 样式 */
  mask-repeat: no-repeat; /* 样式 */
  -webkit-mask-size: 100% 100%; /* 样式 */
  mask-size: 100% 100%; /* 样式 */
}

.word-lyric-host { min-width: 0; min-height: 0; }

/* 位移层：偏移设置通过 CSS 变量生效 */
.lyrics-position-frame { /* 样式 */
  transform: translate3d(var(--lyrics-offset-x, 0%), var(--lyrics-offset-y, 0%), 0); /* 样式 */
  transition: transform 180ms ease; /* 样式 */
  will-change: transform; /* 样式 */
}

.lyrics-align-left { --lyrics-text-align: left; --lyrics-line-transform-origin: 0%; }

.lyrics-align-center { --lyrics-text-align: center; --lyrics-line-transform-origin: 50%; }

.lyrics-align-right { --lyrics-text-align: right; --lyrics-line-transform-origin: 100%; }

/* 面板进出场 */
.font-panel-enter-active, .font-panel-leave-active { transition: opacity 180ms ease, transform 180ms ease, backdrop-filter 180ms ease; will-change: transform, opacity; }

.font-panel-enter-from, .font-panel-leave-to { opacity: 0; transform: translateY(-6px) scale(0.98); backdrop-filter: blur(0px); }

/* 字体菜单进出场 */
.font-preset-menu-enter-active, .font-preset-menu-leave-active { transition: opacity 160ms ease, transform 160ms ease; }

.font-preset-menu-enter-from, .font-preset-menu-leave-to { opacity: 0; transform: translateY(-6px) scale(0.98); }

/* 页签切换 */
.tab-switch-enter-active, .tab-switch-leave-active { transition: opacity 200ms ease, transform 200ms ease; will-change: transform, opacity; }

.tab-switch-enter-from { opacity: 0; transform: translateX(12px); }

.tab-switch-leave-to { opacity: 0; transform: translateX(-12px); }
</style>
