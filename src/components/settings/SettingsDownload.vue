<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog';
import { Check, ChevronDown, FolderOpen } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import type { DownloadFileNameStyle, DownloadLyricsStyle, DownloadQuality, DownloadQualityFallbackBehavior } from '../../types';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import { ref } from 'vue';

const { settings, patchSettings } = useSettings();

const showDownloadQualityModal = ref(false);
const showQualityFallbackModal = ref(false);
const showFileNameStyleModal = ref(false);
const showLyricsFormatModal = ref(false);
const showLyricsStyleModal = ref(false);

const FILE_NAME_STYLE_OPTIONS: { value: DownloadFileNameStyle; label: string; description: string }[] = [
  { value: 'artist-title', label: '歌手 - 歌名', description: '艺术家在前，歌名在后' },
  { value: 'title-artist', label: '歌名 - 歌手', description: '歌名在前，艺术家在后' },
  { value: 'title-artist-album', label: '歌名 - 歌手 - 专辑', description: '附加专辑信息' },
];

const QUALITY_FALLBACK_OPTIONS: { value: DownloadQualityFallbackBehavior; label: string; description: string }[] = [
  { value: 'lower', label: '下载更低音质', description: '自动降级到可用的更低音质' },
  { value: 'higher', label: '下载更高音质', description: '自动升级到可用的更高音质' },
];

const LYRICS_FORMAT_OPTIONS = [
  { value: 'lrc', label: 'LRC', description: '带时间标签的歌词文件，支持同步显示' },
  { value: 'txt', label: 'TXT', description: '纯文本歌词，不带时间标签' },
] as const;

const LYRICS_STYLE_OPTIONS: { value: DownloadLyricsStyle; label: string; description: string }[] = [
  { value: 'word-by-word', label: '内置逐字', description: '优先下载逐字歌词（无逐字时回退到逐行）' },
  { value: 'line-by-line', label: '逐行', description: '仅下载标准逐行歌词' },
];

const patchDownloadQuality = (value: DownloadQuality) => {
  patchSettings({ download: { ...settings.value.download, quality: value } });
};

/** 弹窗中选择下载音质 */
const handleDownloadQualitySelect = (value: DownloadQuality) => {
  showDownloadQualityModal.value = false;
  patchDownloadQuality(value);
};

/** 弹窗中选择音质缺失行为 */
const handleQualityFallbackSelect = (value: DownloadQualityFallbackBehavior) => {
  showQualityFallbackModal.value = false;
  patchSettings({ download: { ...settings.value.download, qualityFallbackBehavior: value } });
};

/** 弹窗中选择文件名样式 */
const handleFileNameStyleSelect = (value: DownloadFileNameStyle) => {
  showFileNameStyleModal.value = false;
  patchSettings({ download: { ...settings.value.download, fileNameStyle: value } });
};

/** 弹窗中选择歌词格式 */
const handleLyricsFormatSelect = (value: 'lrc' | 'txt') => {
  showLyricsFormatModal.value = false;
  patchSettings({ download: { ...settings.value.download, lyricsFormat: value } });
};

/** 弹窗中选择歌词样式 */
const handleLyricsStyleSelect = (value: DownloadLyricsStyle) => {
  showLyricsStyleModal.value = false;
  patchSettings({ download: { ...settings.value.download, lyricsStyle: value } });
};

const chooseDir = async () => {
  const selected = await open({ directory: true, multiple: false, title: '选择下载目录' });
  if (selected && typeof selected === 'string') {
    patchSettings({ download: { ...settings.value.download, downloadPath: selected } });
  }
};

const dirLabel = (path: string) => path || '未设置，点击右侧按钮选择下载目录';
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <!-- 下载位置 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        下载位置
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
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
              :class="'bg-[#EC4141]/10 text-[#EC4141] hover:bg-[#EC4141]/20'"
              @click="chooseDir"
            >
              <FolderOpen class="h-3.5 w-3.5" />
              选择
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 下载音质 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        下载音质
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="desktop-setting-row rounded-t-xl border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">默认下载音质</div>
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="showDownloadQualityModal = true"
          >
            <span>{{ QUALITY_META[settings.download.quality].label }}</span>
            <span class="text-xs text-gray-400">{{ QUALITY_META[settings.download.quality].description }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        </div>
        <div class="desktop-setting-row rounded-b-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">音质缺失行为</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">所选音质不可用时采取的回退策略</div>
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="showQualityFallbackModal = true"
          >
            <span>{{ QUALITY_FALLBACK_OPTIONS.find(o => o.value === settings.download.qualityFallbackBehavior)?.label }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>

    <!-- 下载音质选择弹窗：复用添加歌单弹窗容器模式，3 列平铺网格 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showDownloadQualityModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showDownloadQualityModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择默认下载音质</h3>
              <button
                @click="showDownloadQualityModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-3">
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="key in ALL_QUALITY_KEYS"
                  :key="key"
                  type="button"
                  class="px-2 py-2 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap flex flex-col items-center gap-0.5"
                  :class="settings.download.quality === key
                    ? 'bg-[#EC4141] text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
                  :title="QUALITY_META[key].description"
                  @click="handleDownloadQualitySelect(key)"
                >
                  <span>{{ QUALITY_META[key].label }}</span>
                  <span
                    class="text-[10px] font-normal opacity-75"
                    :class="settings.download.quality === key ? '' : 'text-gray-400 dark:text-gray-500'"
                  >{{ QUALITY_META[key].description }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 音质缺失行为选择弹窗：复用添加歌单弹窗容器模式 + 切换动效 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showQualityFallbackModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showQualityFallbackModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择音质缺失行为</h3>
              <button
                @click="showQualityFallbackModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
              <button
                v-for="option in QUALITY_FALLBACK_OPTIONS"
                :key="option.value"
                type="button"
                class="w-full flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                :class="settings.download.qualityFallbackBehavior === option.value ? 'bg-gray-50 dark:bg-white/5' : ''"
                @click="handleQualityFallbackSelect(option.value)"
              >
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ option.label }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ option.description }}</div>
                </div>
                <Check
                  v-if="settings.download.qualityFallbackBehavior === option.value"
                  class="h-4 w-4 text-[#EC4141] shrink-0 ml-2"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 文件名样式选择弹窗：复用添加歌单弹窗容器模式 + 切换动效 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showFileNameStyleModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showFileNameStyleModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择文件名样式</h3>
              <button
                @click="showFileNameStyleModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
              <button
                v-for="option in FILE_NAME_STYLE_OPTIONS"
                :key="option.value"
                type="button"
                class="w-full flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                :class="settings.download.fileNameStyle === option.value ? 'bg-gray-50 dark:bg-white/5' : ''"
                @click="handleFileNameStyleSelect(option.value)"
              >
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ option.label }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ option.description }}</div>
                </div>
                <Check
                  v-if="settings.download.fileNameStyle === option.value"
                  class="h-4 w-4 text-[#EC4141] shrink-0 ml-2"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 歌词格式选择弹窗：复用添加歌单弹窗容器模式 + 切换动效 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showLyricsFormatModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showLyricsFormatModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择歌词格式</h3>
              <button
                @click="showLyricsFormatModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
              <button
                v-for="option in LYRICS_FORMAT_OPTIONS"
                :key="option.value"
                type="button"
                class="w-full flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                :class="settings.download.lyricsFormat === option.value ? 'bg-gray-50 dark:bg-white/5' : ''"
                @click="handleLyricsFormatSelect(option.value)"
              >
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ option.label }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ option.description }}</div>
                </div>
                <Check
                  v-if="settings.download.lyricsFormat === option.value"
                  class="h-4 w-4 text-[#EC4141] shrink-0 ml-2"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 歌词样式选择弹窗：复用添加歌单弹窗容器模式 + 切换动效 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showLyricsStyleModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showLyricsStyleModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择歌词样式</h3>
              <button
                @click="showLyricsStyleModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
              <button
                v-for="option in LYRICS_STYLE_OPTIONS"
                :key="option.value"
                type="button"
                class="w-full flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                :class="settings.download.lyricsStyle === option.value ? 'bg-gray-50 dark:bg-white/5' : ''"
                @click="handleLyricsStyleSelect(option.value)"
              >
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ option.label }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ option.description }}</div>
                </div>
                <Check
                  v-if="settings.download.lyricsStyle === option.value"
                  class="h-4 w-4 text-[#EC4141] shrink-0 ml-2"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 下载文件 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        下载文件
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 文件名样式 -->
        <div class="desktop-setting-row rounded-t-xl border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">文件名样式</div>
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="showFileNameStyleModal = true"
          >
            <span>{{ FILE_NAME_STYLE_OPTIONS.find(o => o.value === settings.download.fileNameStyle)?.label }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        </div>

        <!-- 保留源文件名 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">保留源文件名</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.download.keepSourceFilename ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="patchSettings({ download: { ...settings.download, keepSourceFilename: !settings.download.keepSourceFilename } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.keepSourceFilename ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- 下载独立歌词 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">下载独立歌词</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">在音频文件旁保存独立的 .lrc/.txt 歌词文件</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.download.downloadLyrics ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="patchSettings({ download: { ...settings.download, downloadLyrics: !settings.download.downloadLyrics } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.downloadLyrics ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- 歌词格式 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词格式</div>
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="showLyricsFormatModal = true"
          >
            <span>{{ LYRICS_FORMAT_OPTIONS.find(o => o.value === settings.download.lyricsFormat)?.label }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        </div>

        <!-- 歌词样式 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词样式</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">选择下载的歌词类型</div>
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="showLyricsStyleModal = true"
          >
            <span>{{ LYRICS_STYLE_OPTIONS.find(o => o.value === settings.download.lyricsStyle)?.label }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        </div>

        <!-- 写入歌曲元数据 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">写入歌曲元数据</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">将标题、歌手、专辑等信息写入音频文件标签</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.download.embedMetadata ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="patchSettings({ download: { ...settings.download, embedMetadata: !settings.download.embedMetadata } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.embedMetadata ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- 嵌入歌词 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">嵌入歌词</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">将歌词写入音频文件标签，可在支持标签的播放器中显示</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.download.embedLyrics ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="patchSettings({ download: { ...settings.download, embedLyrics: !settings.download.embedLyrics } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.embedLyrics ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- 嵌入封面 -->
        <div class="desktop-setting-row rounded-b-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">嵌入封面</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">将封面图片写入音频文件标签</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.download.embedCover ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="patchSettings({ download: { ...settings.download, embedCover: !settings.download.embedCover } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.embedCover ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </section>

    <!-- 文件覆盖 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        文件覆盖
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="desktop-setting-row rounded-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">覆盖已存在的文件</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.download.overwriteExisting ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="patchSettings({ download: { ...settings.download, overwriteExisting: !settings.download.overwriteExisting } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.overwriteExisting ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
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
}

.desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-setting-row {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

:global(.dark) .desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.08);
}
</style>
