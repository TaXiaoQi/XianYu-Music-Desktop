<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Check, ChevronDown, FolderOpen, Download, X } from 'lucide-vue-next';
import type { DownloadQuality, Song } from '../../types';
import { useSettings } from '../../features/settings/useSettings';
import { useToast } from '../../composables/toast';
import { downloadSong } from '../../services/downloadService';

const props = defineProps<{
  visible: boolean;
  song: Song | null;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

const { settings } = useSettings();
const { showToast } = useToast();

const qualityOptions: { value: DownloadQuality; label: string; desc: string }[] = [
  { value: 'lossless', label: '无损', desc: '最高音质，文件较大' },
  { value: 'high', label: '高品', desc: '320kbps，平衡音质与体积' },
  { value: 'standard', label: '标准', desc: '128kbps，文件较小' },
];

// 对话框内的当次选择（初始化自全局设置，但不强制回写）
const selectedQuality = ref<DownloadQuality>('high');
const selectedDir = ref('');
const rememberPath = ref(false);
const withLyrics = ref(true);
const isQualityMenuOpen = ref(false);

const isDownloading = ref(false);
const progress = ref(0);
let unlistenProgress: UnlistenFn | null = null;

const songLabel = computed(() => {
  if (!props.song) return '';
  const title = props.song.title || props.song.name || '未知歌曲';
  const artist = props.song.artist || '';
  return artist ? `${artist} - ${title}` : title;
});

const dirLabel = computed(() => selectedDir.value || '未设置，请选择下载目录');

const selectedQualityLabel = computed(
  () => qualityOptions.find((o) => o.value === selectedQuality.value)?.label ?? '高品',
);

// 打开对话框时用全局设置初始化当次选择
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      selectedQuality.value = settings.value.download.quality;
      selectedDir.value = settings.value.download.downloadPath;
      rememberPath.value = settings.value.download.rememberDownloadPath;
      withLyrics.value = settings.value.download.downloadLyrics;
      isQualityMenuOpen.value = false;
      isDownloading.value = false;
      progress.value = 0;
    }
  },
);

function close() {
  if (isDownloading.value) return;
  emit('update:visible', false);
}

function toggleQualityMenu() {
  isQualityMenuOpen.value = !isQualityMenuOpen.value;
}

function selectQuality(value: DownloadQuality) {
  selectedQuality.value = value;
  isQualityMenuOpen.value = false;
}

async function chooseDir() {
  const selected = await open({ directory: true, multiple: false, title: '选择下载目录' });
  if (selected && typeof selected === 'string') {
    selectedDir.value = selected;
  }
}

async function startDownload() {
  if (!props.song) return;
  if (!selectedDir.value) {
    showToast('请先选择下载目录', 'error');
    return;
  }

  isDownloading.value = true;
  progress.value = 0;

  // 监听下载进度
  try {
    unlistenProgress = await listen<{ progress: number }>('song-download-progress', (event) => {
      progress.value = Math.min(100, Math.round(event.payload.progress));
    });
  } catch {
    // 忽略监听失败，不影响下载
  }

  // 记忆下载位置：写回全局设置
  if (rememberPath.value) {
    settings.value.download.rememberDownloadPath = true;
    settings.value.download.downloadPath = selectedDir.value;
  } else {
    settings.value.download.rememberDownloadPath = false;
  }

  try {
    const result = await downloadSong(props.song, {
      quality: selectedQuality.value,
      downloadDir: selectedDir.value,
      keepSourceFilename: settings.value.download.keepSourceFilename,
      overwriteExisting: settings.value.download.overwriteExisting,
      downloadLyrics: withLyrics.value,
      lyricsFormat: settings.value.download.lyricsFormat,
      onProgress: (percent) => {
        progress.value = Math.min(100, Math.round(percent));
      },
    });
    progress.value = 100;
    const lyricNote = result.lyricsSaved ? '（含歌词）' : '';
    showToast(`下载完成${lyricNote}`, 'success');
    emit('update:visible', false);
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : (e?.message || JSON.stringify(e));
    console.error('[Download] 下载失败:', e);
    showToast(`下载失败：${msg}`, 'error');
  } finally {
    isDownloading.value = false;
    if (unlistenProgress) {
      unlistenProgress();
      unlistenProgress = null;
    }
  }
}

onUnmounted(() => {
  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <transition name="download-dialog">
      <div
        v-if="visible"
        class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      >
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close"></div>

        <div
          class="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-white/85 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:bg-gray-900/90"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-6 pt-5 pb-3">
            <h3 class="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
              <Download class="h-5 w-5 text-[#EC4141]" />
              下载歌曲
            </h3>
            <button
              type="button"
              class="rounded-lg p-1.5 text-gray-400 transition hover:bg-black/5 hover:text-gray-700 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-white"
              :disabled="isDownloading"
              @click="close"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <div class="px-6 pb-5 space-y-4">
            <!-- 歌曲信息 -->
            <div class="truncate text-sm font-medium text-gray-700 dark:text-white/80" :title="songLabel">
              {{ songLabel }}
            </div>

            <!-- 音质选择 -->
            <div class="space-y-1.5">
              <div class="text-xs font-semibold text-gray-500 dark:text-white/50">下载音质</div>
              <div class="download-select">
                <button
                  type="button"
                  class="download-select__trigger"
                  :class="{ 'download-select__trigger--open': isQualityMenuOpen }"
                  :disabled="isDownloading"
                  @click="toggleQualityMenu"
                >
                  <span>{{ selectedQualityLabel }}</span>
                  <ChevronDown
                    class="download-select__icon"
                    :class="{ 'download-select__icon--open': isQualityMenuOpen }"
                  />
                </button>
                <transition name="download-menu">
                  <div v-if="isQualityMenuOpen" class="download-select__menu">
                    <button
                      v-for="option in qualityOptions"
                      :key="option.value"
                      type="button"
                      class="download-select__option"
                      :class="{ 'download-select__option--selected': selectedQuality === option.value }"
                      @click="selectQuality(option.value)"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="text-[13px] font-semibold">{{ option.label }}</div>
                        <div class="download-select__option-desc">{{ option.desc }}</div>
                      </div>
                      <Check v-if="selectedQuality === option.value" class="h-4 w-4 flex-none" />
                    </button>
                  </div>
                </transition>
              </div>
            </div>

            <!-- 下载位置 -->
            <div class="space-y-1.5">
              <div class="text-xs font-semibold text-gray-500 dark:text-white/50">下载位置</div>
              <div class="flex items-center gap-2">
                <div
                  class="min-w-0 flex-1 truncate rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60"
                  :title="dirLabel"
                >
                  {{ dirLabel }}
                </div>
                <button
                  type="button"
                  class="download-action"
                  :disabled="isDownloading"
                  @click="chooseDir"
                >
                  <FolderOpen class="h-4 w-4" />
                  选择
                </button>
              </div>
              <!-- 记忆下载位置 -->
              <label class="mt-1 flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-white/60">
                <input
                  type="checkbox"
                  v-model="rememberPath"
                  :disabled="isDownloading"
                  class="download-checkbox"
                />
                记忆下载位置（下次自动使用此目录）
              </label>
            </div>

            <!-- 同时下载歌词 -->
            <label class="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-white/60">
              <input
                type="checkbox"
                v-model="withLyrics"
                :disabled="isDownloading"
                class="download-checkbox"
              />
              同时下载歌词
            </label>

            <!-- 进度条 -->
            <div v-if="isDownloading" class="space-y-1.5">
              <div class="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
                <div
                  class="h-full rounded-full bg-[#EC4141] transition-all duration-150"
                  :style="{ width: `${progress}%` }"
                ></div>
              </div>
              <div class="text-right text-xs text-gray-500 dark:text-white/50">{{ progress }}%</div>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex gap-3 bg-gray-50/60 px-4 py-3 dark:bg-white/5">
            <button
              type="button"
              class="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              :disabled="isDownloading"
              @click="close"
            >
              取消
            </button>
            <button
              type="button"
              class="flex-1 rounded-xl bg-[#EC4141] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isDownloading"
              @click="startDownload"
            >
              {{ isDownloading ? '下载中...' : '开始下载' }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.download-select {
  position: relative;
  width: 100%;
}

.download-select__trigger {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  padding: 8px 12px;
  color: rgb(55 65 81);
  font-size: 13px;
  font-weight: 500;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.download-select__trigger:hover,
.download-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.28);
  background: rgba(255, 255, 255, 0.86);
}

.download-select__trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.download-select__icon {
  height: 16px;
  width: 16px;
  flex: 0 0 auto;
  transition: transform 160ms ease;
}

.download-select__icon--open {
  transform: rotate(180deg);
}

.download-select__menu {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 20;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.16);
  padding: 6px;
  backdrop-filter: blur(18px);
}

.download-select__option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  border-radius: 10px;
  padding: 8px 10px;
  color: rgb(31 41 55);
  text-align: left;
  transition: background-color 140ms ease, color 140ms ease;
}

.download-select__option:hover {
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
}

.download-select__option--selected {
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
}

.download-select__option-desc {
  font-size: 11px;
  font-weight: 400;
  color: rgba(100, 116, 139, 0.85);
  margin-top: 2px;
}

.download-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 12px;
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  font-size: 12px;
  font-weight: 600;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.download-action:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.1);
}

.download-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.download-checkbox {
  height: 15px;
  width: 15px;
  flex: 0 0 auto;
  accent-color: #ec4141;
  cursor: pointer;
}

.download-dialog-enter-active,
.download-dialog-leave-active {
  transition: opacity 200ms ease;
}

.download-dialog-enter-from,
.download-dialog-leave-to {
  opacity: 0;
}

.download-menu-enter-active,
.download-menu-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
  transform-origin: top center;
}

.download-menu-enter-from,
.download-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

:global(.dark) .download-select__trigger {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .download-select__trigger:hover,
:global(.dark) .download-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(255, 255, 255, 0.08);
}

:global(.dark) .download-select__menu {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.96);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.3);
}

:global(.dark) .download-select__option {
  color: rgba(255, 255, 255, 0.88);
}

:global(.dark) .download-select__option:hover {
  background: rgba(236, 65, 65, 0.16);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .download-select__option--selected {
  background: rgba(236, 65, 65, 0.22);
  color: #fff;
}
</style>
