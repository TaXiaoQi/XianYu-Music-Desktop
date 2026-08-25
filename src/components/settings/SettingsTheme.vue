<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next';
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useSettingsThemeControls } from '../../composables/useSettingsThemeControls';
import { skinModalOriginalTheme } from '../../composables/useCustomThemeModal';
import { useI18n } from '../../features/i18n';
import SettingHint from './SettingHint.vue';
import CustomColorPicker from './CustomColorPicker.vue';

const { isEnglish, t } = useI18n();

const SettingsSidebar = defineAsyncComponent(() => import('./SettingsSidebar.vue'));
const SettingsFooterLayout = defineAsyncComponent(() => import('./SettingsFooterLayout.vue'));
const SettingsTopBarLayout = defineAsyncComponent(() => import('./SettingsTopBarLayout.vue'));

const TEXT = computed(() => isEnglish.value ? {
  paletteTitle: 'Color Scheme',
  darkScheme: 'Dark',
  lightScheme: 'Light',
  systemScheme: 'Use System Setting',
  customEmoji: '🎨',
  customTitle: 'Custom Skin',
  customHint: 'Use an image, overlay, and foreground styles',
  customShort: 'Custom',
  accentTitle: 'Accent Color',
  accentHint: 'Used for buttons, selections, and interface accents',
  accentCustom: 'Custom Color',
  accentHex: 'HEX Value',
  accentReset: 'Reset to Default',
  playerDetailCoverTitle: 'Lyrics Page Cover',
  playerDetailCoverHint: 'Choose what to show whenever the Now Playing page opens',
  playerDetailCoverLabel: 'When opening the Now Playing page',
  playerDetailCoverShow: 'Always Show Cover',
  playerDetailCoverHide: 'Always Hide Cover',
  playerDetailCoverRemember: 'Remember Last Choice',
  dynamicTitle: 'Dynamic Background',
  dynamicHint: 'Changes with the album cover',
  dynamicOff: 'Off',
  dynamicFlow: 'Flowing Light',
  dynamicBlur: 'Static Blur',
  dynamicDisabledHint: 'Dynamic backgrounds are disabled while a custom skin or window material is active.',
  windowMaterialTitle: 'Window Material',
  windowMaterialBlur: 'Acrylic Blur',
  windowMaterialUnsupportedHint: 'Supported on Windows 10 and 11 only.',
  windowMaterialTransparencyHint: 'Enable transparency effects in Windows settings first.',
  windowMaterialConflictHint: 'Available after turning off the dynamic background or custom skin.',
  windowMaterialWin11Only: 'Windows 11 only',
  keepWindowMaterialOnBlur: 'Keep Material When Unfocused',
  keepWindowMaterialOnBlurHint: 'Keep the current material effect when the window loses focus whenever possible.',
  trayMenuTitle: 'Tray Menu',
  customTrayMenu: 'Use Custom Tray Menu',
  customTrayMenuHint: 'Use the tray menu drawn by XY-Music. Turn this off to use the native system menu.',
  customTrayMenuOn: 'Custom',
  customTrayMenuOff: 'System',
  leaderboardTitle: 'Home Leaderboard',
  leaderboardEnable: 'Show the listening leaderboard on Home',
  leaderboardHint: 'Turn this off to hide the listening leaderboard from Home.',
  switchStyleTitle: 'Switch Style',
  useGlassSwitch: 'Liquid Glass Switches',
  useGlassSwitchHint: 'Enable translucent glassmorphic refraction and sheen sweep for switches. Turn this off to use classic flat style.',
} : {
  paletteTitle: '配色方案',
  darkScheme: '深色',
  lightScheme: '浅色',
  systemScheme: '跟随系统',
  customEmoji: '🎨',
  customTitle: '自定义皮肤',
  customHint: '使用图片、遮罩和前景样式',
  customShort: '自定义',
  accentTitle: '主题色',
  accentHint: '用于按钮、选中状态和界面强调元素',
  accentCustom: '自定义颜色',
  accentHex: 'HEX 色值',
  accentReset: '恢复默认',
  playerDetailCoverTitle: '歌词页封面',
  playerDetailCoverHint: '设置每次打开播放详情页时的默认展示方式',
  playerDetailCoverLabel: '打开播放详情页时',
  playerDetailCoverShow: '始终展示封面',
  playerDetailCoverHide: '始终隐藏封面',
  playerDetailCoverRemember: '跟随上次选择',
  dynamicTitle: '动态背景',
  dynamicHint: '跟随封面变化',
  dynamicOff: '关闭',
  dynamicFlow: '流光',
  dynamicBlur: '静态模糊',
  dynamicDisabledHint: '自定义皮肤或窗口材质启用时，动态背景会自动停用。',
  windowMaterialTitle: '窗口材质',
  windowMaterialBlur: '毛玻璃',
  windowMaterialUnsupportedHint: '仅 Windows 10 / 11 支持。',
  windowMaterialTransparencyHint: '需在系统设置中开启透明效果后才可用。',
  windowMaterialConflictHint: '关闭动态背景或自定义皮肤后可用。',
  windowMaterialWin11Only: '仅 Windows 11 支持',
  keepWindowMaterialOnBlur: '失焦保持材质',
  keepWindowMaterialOnBlurHint: '开启后窗口失焦时仍会尝试保持当前材质效果。',
  trayMenuTitle: '托盘菜单',
  customTrayMenu: '启动自定义托盘',
  customTrayMenuHint: '开启后默认使用 XY-Music 绘制的托盘菜单；关闭后使用系统原生菜单。',
  customTrayMenuOn: '自定义',
  customTrayMenuOff: '系统',
  leaderboardTitle: '首页排行榜',
  leaderboardEnable: '是否在首页展示听歌排行榜',
  leaderboardHint: '关闭后首页将不再显示听歌排行榜。',
  switchStyleTitle: '开关样式',
  useGlassSwitch: '液态玻璃按钮效果',
  useGlassSwitchHint: '开启后全软件开关呈现晶莹透光玻璃折射与流光动画；关闭后切回经典极简风格。',
});

const FLOW_TEXT = computed(() => isEnglish.value ? {
  panelTitle: 'Flowing Light Tuning',
  colorBoost: 'Color Intensity',
  depth: 'Light and Dark Depth',
  speed: 'Flow Speed',
  texture: 'Texture Intensity',
  subtle: 'Subtle',
  vivid: 'Vivid',
  airy: 'Airy',
  deep: 'Deep',
  calm: 'Calm',
  brisk: 'Lively',
  clean: 'Clean',
  textured: 'Textured',
  toggleLabel: 'Expand or collapse Flowing Light tuning',
} : {
  panelTitle: '\u6d41\u5149\u5fae\u8c03',
  colorBoost: '\u8272\u5f69\u5f3a\u5ea6',
  depth: '\u660e\u6697\u6df1\u5ea6',
  speed: '\u6d41\u52a8\u901f\u5ea6',
  texture: '\u7eb9\u7406\u5f3a\u5ea6',
  subtle: '\u67d4\u548c',
  vivid: '\u9c9c\u8273',
  airy: '\u901a\u900f',
  deep: '\u6df1\u9083',
  calm: '\u8212\u7f13',
  brisk: '\u7075\u52a8',
  clean: '\u5e72\u51c0',
  textured: '\u7ec6\u817b',
  toggleLabel: '\u5c55\u5f00\u6216\u6536\u8d77\u6d41\u5149\u5fae\u8c03',
});

const BLUR_TEXT = computed(() => isEnglish.value ? {
  panelTitle: 'Overlay Intensity',
  tint: 'Overlay Opacity',
  clear: 'Clear',
  solid: 'Solid',
  toggleLabel: 'Expand or collapse Static Blur tuning',
} : {
  panelTitle: '\u906e\u7f69\u6d53\u5ea6',
  tint: '\u906e\u7f69\u6d53\u6de1',
  clear: '\u901a\u900f',
  solid: '\u5b9e\u8272',
  toggleLabel: '\u5c55\u5f00\u6216\u6536\u8d77\u6bdb\u73bb\u7483\u5fae\u8c03',
});

const ACCENT_COLOR_PRESETS = computed(() => isEnglish.value ? [
  { label: 'Classic Red', value: '#EC4141' },
  { label: 'Coral', value: '#F9735B' },
  { label: 'Amber', value: '#F59E0B' },
  { label: 'Emerald', value: '#22C55E' },
  { label: 'Cyan', value: '#06B6D4' },
  { label: 'Lake Blue', value: '#3B82F6' },
  { label: 'Iris', value: '#8B5CF6' },
  { label: 'Rose', value: '#EC4899' },
] : [
  { label: '\u7ecf\u5178\u7ea2', value: '#EC4141' },
  { label: '\u73ca\u745a', value: '#F9735B' },
  { label: '\u7425\u73c0', value: '#F59E0B' },
  { label: '\u7fe1\u7fe0', value: '#22C55E' },
  { label: '\u9752\u7eff', value: '#06B6D4' },
  { label: '\u6e56\u84dd', value: '#3B82F6' },
  { label: '\u9e22\u5c3e\u7d2b', value: '#8B5CF6' },
  { label: '\u8537\u8587', value: '#EC4899' },
]);

const {
  theme,
  colorScheme,
  materialMode,
  keepWindowMaterialOnBlur,
  useCustomTrayMenu,
  showLeaderboard,
  playerDetailCoverBehavior,
  isWindowMaterialDisabled,
  isWindowMaterialButtonDisabled,
  getWindowMaterialModeDisabledReason,
  windowMaterialDisabledReason,
  isDynamicBgDisabled,
  showFlowTuning,
  showBlurTuning,
  setColorScheme,
  setAccentColor,
  resetAccentColor,
  setDynamicType,
  toggleWindowMaterial,
  openCustomModal,
  toggleFlowTuning,
  toggleBlurTuning,
  setFlowColorBoost,
  setFlowDepth,
  setFlowSpeed,
  setFlowTexture,
  setWindowBlurTint,
  setKeepWindowMaterialOnBlur,
  setUseCustomTrayMenu,
  useGlassSwitch,
  setUseGlassSwitch,
  setShowLeaderboard,
  setPlayerDetailCoverBehavior,
} = useSettingsThemeControls();

const commitAccentColor = (event: Event) => {
  const input = event.target as HTMLInputElement;
  setAccentColor(input.value);
  input.value = theme.value.accentColor;
};

const openCustomSkin = () => {
  // 保存当前主题，取消时恢复配色方案与窗口材质
  skinModalOriginalTheme.value = {
    ...theme.value,
    customBackground: { ...theme.value.customBackground },
  };
  setColorScheme('custom');
  openCustomModal();
};

// ---- 自定义 2D 调色盘弹窗控制器 ----
const isCustomColorPickerOpen = ref(false);
const colorPickerTriggerRef = ref<HTMLElement | null>(null);

function toggleCustomColorPicker() {
  isCustomColorPickerOpen.value = !isCustomColorPickerOpen.value;
}

// ---- 歌词页封面选择（自定义弹窗，替代原生 <select>） ----
const COVER_OPTIONS = computed<Array<{ value: 'show' | 'hide' | 'remember'; label: string }>>(() => [
  { value: 'show', label: TEXT.value.playerDetailCoverShow },
  { value: 'hide', label: TEXT.value.playerDetailCoverHide },
  { value: 'remember', label: TEXT.value.playerDetailCoverRemember },
]);

const selectedCoverOption = computed(() =>
  COVER_OPTIONS.value.find((option) => option.value === playerDetailCoverBehavior.value),
);

const coverTriggerRef = ref<HTMLElement | null>(null);
const coverMenuRef = ref<HTMLElement | null>(null);
const isCoverMenuOpen = ref(false);
const coverMenuStyle = ref<Record<string, string>>({});

async function toggleCoverMenu() {
  isCoverMenuOpen.value = !isCoverMenuOpen.value;
  if (isCoverMenuOpen.value) {
    await nextTick();
    updateCoverMenuPosition();
  }
}

function closeCoverMenu() {
  isCoverMenuOpen.value = false;
}

function updateCoverMenuPosition() {
  const trigger = coverTriggerRef.value;
  if (!trigger) return;

  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 16;
  const gap = 8;
  const menuWidth = Math.max(rect.width, 200);
  const menuHeight = 160; // 3 选项 + padding，足够

  let left = rect.right - menuWidth;
  left = Math.min(left, window.innerWidth - viewportPadding - menuWidth);
  left = Math.max(viewportPadding, left);

  const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
  const shouldOpenUpward = availableBelow < menuHeight && rect.top - viewportPadding > menuHeight;

  coverMenuStyle.value = shouldOpenUpward
    ? {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(window.innerHeight - rect.top + gap)}px`,
        width: `${Math.round(menuWidth)}px`,
      }
    : {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(rect.bottom + gap)}px`,
        width: `${Math.round(menuWidth)}px`,
      };
}

function handleCoverSelect(value: 'show' | 'hide' | 'remember') {
  setPlayerDetailCoverBehavior(value);
  closeCoverMenu();
}

function handlePointerDownOutside(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (coverTriggerRef.value?.contains(target)) return;
  if (coverMenuRef.value?.contains(target)) return;
  closeCoverMenu();
}

function handleCoverEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') closeCoverMenu();
}

function handleCoverViewportChange() {
  if (isCoverMenuOpen.value) updateCoverMenuPosition();
}

onMounted(() => {
  window.addEventListener('mousedown', handlePointerDownOutside);
  window.addEventListener('keydown', handleCoverEscape);
  window.addEventListener('resize', handleCoverViewportChange);
  document.addEventListener('scroll', handleCoverViewportChange, true);
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handlePointerDownOutside);
  window.removeEventListener('keydown', handleCoverEscape);
  window.removeEventListener('resize', handleCoverViewportChange);
  document.removeEventListener('scroll', handleCoverViewportChange, true);
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ TEXT.paletteTitle }}
      </h2>
      <div class="">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <button
            type="button"
            class="group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all"
            :class="colorScheme === 'light' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setColorScheme('light')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            <span class="text-sm font-semibold">{{ TEXT.lightScheme }}</span>
          </button>

          <button
            type="button"
            class="group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all"
            :class="colorScheme === 'dark' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setColorScheme('dark')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            <span class="text-sm font-semibold">{{ TEXT.darkScheme }}</span>
          </button>

          <button
            type="button"
            class="group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all"
            :class="colorScheme === 'system' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setColorScheme('system')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            <span class="text-sm font-semibold">{{ TEXT.systemScheme }}</span>
          </button>

          <button
            type="button"
            class="group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all"
            :class="colorScheme === 'custom' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="openCustomSkin()"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"></path></svg>
            <span class="text-sm font-semibold">{{ TEXT.customShort }}</span>
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ TEXT.dynamicTitle }}
        </span>
        <SettingHint :text="isDynamicBgDisabled ? `${TEXT.dynamicHint} ${TEXT.dynamicDisabledHint}` : TEXT.dynamicHint" />
      </h2>
      <div class="space-y-4">
        <div :class="isDynamicBgDisabled ? 'pointer-events-none opacity-50' : ''">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <button
              type="button"
              class="rounded-xl border px-4 py-3 text-left transition-all"
              :class="theme.dynamicBgType === 'none'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10'"
              @click="setDynamicType('none')"
            >
              <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.dynamicOff }}</div>
            </button>

            <div class="relative">
              <button
                type="button"
                class="w-full rounded-xl border px-4 py-3 pr-12 text-left transition-all"
                :class="theme.dynamicBgType === 'flow'
                  ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                  : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10'"
                @click="setDynamicType('flow')"
              >
                <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.dynamicFlow }}</div>
              </button>

              <button
                type="button"
                class="absolute bottom-3 right-3 rounded-full p-1 text-[#EC4141]/70 opacity-40 transition-all duration-300 hover:bg-[#EC4141]/10 hover:opacity-100"
                :class="showFlowTuning && theme.dynamicBgType === 'flow' ? 'bg-[#EC4141]/10 opacity-100' : ''"
                :aria-label="FLOW_TEXT.toggleLabel"
                @click.stop="toggleFlowTuning"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 transition-transform duration-300"
                  :class="showFlowTuning && theme.dynamicBgType === 'flow' ? 'rotate-180' : ''"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              class="rounded-xl border px-4 py-3 text-left transition-all"
              :class="theme.dynamicBgType === 'blur'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10'"
              @click="setDynamicType('blur')"
            >
              <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.dynamicBlur }}</div>
            </button>
          </div>

          <transition name="flow-panel">
            <div
              v-if="theme.dynamicBgType === 'flow' && showFlowTuning && !isDynamicBgDisabled"
              class="mt-4 rounded-2xl border border-gray-200/50 bg-white/30 p-4 shadow-lg backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-black/20"
            >
              <div class="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ FLOW_TEXT.panelTitle }}</div>
                  <div class="text-xs text-gray-600 dark:text-white/60">XY-Music Flow</div>
                </div>
                <div class="rounded-full bg-[#EC4141]/10 px-2.5 py-1 text-[11px] font-medium text-[#EC4141]">
                  {{ theme.flowColorBoost }} / {{ theme.flowDepth }} / {{ theme.flowSpeed }} / {{ theme.flowTexture }}
                </div>
              </div>

              <div class="space-y-4">
              <label class="block">
                <div class="mb-1.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ FLOW_TEXT.colorBoost }}</div>
                  </div>
                  <div class="text-xs font-medium tabular-nums text-[#EC4141]">{{ theme.flowColorBoost }}</div>
                </div>
                <input
                  :value="theme.flowColorBoost"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flow-slider"
                  @input="setFlowColorBoost(Number(($event.target as HTMLInputElement).value))"
                />
                <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                  <span>{{ FLOW_TEXT.subtle }}</span>
                  <span>{{ FLOW_TEXT.vivid }}</span>
                </div>
              </label>

              <label class="block">
                <div class="mb-1.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ FLOW_TEXT.depth }}</div>
                  </div>
                  <div class="text-xs font-medium tabular-nums text-[#EC4141]">{{ theme.flowDepth }}</div>
                </div>
                <input
                  :value="theme.flowDepth"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flow-slider"
                  @input="setFlowDepth(Number(($event.target as HTMLInputElement).value))"
                />
                <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                  <span>{{ FLOW_TEXT.airy }}</span>
                  <span>{{ FLOW_TEXT.deep }}</span>
                </div>
              </label>

              <label class="block">
                <div class="mb-1.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ FLOW_TEXT.speed }}</div>
                  </div>
                  <div class="text-xs font-medium tabular-nums text-[#EC4141]">{{ theme.flowSpeed }}</div>
                </div>
                <input
                  :value="theme.flowSpeed"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flow-slider"
                  @input="setFlowSpeed(Number(($event.target as HTMLInputElement).value))"
                />
                <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                  <span>{{ FLOW_TEXT.calm }}</span>
                  <span>{{ FLOW_TEXT.brisk }}</span>
                </div>
              </label>

              <label class="block">
                <div class="mb-1.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ FLOW_TEXT.texture }}</div>
                  </div>
                  <div class="text-xs font-medium tabular-nums text-[#EC4141]">{{ theme.flowTexture }}</div>
                </div>
                <input
                  :value="theme.flowTexture"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flow-slider"
                  @input="setFlowTexture(Number(($event.target as HTMLInputElement).value))"
                />
                <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                  <span>{{ FLOW_TEXT.clean }}</span>
                  <span>{{ FLOW_TEXT.textured }}</span>
                </div>
              </label>
            </div>
          </div>
        </transition>

      </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ TEXT.windowMaterialTitle }}
        </span>
        <SettingHint
          v-if="windowMaterialDisabledReason"
          :text="windowMaterialDisabledReason === 'windows'
            ? TEXT.windowMaterialUnsupportedHint
            : windowMaterialDisabledReason === 'transparency'
              ? TEXT.windowMaterialTransparencyHint
              : TEXT.windowMaterialConflictHint"
        />
      </h2>
      <div
        class=""
        :class="isWindowMaterialDisabled ? 'opacity-50' : ''"
      >
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <button
            type="button"
            class="rounded-xl border px-4 py-3 text-left transition-all"
            :class="[
              materialMode === 'acrylic'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10',
              isWindowMaterialButtonDisabled('acrylic') ? 'cursor-not-allowed opacity-45' : '',
            ]"
            :disabled="isWindowMaterialButtonDisabled('acrylic')"
            :aria-disabled="isWindowMaterialButtonDisabled('acrylic')"
            :title="getWindowMaterialModeDisabledReason('acrylic') === 'windows11' ? TEXT.windowMaterialWin11Only : ''"
            @click="toggleWindowMaterial('acrylic')"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">Acrylic</span>
            </div>
          </button>

          <button
            type="button"
            class="rounded-xl border px-4 py-3 text-left transition-all"
            :class="[
              materialMode === 'mica'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10',
              isWindowMaterialButtonDisabled('mica') ? 'cursor-not-allowed opacity-45' : '',
            ]"
            :disabled="isWindowMaterialButtonDisabled('mica')"
            :aria-disabled="isWindowMaterialButtonDisabled('mica')"
            :title="getWindowMaterialModeDisabledReason('mica') === 'windows11' ? TEXT.windowMaterialWin11Only : ''"
            @click="toggleWindowMaterial('mica')"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">Mica</span>
            </div>
          </button>

          <div class="relative">
            <button
              type="button"
              class="w-full rounded-xl border px-4 py-3 pr-12 text-left transition-all"
              :class="[
                materialMode === 'blur'
                  ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                  : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10',
                isWindowMaterialButtonDisabled('blur') ? 'cursor-not-allowed opacity-45' : '',
              ]"
              :disabled="isWindowMaterialButtonDisabled('blur')"
              :aria-disabled="isWindowMaterialButtonDisabled('blur')"
              @click="toggleWindowMaterial('blur')"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.windowMaterialBlur }}</span>
              </div>
            </button>

            <button
              type="button"
              class="absolute bottom-3 right-3 rounded-full p-1 text-[#EC4141]/70 opacity-40 transition-all duration-300 hover:bg-[#EC4141]/10 hover:opacity-100"
              :class="showBlurTuning && materialMode === 'blur' ? 'bg-[#EC4141]/10 opacity-100' : ''"
              :aria-label="BLUR_TEXT.toggleLabel"
              @click.stop="toggleBlurTuning"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 transition-transform duration-300"
                :class="showBlurTuning && materialMode === 'blur' ? 'rotate-180' : ''"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        <div
          class="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 transition-all dark:border-gray-800/40 dark:bg-black/10"
          :class="materialMode === 'none' ? 'opacity-50' : 'hover:border-[#EC4141]/35 hover:bg-white/30 dark:hover:bg-white/10'"
        >
          <span class="min-w-0 text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.keepWindowMaterialOnBlur }}</span>
          <span class="flex items-center gap-3">
            <SettingHint :text="TEXT.keepWindowMaterialOnBlurHint" />
            <button
              type="button"
              class="glass-switch"
              :class="{ 'is-checked': keepWindowMaterialOnBlur && materialMode !== 'none' }"
              :disabled="materialMode === 'none'"
              @click="setKeepWindowMaterialOnBlur(!keepWindowMaterialOnBlur)"
            ></button>
          </span>
        </div>

        <transition name="flow-panel">
          <div
            v-if="materialMode === 'blur' && showBlurTuning"
            class="mt-4 rounded-2xl border border-gray-200/50 bg-white/30 p-4 shadow-lg backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-black/20"
          >
            <div class="mb-4 flex items-center justify-between gap-3">
              <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ BLUR_TEXT.panelTitle }}</div>
              <div class="rounded-full bg-[#EC4141]/10 px-2.5 py-1 text-[11px] font-medium text-[#EC4141]">
                {{ theme.windowBlurTint }}
              </div>
            </div>

            <label class="block">
              <input
                :value="theme.windowBlurTint"
                type="range"
                min="0"
                max="100"
                step="1"
                class="flow-slider"
                @input="setWindowBlurTint(Number(($event.target as HTMLInputElement).value))"
              />
              <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                <span>{{ BLUR_TEXT.clear }}</span>
                <span>{{ BLUR_TEXT.solid }}</span>
              </div>
            </label>
          </div>
        </transition>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ TEXT.accentTitle }}
        </span>
        <SettingHint :text="TEXT.accentHint" />
      </h2>

      <div class="rounded-2xl border border-gray-200/40 bg-white/20 p-4 dark:border-gray-800/40 dark:bg-black/10">
        <div class="grid grid-cols-4 gap-3 sm:grid-cols-8">
          <button
            v-for="preset in ACCENT_COLOR_PRESETS"
            :key="preset.value"
            type="button"
            class="group flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 transition-all"
            :class="theme.accentColor === preset.value
              ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
              : 'border-gray-200/50 bg-white/25 hover:-translate-y-0.5 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'"
            :aria-pressed="theme.accentColor === preset.value"
            @click="setAccentColor(preset.value)"
          >
            <span
              class="h-7 w-7 rounded-full border-2 border-white shadow-sm ring-1 ring-black/10 transition-transform group-hover:scale-110 dark:ring-white/20"
              :style="{ backgroundColor: preset.value }"
            ></span>
            <span class="w-full truncate text-center text-[11px] font-medium text-gray-600 dark:text-white/60">
              {{ preset.label }}
            </span>
          </button>
        </div>

        <div class="mt-4 flex flex-col gap-3 border-t border-gray-200/40 pt-4 sm:flex-row sm:items-end dark:border-white/10">
          <label class="flex min-w-0 flex-1 items-center gap-3">
            <span class="text-xs font-medium text-gray-600 dark:text-white/60">{{ TEXT.accentCustom }}</span>
            <button
              ref="colorPickerTriggerRef"
              type="button"
              class="relative h-9 w-12 shrink-0 overflow-hidden rounded-xl border border-black/10 shadow-sm transition-transform active:scale-95 dark:border-white/15 cursor-pointer"
              :title="TEXT.accentCustom"
              @click="toggleCustomColorPicker"
            >
              <span
                class="absolute inset-0 transition-colors"
                :style="{ backgroundColor: theme.accentColor }"
              ></span>
            </button>

            <!-- 具备大圆角（rounded-2xl）与平滑打开/关闭动画（picker-pop）的 2D 调色盘面板 -->
            <CustomColorPicker
              :model-value="theme.accentColor"
              :is-open="isCustomColorPickerOpen"
              :trigger-ref="colorPickerTriggerRef"
              @update:model-value="setAccentColor"
              @close="isCustomColorPickerOpen = false"
            />
          </label>

          <label class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class="text-xs font-medium text-gray-600 dark:text-white/60">{{ TEXT.accentHex }}</span>
            <input
              :value="theme.accentColor"
              type="text"
              maxlength="7"
              spellcheck="false"
              class="h-9 rounded-lg border border-black/10 bg-white/45 px-3 font-mono text-xs uppercase text-gray-800 outline-none transition focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              placeholder="#EC4141"
              @change="commitAccentColor"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
          </label>

          <button
            type="button"
            class="h-9 shrink-0 rounded-lg border border-gray-200/60 bg-white/30 px-3 text-xs font-medium text-gray-600 transition hover:border-[#EC4141]/40 hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
            :disabled="theme.accentColor === '#EC4141'"
            :class="theme.accentColor === '#EC4141' ? 'cursor-not-allowed opacity-40' : ''"
            @click="resetAccentColor"
          >
            {{ TEXT.accentReset }}
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ TEXT.playerDetailCoverTitle }}
        </span>
        <SettingHint :text="TEXT.playerDetailCoverHint" />
      </h2>

      <label class="relative flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10">
        <span class="min-w-0 text-sm font-semibold text-gray-800 dark:text-gray-200">
          {{ TEXT.playerDetailCoverLabel }}
        </span>
        <button
          ref="coverTriggerRef"
          type="button"
          class="cover-select-trigger flex h-9 w-52 shrink-0 items-center justify-between gap-2 rounded-lg border border-black/10 bg-white/55 px-3 text-xs font-medium text-gray-700 transition hover:bg-white/70 focus:border-[#EC4141]/50 focus:outline-none focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/[0.15]"
          :class="isCoverMenuOpen ? 'cover-select-trigger--open' : ''"
          @click="toggleCoverMenu"
        >
          <span class="truncate">{{ selectedCoverOption?.label }}</span>
          <ChevronDown class="h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-gray-500" :class="isCoverMenuOpen ? 'rotate-180' : ''" aria-hidden="true" />
        </button>

        <Teleport to="body">
          <Transition name="cover-select-menu">
            <div
              v-if="isCoverMenuOpen"
              ref="coverMenuRef"
              class="cover-select-menu"
              :style="coverMenuStyle"
              @click.stop
              @mousedown.stop
            >
              <div class="cover-select-list">
                <button
                  v-for="option in COVER_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="cover-select-option"
                  :class="playerDetailCoverBehavior === option.value ? 'cover-select-option--active' : ''"
                  @click="handleCoverSelect(option.value)"
                >
                  <span>{{ option.label }}</span>
                  <Check v-if="playerDetailCoverBehavior === option.value" class="h-4 w-4 shrink-0" />
                </button>
              </div>
            </div>
          </Transition>
        </Teleport>
      </label>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ TEXT.trayMenuTitle }}
        </span>
        <SettingHint :text="TEXT.customTrayMenuHint" />
      </h2>

      <div class="flex items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 transition-all hover:border-[#EC4141]/35 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:bg-white/10">
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.customTrayMenu }}</span>
          <span class="mt-1 block text-xs text-gray-500 dark:text-white/50">
            {{ useCustomTrayMenu ? TEXT.customTrayMenuOn : TEXT.customTrayMenuOff }}
          </span>
        </span>
        <button
          type="button"
          class="glass-switch"
          :class="{ 'is-checked': useCustomTrayMenu }"
          @click="setUseCustomTrayMenu(!useCustomTrayMenu)"
        ></button>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ TEXT.leaderboardTitle }}
        </span>
        <SettingHint :text="TEXT.leaderboardHint" />
      </h2>

      <div class="flex items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 transition-all hover:border-[#EC4141]/35 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:bg-white/10">
        <span class="min-w-0 text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.leaderboardEnable }}</span>
        <button
          type="button"
          class="glass-switch"
          :class="{ 'is-checked': showLeaderboard }"
          @click="setShowLeaderboard(!showLeaderboard)"
        ></button>
      </div>
    </section>

    <!-- 开关样式设置 -->
    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ TEXT.switchStyleTitle }}
        </span>
        <SettingHint :text="TEXT.useGlassSwitchHint" />
      </h2>

      <div class="flex flex-col gap-3 rounded-2xl border border-gray-200/40 bg-white/20 p-4 dark:border-gray-800/40 dark:bg-black/10">
        <div class="grid grid-cols-2 gap-3">
          <button
            type="button"
            class="group flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-all cursor-pointer"
            :class="useGlassSwitch
              ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]'
              : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setUseGlassSwitch(true)"
          >
            <div class="flex items-center gap-2 text-sm font-semibold">
              <span class="text-base">💧</span>
              {{ t('theme.glassSwitch') }}
            </div>
            <div class="text-xs opacity-75 leading-relaxed">{{ t('theme.glassSwitchDesc') }}</div>
          </button>

          <button
            type="button"
            class="group flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-all cursor-pointer"
            :class="!useGlassSwitch
              ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]'
              : 'border-gray-200/40 bg-white/20 hover:border-[#EC4141]/40 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setUseGlassSwitch(false)"
          >
            <div class="flex items-center gap-2 text-sm font-semibold">
              <span class="text-base">🔳</span>
              {{ t('theme.flatSwitch') }}
            </div>
            <div class="text-xs opacity-75 leading-relaxed">{{ t('theme.flatSwitchDesc') }}</div>
          </button>
        </div>

        <div class="flex items-center justify-between pt-3 mt-1 border-t border-black/5 dark:border-white/5">
          <span class="text-xs font-medium text-gray-700 dark:text-gray-200">{{ TEXT.useGlassSwitch }}</span>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': useGlassSwitch }"
            @click="setUseGlassSwitch(!useGlassSwitch)"
          ></button>
        </div>
      </div>
    </section>

    <!-- 侧边栏管理（并入外观） -->
    <SettingsSidebar />

    <!-- 顶部栏布局（并入外观，修改即时生效） -->
    <SettingsTopBarLayout />

    <!-- 底部栏布局（并入外观，修改即时生效） -->
    <SettingsFooterLayout />
  </div>
</template>

<style scoped>
.flow-panel-enter-active,
.flow-panel-leave-active {
  transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: top center;
}

.flow-panel-enter-from,
.flow-panel-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-10px);
}

.flow-slider {
  width: 100%;
  height: 6px;
  border-radius: 9999px;
  appearance: none;
  background: linear-gradient(90deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.62));
  outline: none;
}

.flow-slider::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  appearance: none;
  background: #ec4141;
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.35);
  cursor: pointer;
}

.flow-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  background: #ec4141;
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.35);
  cursor: pointer;
}

/* ---- 歌词页封面 inline 下拉面板 ---- */
.cover-select-trigger {
  cursor: pointer;
}

.cover-select-trigger--open {
  border-color: rgba(236, 65, 65, 0.5);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.1);
}

.cover-select-menu {
  overflow: hidden;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.16), 0 8px 20px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  z-index: 120;
}

.dark .cover-select-menu {
  background: rgba(43, 43, 43, 0.9);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.34), 0 8px 20px rgba(0, 0, 0, 0.24);
}

.cover-select-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cover-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  text-align: left;
  font-size: 13px;
  font-weight: 500;
  color: rgb(55 65 81);
  background: transparent;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.dark .cover-select-option {
  color: rgba(255, 255, 255, 0.86);
}

.cover-select-option:hover {
  border-color: rgba(236, 65, 65, 0.16);
  background: rgba(236, 65, 65, 0.06);
  color: rgb(17 24 39);
}

.dark .cover-select-option:hover {
  border-color: rgba(236, 65, 65, 0.22);
  background: rgba(236, 65, 65, 0.1);
  color: rgba(255, 255, 255, 0.98);
}

.cover-select-option--active,
.cover-select-option--active:hover {
  border-color: rgba(236, 65, 65, 0.2);
  background: linear-gradient(180deg, rgba(236, 65, 65, 0.12), rgba(236, 65, 65, 0.06));
  color: #ec4141;
}

.dark .cover-select-option--active,
.dark .cover-select-option--active:hover {
  border-color: rgba(236, 65, 65, 0.28);
  background: linear-gradient(180deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.08));
  color: #ff9a9a;
}

.cover-select-menu-enter-active,
.cover-select-menu-leave-active {
  transition: opacity 160ms ease, transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: top right;
}

.cover-select-menu-enter-from,
.cover-select-menu-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}
</style>
