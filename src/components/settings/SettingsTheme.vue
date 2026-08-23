<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next';
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useSettingsThemeControls } from '../../composables/useSettingsThemeControls';
import { useI18n } from '../../features/i18n';
import SettingHint from './SettingHint.vue';
import ColorPickerPopover from './ColorPickerPopover.vue';

const { isEnglish } = useI18n();

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
} : {
  paletteTitle: '\u914d\u8272\u65b9\u6848',
  darkScheme: '\u6df1\u8272',
  lightScheme: '\u6d45\u8272',
  systemScheme: '\u8ddf\u968f\u7cfb\u7edf',
  customEmoji: '\u{1F3A8}',
  customTitle: '\u81ea\u5b9a\u4e49\u76ae\u80a4',
  customHint: '\u4f7f\u7528\u56fe\u7247\u3001\u906e\u7f69\u548c\u524d\u666f\u6837\u5f0f',
  customShort: '\u81ea\u5b9a\u4e49',
  accentTitle: '\u4e3b\u9898\u8272',
  accentHint: '\u7528\u4e8e\u6309\u94ae\u3001\u9009\u4e2d\u72b6\u6001\u548c\u754c\u9762\u5f3a\u8c03\u5143\u7d20',
  accentCustom: '\u81ea\u5b9a\u4e49\u989c\u8272',
  accentHex: 'HEX \u8272\u503c',
  accentReset: '\u6062\u590d\u9ed8\u8ba4',
  playerDetailCoverTitle: '\u6b4c\u8bcd\u9875\u5c01\u9762',
  playerDetailCoverHint: '\u8bbe\u7f6e\u6bcf\u6b21\u6253\u5f00\u64ad\u653e\u8be6\u60c5\u9875\u65f6\u7684\u9ed8\u8ba4\u5c55\u793a\u65b9\u5f0f',
  playerDetailCoverLabel: '\u6253\u5f00\u64ad\u653e\u8be6\u60c5\u9875\u65f6',
  playerDetailCoverShow: '\u59cb\u7ec8\u5c55\u793a\u5c01\u9762',
  playerDetailCoverHide: '\u59cb\u7ec8\u9690\u85cf\u5c01\u9762',
  playerDetailCoverRemember: '\u8ddf\u968f\u4e0a\u6b21\u9009\u62e9',
  dynamicTitle: '\u52a8\u6001\u80cc\u666f',
  dynamicHint: '\u8ddf\u968f\u5c01\u9762\u53d8\u5316',
  dynamicOff: '\u5173\u95ed',
  dynamicFlow: '\u6d41\u5149',
  dynamicBlur: '\u9759\u6001\u6a21\u7cca',
  dynamicDisabledHint: '\u81ea\u5b9a\u4e49\u76ae\u80a4\u6216\u7a97\u53e3\u6750\u8d28\u542f\u7528\u65f6\uff0c\u52a8\u6001\u80cc\u666f\u4f1a\u81ea\u52a8\u505c\u7528\u3002',
  windowMaterialTitle: '\u7a97\u53e3\u6750\u8d28',
  windowMaterialBlur: '\u6bdb\u73bb\u7483',
  windowMaterialUnsupportedHint: '\u4ec5 Windows 10 / 11 \u652f\u6301\u3002',
  windowMaterialTransparencyHint: '\u9700\u5728\u7cfb\u7edf\u8bbe\u7f6e\u4e2d\u5f00\u542f\u900f\u660e\u6548\u679c\u540e\u624d\u53ef\u7528\u3002',
  windowMaterialConflictHint: '\u5173\u95ed\u52a8\u6001\u80cc\u666f\u6216\u81ea\u5b9a\u4e49\u76ae\u80a4\u540e\u53ef\u7528\u3002',
  windowMaterialWin11Only: '\u4ec5 Windows 11 \u652f\u6301',
  keepWindowMaterialOnBlur: '\u5931\u7126\u4fdd\u6301\u6750\u8d28',
  keepWindowMaterialOnBlurHint: '\u5f00\u542f\u540e\u7a97\u53e3\u5931\u7126\u65f6\u4ecd\u4f1a\u5c1d\u8bd5\u4fdd\u6301\u5f53\u524d\u6750\u8d28\u6548\u679c\u3002',
  trayMenuTitle: '\u6258\u76d8\u83dc\u5355',
  customTrayMenu: '\u542f\u52a8\u81ea\u5b9a\u4e49\u6258\u76d8',
  customTrayMenuHint: '\u5f00\u542f\u540e\u9ed8\u8ba4\u4f7f\u7528 XY-Music \u7ed8\u5236\u7684\u6258\u76d8\u83dc\u5355\uff1b\u5173\u95ed\u540e\u4f7f\u7528\u7cfb\u7edf\u539f\u751f\u83dc\u5355\u3002',
  customTrayMenuOn: '\u81ea\u5b9a\u4e49',
  customTrayMenuOff: '\u7cfb\u7edf',
  leaderboardTitle: '\u9996\u9875\u6392\u884c\u699c',
  leaderboardEnable: '\u662f\u5426\u5728\u9996\u9875\u5c55\u793a\u542c\u6b4c\u6392\u884c\u699c',
  leaderboardHint: '\u5173\u95ed\u540e\u9996\u9875\u5c06\u4e0d\u518d\u663e\u793a\u542c\u6b4c\u6392\u884c\u699c\u3002',
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
  setShowLeaderboard,
  setPlayerDetailCoverBehavior,
} = useSettingsThemeControls();

const commitAccentColor = (event: Event) => {
  const input = event.target as HTMLInputElement;
  setAccentColor(input.value);
  input.value = theme.value.accentColor;
};

// ---- 自定义主题色调色盘弹窗 ----
const isPickerOpen = ref(false);
const pickerTriggerRef = ref<HTMLElement | null>(null);

const toggleColorPicker = () => {
  isPickerOpen.value = !isPickerOpen.value;
};

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
            @click="setColorScheme('custom'); openCustomModal()"
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
              class="mt-4 rounded-2xl border border-gray-200/40 bg-white/20 p-4 shadow-sm dark:border-gray-800/40 dark:bg-black/10"
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

        <label
          class="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 transition-all dark:border-gray-800/40 dark:bg-black/10"
          :class="materialMode === 'none' ? 'cursor-not-allowed opacity-50' : 'hover:border-[#EC4141]/35 hover:bg-white/30 dark:hover:bg-white/10'"
        >
          <span class="min-w-0 text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.keepWindowMaterialOnBlur }}</span>
          <input
            type="checkbox"
            class="sr-only"
            :checked="keepWindowMaterialOnBlur"
            :disabled="materialMode === 'none'"
            @change="setKeepWindowMaterialOnBlur(($event.target as HTMLInputElement).checked)"
          />
          <span class="flex items-center gap-3">
            <SettingHint :text="TEXT.keepWindowMaterialOnBlurHint" />
            <span
              class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              :class="keepWindowMaterialOnBlur && materialMode !== 'none' ? 'bg-[#EC4141]' : 'bg-gray-300/70 dark:bg-white/20'"
            >
              <span
                class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                :class="keepWindowMaterialOnBlur && materialMode !== 'none' ? 'translate-x-5' : ''"
              ></span>
            </span>
          </span>
        </label>

        <transition name="flow-panel">
          <div
            v-if="materialMode === 'blur' && showBlurTuning"
            class="mt-4 rounded-2xl border border-gray-200/40 bg-white/20 p-4 shadow-sm dark:border-gray-800/40 dark:bg-black/10"
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
              ref="pickerTriggerRef"
              type="button"
              class="relative h-9 w-12 shrink-0 overflow-hidden rounded-xl border border-black/10 shadow-sm transition-transform active:scale-95 dark:border-white/15 cursor-pointer flex items-center justify-center group"
              :title="TEXT.accentCustom"
              @click="toggleColorPicker"
            >
              <span
                class="absolute inset-0 transition-colors"
                :style="{ backgroundColor: theme.accentColor }"
              ></span>
            </button>

            <!-- 带大圆角与平滑打开/关闭动画的自定义调色盘面板 -->
            <ColorPickerPopover
              :model-value="theme.accentColor"
              :is-open="isPickerOpen"
              :trigger-ref="pickerTriggerRef"
              @update:model-value="setAccentColor"
              @close="isPickerOpen = false"
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

      <label class="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 transition-all hover:border-[#EC4141]/35 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:bg-white/10">
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.customTrayMenu }}</span>
          <span class="mt-1 block text-xs text-gray-500 dark:text-white/50">
            {{ useCustomTrayMenu ? TEXT.customTrayMenuOn : TEXT.customTrayMenuOff }}
          </span>
        </span>
        <input
          type="checkbox"
          class="sr-only"
          :checked="useCustomTrayMenu"
          @change="setUseCustomTrayMenu(($event.target as HTMLInputElement).checked)"
        />
        <span
          class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
          :class="useCustomTrayMenu ? 'bg-[#EC4141]' : 'bg-gray-300/70 dark:bg-white/20'"
        >
          <span
            class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
            :class="useCustomTrayMenu ? 'translate-x-5' : ''"
          ></span>
        </span>
      </label>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ TEXT.leaderboardTitle }}
        </span>
        <SettingHint :text="TEXT.leaderboardHint" />
      </h2>

      <label class="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 transition-all hover:border-[#EC4141]/35 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:hover:bg-white/10">
        <span class="min-w-0 text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.leaderboardEnable }}</span>
        <input
          type="checkbox"
          class="sr-only"
          :checked="showLeaderboard"
          @change="setShowLeaderboard(($event.target as HTMLInputElement).checked)"
        />
        <span
          class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
          :class="showLeaderboard ? 'bg-[#EC4141]' : 'bg-gray-300/70 dark:bg-white/20'"
        >
          <span
            class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
            :class="showLeaderboard ? 'translate-x-5' : ''"
          ></span>
        </span>
      </label>
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
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.flow-panel-enter-from,
.flow-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px);
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
