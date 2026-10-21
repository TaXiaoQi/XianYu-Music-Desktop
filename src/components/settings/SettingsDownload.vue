<script setup lang="ts">
import { Check, ChevronDown, FolderOpen, Minus, Plus } from 'lucide-vue-next';
import { useI18n } from '../../features/i18n';
import { useToast } from '../../composables/toast';
import { useSettings } from '../../features/settings/useSettings';
import { downloadApi } from '../../services/tauri/downloadApi';
import type { DownloadBehavior, DownloadFileNameStyle, DownloadLyricsStyle, DownloadQuality, DownloadQualityFallbackBehavior, MvQualityKey } from '../../types';
import { ALL_QUALITY_KEYS, MV_QUALITY_KEYS, MV_QUALITY_META, QUALITY_META } from '../../types';
import RangeSlider from '../common/RangeSlider.vue';
import { useInlineSelectDropdown } from '../../composables/useInlineSelectDropdown';
import { computed, nextTick, ref, watch } from 'vue';

const { settings, patchSettings } = useSettings();
const { isEnglish } = useI18n();
const { showToast } = useToast();

// --- 行内下拉（触发按钮下方展开，互斥单开） ---
const {
  openId: openDropdownId,
  panelRef: dropdownPanelRef,
  panelStyle: dropdownPanelStyle,
  registerTrigger,
  toggle: toggleDropdown,
  close: closeDropdown,
  reposition: repositionDropdown,
} = useInlineSelectDropdown();

// 超过 5 项时面板限高滚动，并在展开时把当前选中项滚入可视区
watch(openDropdownId, async (id) => {
  if (!id) return;
  await nextTick();
  const panel = dropdownPanelRef.value;
  if (!panel) return;
  const items = panel.querySelectorAll<HTMLElement>('.settings-inline-dropdown-item');
  if (items.length > 5) {
    panel.style.maxHeight = `${items[0].offsetHeight * 5}px`;
  } else {
    panel.style.maxHeight = '';
  }
  // 限高后高度变了，重新定位一次：首次定位按未限高的全量高度算的 top 会让面板悬空
  repositionDropdown();
  panel.querySelector('.settings-inline-dropdown-item.is-active')
    ?.scrollIntoView({ block: 'nearest' });
});

const FILE_NAME_STYLE_OPTIONS = computed<{ value: DownloadFileNameStyle; label: string }[]>(() => isEnglish.value ? [
  { value: 'artist-title', label: 'Artist - Title' },
  { value: 'title-artist', label: 'Title - Artist' },
  { value: 'title-artist-album', label: 'Title - Artist - Album' },
] : [
  { value: 'artist-title', label: '歌手 - 歌名' },
  { value: 'title-artist', label: '歌名 - 歌手' },
  { value: 'title-artist-album', label: '歌名 - 歌手 - 专辑' },
]);

const DOWNLOAD_BEHAVIOR_OPTIONS = computed<{ value: DownloadBehavior; label: string }[]>(() => isEnglish.value ? [
  { value: 'default', label: 'Use Defaults' },
  { value: 'ask', label: 'Ask Every Time' },
] : [
  { value: 'default', label: '默认安装' },
  { value: 'ask', label: '每次询问我' },
]);

const QUALITY_FALLBACK_OPTIONS = computed<{ value: DownloadQualityFallbackBehavior; label: string }[]>(() => isEnglish.value ? [
  { value: 'lower', label: 'Download Lower Quality' },
  { value: 'higher', label: 'Download Higher Quality' },
] : [
  { value: 'lower', label: '下载更低音质' },
  { value: 'higher', label: '下载更高音质' },
]);

const LYRICS_FORMAT_OPTIONS = computed(() => isEnglish.value ? [
  { value: 'lrc' as const, label: 'LRC' },
  { value: 'txt' as const, label: 'TXT' },
] : [
  { value: 'lrc', label: 'LRC' },
  { value: 'txt', label: 'TXT' },
] as const);

const LYRICS_STYLE_OPTIONS = computed<{ value: DownloadLyricsStyle; label: string }[]>(() => isEnglish.value ? [
  { value: 'word-by-word', label: 'Word by Word' },
  { value: 'line-by-line', label: 'Line by Line' },
] : [
  { value: 'word-by-word', label: '内置逐字' },
  { value: 'line-by-line', label: '逐行' },
]);

const ENGLISH_QUALITY_LABELS: Partial<Record<DownloadQuality, string>> = {
  mgg: 'Low', '128k': 'Standard', '192k': 'Medium', '320k': 'HQ', flac: 'SQ',
  flac24bit: 'Hi-Res', hires: 'Hi-Res', vinyl: 'Vinyl', dolby: 'Dolby Atmos',
  atmos: 'Premium', atmos_plus: 'Premium Atmos', master: 'Master',
};
const qualityLabel = (key: DownloadQuality) => (
  isEnglish.value ? ENGLISH_QUALITY_LABELS[key] ?? QUALITY_META[key].label : QUALITY_META[key].label
);

const patchDownloadQuality = (value: DownloadQuality) => {
  patchSettings({ download: { ...settings.value.download, quality: value } });
};

const handleDownloadQualitySelect = (value: DownloadQuality) => {
  closeDropdown();
  patchDownloadQuality(value);
};

const handleMvQualitySelect = (value: MvQualityKey) => {
  closeDropdown();
  patchSettings({ download: { ...settings.value.download, mvDefaultQuality: value } });
};

const handleDownloadBehaviorSelect = (value: DownloadBehavior) => {
  closeDropdown();
  patchSettings({ download: { ...settings.value.download, behavior: value } });
};

const handleBatchDownloadLimitChange = (value: number) => {
  patchSettings({
    download: {
      ...settings.value.download,
      batchDownloadLimit: Math.min(5, Math.max(1, Math.round(value))),
    },
  });
};

const showBatchLimitPanel = ref(false);
const BATCH_LIMIT_DEFAULT = 2;

const handleBatchLimitInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const parsed = parseFloat(target.value);
  const next = Number.isNaN(parsed) ? BATCH_LIMIT_DEFAULT : Math.round(parsed);
  handleBatchDownloadLimitChange(next);
  target.value = String(settings.value.download.batchDownloadLimit ?? BATCH_LIMIT_DEFAULT);
};

const handleQualityFallbackSelect = (value: DownloadQualityFallbackBehavior) => {
  closeDropdown();
  patchSettings({ download: { ...settings.value.download, qualityFallbackBehavior: value } });
};

const handleFileNameStyleSelect = (value: DownloadFileNameStyle) => {
  closeDropdown();
  patchSettings({ download: { ...settings.value.download, fileNameStyle: value } });
};

const handleLyricsFormatSelect = (value: 'lrc' | 'txt') => {
  closeDropdown();
  patchSettings({ download: { ...settings.value.download, lyricsFormat: value } });
};

const handleLyricsStyleSelect = (value: DownloadLyricsStyle) => {
  closeDropdown();
  patchSettings({ download: { ...settings.value.download, lyricsStyle: value } });
};

const chooseDir = async () => {
  try {
    const selected = await downloadApi.registerDownloadDirectory();
    if (!selected) return;
    patchSettings({ download: { ...settings.value.download, downloadPath: selected } });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error);
    showToast(msg, 'error');
  }
};

const dirLabel = (path: string) => path || (isEnglish.value ? 'Not set. Click Choose to select a download folder.' : '未设置，点击右侧按钮选择下载目录');
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        下载行为
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="desktop-setting-row rounded-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">下载目录</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div
              class="min-w-0 max-w-[220px] truncate text-xs text-gray-600 dark:text-gray-300"
              :title="settings.download.downloadPath"
            >{{ dirLabel(settings.download.downloadPath) }}</div>
            <button
              type="button"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap"
              :class="'bg-[#EC4141] text-white hover:bg-[#d13b3b]'"
              @click="chooseDir"
            >
              <FolderOpen class="h-3.5 w-3.5" />
              选择
            </button>
          </div>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">下载行为</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">控制底部下载栏点击后显示音质选择还是详细弹窗</div>
          </div>
          <button
            type="button"
            :ref="(el) => registerTrigger('downloadBehavior', el)"
            class="flex shrink-0 items-center min-w-[176px] justify-between gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="toggleDropdown('downloadBehavior')"
          >
            <span>{{ DOWNLOAD_BEHAVIOR_OPTIONS.find(o => o.value === settings.download.behavior)?.label }}</span>
            <ChevronDown
              class="h-4 w-4 text-gray-400 transition-transform duration-200"
              :class="openDropdownId === 'downloadBehavior' ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
        </div>
        <div>
          <button
            type="button"
            class="desktop-setting-row w-full"
            @click="showBatchLimitPanel = !showBatchLimitPanel"
          >
            <div class="min-w-0 flex-1 space-y-1 pr-3 text-left">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">批量下载数量上限</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">同时下载数量，最高 5，默认 2</div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span class="text-sm font-semibold text-[#EC4141] tabular-nums">
                {{ settings.download.batchDownloadLimit ?? 2 }}
              </span>
              <ChevronDown
                class="h-4 w-4 text-gray-400 transition-transform duration-200"
                :class="showBatchLimitPanel ? 'rotate-180' : ''"
                aria-hidden="true"
              />
            </div>
          </button>
          <transition name="settings-pop-panel">
            <div v-if="showBatchLimitPanel" class="px-4 pb-4">
              <div class="settings-expand-panel">
                <div class="flex flex-col gap-4 md:flex-row md:items-center">
                  <div class="flex min-w-[240px] flex-1 items-center gap-2">
                    <button
                      type="button"
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gray-200/40 bg-white/20 text-gray-600 transition hover:border-[#EC4141] hover:bg-white/30 hover:text-[#EC4141] disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-300"
                      :disabled="(settings.download.batchDownloadLimit ?? 2) <= 1"
                      aria-label="减少 1"
                      @click="handleBatchDownloadLimitChange((settings.download.batchDownloadLimit ?? 2) - 1)"
                    >
                      <Minus class="h-4 w-4" />
                    </button>
                    <RangeSlider
                      :model-value="settings.download.batchDownloadLimit ?? 2"
                      :min="1"
                      :max="5"
                      :step="1"
                      variant="native"
                      class="min-w-0 flex-1 h-1.5 cursor-pointer"
                      @update:model-value="handleBatchDownloadLimitChange"
                    />
                    <button
                      type="button"
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gray-200/40 bg-white/20 text-gray-600 transition hover:border-[#EC4141] hover:bg-white/30 hover:text-[#EC4141] disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-300"
                      :disabled="(settings.download.batchDownloadLimit ?? 2) >= 5"
                      aria-label="增加 1"
                      @click="handleBatchDownloadLimitChange((settings.download.batchDownloadLimit ?? 2) + 1)"
                    >
                      <Plus class="h-4 w-4" />
                    </button>
                  </div>
                  <div class="flex items-center gap-3">
                    <input
                      :value="settings.download.batchDownloadLimit ?? 2"
                      type="number"
                      :min="1"
                      :max="5"
                      :step="1"
                      class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                      @change="handleBatchLimitInput"
                    />
                    <button
                      type="button"
                      class="settings-action-button settings-action-button--soft"
                      @click="handleBatchDownloadLimitChange(BATCH_LIMIT_DEFAULT)"
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="settings-dropdown">
        <div
          v-if="openDropdownId"
          ref="dropdownPanelRef"
          class="settings-inline-dropdown custom-scrollbar"
          :style="dropdownPanelStyle"
        >
          <template v-if="openDropdownId === 'downloadBehavior'">
            <button
              v-for="option in DOWNLOAD_BEHAVIOR_OPTIONS"
              :key="option.value"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': settings.download.behavior === option.value }"
              @click="handleDownloadBehaviorSelect(option.value)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ option.label }}</span>
              </span>
              <Check
                v-if="settings.download.behavior === option.value"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>

          <template v-else-if="openDropdownId === 'qualityFallback'">
            <button
              v-for="option in QUALITY_FALLBACK_OPTIONS"
              :key="option.value"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': settings.download.qualityFallbackBehavior === option.value }"
              @click="handleQualityFallbackSelect(option.value)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ option.label }}</span>
              </span>
              <Check
                v-if="settings.download.qualityFallbackBehavior === option.value"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>

          <template v-else-if="openDropdownId === 'fileNameStyle'">
            <button
              v-for="option in FILE_NAME_STYLE_OPTIONS"
              :key="option.value"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': settings.download.fileNameStyle === option.value }"
              @click="handleFileNameStyleSelect(option.value)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ option.label }}</span>
              </span>
              <Check
                v-if="settings.download.fileNameStyle === option.value"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>

          <template v-else-if="openDropdownId === 'lyricsFormat'">
            <button
              v-for="option in LYRICS_FORMAT_OPTIONS"
              :key="option.value"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': settings.download.lyricsFormat === option.value }"
              @click="handleLyricsFormatSelect(option.value)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ option.label }}</span>
              </span>
              <Check
                v-if="settings.download.lyricsFormat === option.value"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>

          <template v-else-if="openDropdownId === 'lyricsStyle'">
            <button
              v-for="option in LYRICS_STYLE_OPTIONS"
              :key="option.value"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': settings.download.lyricsStyle === option.value }"
              @click="handleLyricsStyleSelect(option.value)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ option.label }}</span>
              </span>
              <Check
                v-if="settings.download.lyricsStyle === option.value"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>

          <template v-else-if="openDropdownId === 'downloadQuality'">
            <button
              v-for="key in ALL_QUALITY_KEYS"
              :key="key"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': settings.download.quality === key }"
              :title="QUALITY_META[key].description"
              @click="handleDownloadQualitySelect(key)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ qualityLabel(key) }}</span>
              </span>
              <Check
                v-if="settings.download.quality === key"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>

          <template v-else-if="openDropdownId === 'mvQuality'">
            <button
              v-for="key in MV_QUALITY_KEYS"
              :key="key"
              type="button"
              class="settings-inline-dropdown-item"
              :class="{ 'is-active': (settings.download.mvDefaultQuality ?? '720P') === key }"
              :title="MV_QUALITY_META[key].description"
              @click="handleMvQualitySelect(key)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ MV_QUALITY_META[key].label }}</span>
              </span>
              <Check
                v-if="(settings.download.mvDefaultQuality ?? '720P') === key"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        下载音质
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">默认下载音质</div>
          </div>
          <button
            type="button"
            :ref="(el) => registerTrigger('downloadQuality', el)"
            class="flex shrink-0 items-center min-w-[176px] justify-between gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="toggleDropdown('downloadQuality')"
          >
            <span>{{ qualityLabel(settings.download.quality) }}</span>
            <ChevronDown
              class="h-4 w-4 text-gray-400 transition-transform duration-200"
              :class="openDropdownId === 'downloadQuality' ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">音质缺失行为</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">所选音质不可用时采取的回退策略</div>
          </div>
          <button
            type="button"
            :ref="(el) => registerTrigger('qualityFallback', el)"
            class="flex shrink-0 items-center min-w-[176px] justify-between gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="toggleDropdown('qualityFallback')"
          >
            <span>{{ QUALITY_FALLBACK_OPTIONS.find(o => o.value === settings.download.qualityFallbackBehavior)?.label }}</span>
            <ChevronDown
              class="h-4 w-4 text-gray-400 transition-transform duration-200"
              :class="openDropdownId === 'qualityFallback' ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">MV 默认画质</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">下载 MV 视频弹窗中预选的画质档位</div>
          </div>
          <button
            type="button"
            :ref="(el) => registerTrigger('mvQuality', el)"
            class="flex shrink-0 items-center min-w-[176px] justify-between gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="toggleDropdown('mvQuality')"
          >
            <span>{{ settings.download.mvDefaultQuality ?? '720P' }}</span>
            <ChevronDown
              class="h-4 w-4 text-gray-400 transition-transform duration-200"
              :class="openDropdownId === 'mvQuality' ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        下载文件
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">文件名样式</div>
          </div>
          <button
            type="button"
            :ref="(el) => registerTrigger('fileNameStyle', el)"
            class="flex shrink-0 items-center min-w-[176px] justify-between gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="toggleDropdown('fileNameStyle')"
          >
            <span>{{ FILE_NAME_STYLE_OPTIONS.find(o => o.value === settings.download.fileNameStyle)?.label }}</span>
            <ChevronDown
              class="h-4 w-4 text-gray-400 transition-transform duration-200"
              :class="openDropdownId === 'fileNameStyle' ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
        </div>

        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">保留源文件名</div>
          </div>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': settings.download.keepSourceFilename }"
            @click="patchSettings({ download: { ...settings.download, keepSourceFilename: !settings.download.keepSourceFilename } })"
          ></button>
        </div>

        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">下载独立歌词</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">在音频文件旁保存独立的 .lrc/.txt 歌词文件</div>
          </div>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': settings.download.downloadLyrics }"
            @click="patchSettings({ download: { ...settings.download, downloadLyrics: !settings.download.downloadLyrics } })"
          ></button>
        </div>

        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词格式</div>
          </div>
          <button
            type="button"
            :ref="(el) => registerTrigger('lyricsFormat', el)"
            class="flex shrink-0 items-center min-w-[176px] justify-between gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="toggleDropdown('lyricsFormat')"
          >
            <span>{{ LYRICS_FORMAT_OPTIONS.find(o => o.value === settings.download.lyricsFormat)?.label }}</span>
            <ChevronDown
              class="h-4 w-4 text-gray-400 transition-transform duration-200"
              :class="openDropdownId === 'lyricsFormat' ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
        </div>

        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词样式</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">选择下载的歌词类型</div>
          </div>
          <button
            type="button"
            :ref="(el) => registerTrigger('lyricsStyle', el)"
            class="flex shrink-0 items-center min-w-[176px] justify-between gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="toggleDropdown('lyricsStyle')"
          >
            <span>{{ LYRICS_STYLE_OPTIONS.find(o => o.value === settings.download.lyricsStyle)?.label }}</span>
            <ChevronDown
              class="h-4 w-4 text-gray-400 transition-transform duration-200"
              :class="openDropdownId === 'lyricsStyle' ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
        </div>

        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">写入歌曲元数据</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">将标题、歌手、专辑等信息写入音频文件标签</div>
          </div>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': settings.download.embedMetadata }"
            @click="patchSettings({ download: { ...settings.download, embedMetadata: !settings.download.embedMetadata } })"
          ></button>
        </div>

        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">嵌入歌词</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">将歌词写入音频文件标签，可在支持标签的播放器中显示</div>
          </div>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': settings.download.embedLyrics }"
            @click="patchSettings({ download: { ...settings.download, embedLyrics: !settings.download.embedLyrics } })"
          ></button>
        </div>

        <div class="desktop-setting-row">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">嵌入封面</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">将封面图片写入音频文件标签</div>
          </div>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': settings.download.embedCover }"
            @click="patchSettings({ download: { ...settings.download, embedCover: !settings.download.embedCover } })"
          ></button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        文件覆盖
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="desktop-setting-row rounded-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">覆盖已存在的文件</div>
          </div>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': settings.download.overwriteExisting }"
            @click="patchSettings({ download: { ...settings.download, overwriteExisting: !settings.download.overwriteExisting } })"
          ></button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.desktop-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  text-align: left;
  transition: background-color 160ms ease;
}

.desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.1);
}

.settings-expand-panel {
  margin-top: 2px;
  padding: 18px 16px 0;
}

.settings-action-button {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.settings-action-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(236, 65, 65, 0.08);
}

.settings-action-button--soft {
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
}

.settings-action-button--soft:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.1);
}

.settings-pop-panel-enter-active,
.settings-pop-panel-leave-active {
  transition:
    opacity 220ms ease,
    transform 240ms ease,
    max-height 240ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.settings-pop-panel-enter-from,
.settings-pop-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
  max-height: 0;
}

.settings-pop-panel-enter-to,
.settings-pop-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 360px;
}
</style>
