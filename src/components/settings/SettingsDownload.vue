<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import type { DownloadFileNameStyle, DownloadQuality } from '../../types';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';

const { settings, patchSettings } = useSettings();

/** 按 3 列 4 行分组（从低到高横向排布），用于按钮选择网格 */
const QUALITY_GRID: DownloadQuality[][] = (() => {
  const grid: DownloadQuality[][] = [];
  for (let i = 0; i < ALL_QUALITY_KEYS.length; i += 3) {
    grid.push(ALL_QUALITY_KEYS.slice(i, i + 3));
  }
  return grid;
})();

const FILE_NAME_STYLE_OPTIONS: { value: DownloadFileNameStyle; label: string }[] = [
  { value: 'artist-title', label: '歌手 - 歌名' },
  { value: 'title-artist', label: '歌名 - 歌手' },
  { value: 'title-artist-album', label: '歌名 - 歌手 - 专辑' },
];

const patchDownloadQuality = (value: DownloadQuality) => {
  patchSettings({ download: { ...settings.value.download, quality: value } });
};

const patchFileNameStyle = (value: DownloadFileNameStyle) => {
  patchSettings({ download: { ...settings.value.download, fileNameStyle: value } });
};

const patchLyricsFormat = (value: 'lrc' | 'txt') => {
  patchSettings({ download: { ...settings.value.download, lyricsFormat: value } });
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
        <div class="desktop-setting-row rounded-t-xl border-b border-gray-200/20 dark:border-gray-800/20">
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
        <div class="desktop-setting-row rounded-b-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">记忆下载位置</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.download.rememberDownloadPath ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="patchSettings({ download: { ...settings.value.download, rememberDownloadPath: !settings.value.download.rememberDownloadPath } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.rememberDownloadPath ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </section>

    <!-- 默认下载音质 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        默认下载音质
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="desktop-setting-row rounded-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">下载音质</div>
          </div>
          <div class="grid grid-cols-3 gap-1.5 shrink-0" style="min-width: 280px;">
            <button
              v-for="qKey in QUALITY_GRID.flat()"
              :key="qKey"
              type="button"
              class="px-2 py-1.5 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap"
              :class="settings.download.quality === qKey
                ? 'bg-[#EC4141] text-white shadow-sm'
                : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
              :title="QUALITY_META[qKey].description"
              @click="patchDownloadQuality(qKey)"
            >{{ QUALITY_META[qKey].label }}</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 文件名与歌词 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        文件名与歌词
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 文件名样式 -->
        <div class="desktop-setting-row rounded-t-xl border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">文件名样式</div>
          </div>
          <div class="flex shrink-0 items-center rounded-lg bg-gray-100 dark:bg-white/5 p-0.5 gap-0.5">
            <button
              v-for="opt in FILE_NAME_STYLE_OPTIONS" :key="opt.value"
              class="px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap"
              :class="settings.download.fileNameStyle === opt.value
                ? 'bg-white dark:bg-white/15 text-[#EC4141] shadow-sm'
                : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70'"
              @click="patchFileNameStyle(opt.value)"
            >{{ opt.label }}</button>
          </div>
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
            @click="patchSettings({ download: { ...settings.value.download, keepSourceFilename: !settings.value.download.keepSourceFilename } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.keepSourceFilename ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- 同时下载歌词 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">同时下载歌词</div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.download.downloadLyrics ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="patchSettings({ download: { ...settings.value.download, downloadLyrics: !settings.value.download.downloadLyrics } })"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.download.downloadLyrics ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- 歌词格式 -->
        <div class="desktop-setting-row rounded-b-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词格式</div>
          </div>
          <div class="flex shrink-0 items-center rounded-lg bg-gray-100 dark:bg-white/5 p-0.5 gap-0.5">
            <button
              v-for="opt in [{label: 'LRC', value: 'lrc'}, {label: 'TXT', value: 'txt'}] as const" :key="opt.value"
              class="px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap"
              :class="settings.download.lyricsFormat === opt.value
                ? 'bg-white dark:bg-white/15 text-[#EC4141] shadow-sm'
                : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70'"
              @click="patchLyricsFormat(opt.value)"
            >{{ opt.label }}</button>
          </div>
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
            @click="patchSettings({ download: { ...settings.value.download, overwriteExisting: !settings.value.download.overwriteExisting } })"
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
