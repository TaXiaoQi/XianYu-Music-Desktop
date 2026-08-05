<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { ChevronDown } from 'lucide-vue-next';

import { downloadToLocal } from '../../composables/useDownloadToLocal';
import { useDownloadDialog } from '../../composables/useDownloadDialog';
import { useSettings } from '../../features/settings/useSettings';
import { getOnlineAvailableQualities } from '../../features/playback/onlinePlaybackResolver';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import type { Song, DownloadQuality, QualityKey } from '../../types';

const props = defineProps<{ visible: boolean; song: Song | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { settings } = useSettings();
// 下载内容勾选状态来自模块级 store，跨弹窗打开记忆上次选择
const { downloadAudio, downloadLyrics, downloadCover } = useDownloadDialog();

// 音质与目录每次打开都跟随设置（不记忆）
const selectedQuality = ref<DownloadQuality>('320k');
const downloadDir = ref('');
// 当前歌曲支持的音质列表（null 表示未知，回退到全部可选）
const availableQualities = ref<QualityKey[] | null>(null);
const isLoadingQualities = ref(false);
// 不支持音质折叠栏展开状态
const showUnsupportedQualities = ref(false);

/** 支持的音质列表（按 rank 排序） */
const supportedQualityKeys = computed<QualityKey[]>(() => {
  const list = availableQualities.value;
  if (!list || list.length === 0) return ALL_QUALITY_KEYS;
  return ALL_QUALITY_KEYS.filter(k => list.includes(k));
});

/** 不支持的音质列表（按 rank 排序，放在折叠栏中） */
const unsupportedQualityKeys = computed<QualityKey[]>(() => {
  const list = availableQualities.value;
  if (!list || list.length === 0) return [];
  return ALL_QUALITY_KEYS.filter(k => !list.includes(k));
});

// 弹窗打开时用设置初始化音质和目录，并异步获取歌曲支持的音质
watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      selectedQuality.value = (settings.value.download.quality as DownloadQuality) ?? '320k';
      downloadDir.value = settings.value.download.downloadPath ?? '';
      availableQualities.value = null;
      showUnsupportedQualities.value = false;

      // 异步获取歌曲支持的音质
      const song = props.song;
      if (song) {
        const songPath = song.cue_source_path || song.path;
        if (songPath.startsWith('lx://') || songPath.startsWith('plugin://')) {
          isLoadingQualities.value = true;
          try {
            availableQualities.value = await getOnlineAvailableQualities(songPath, song);
            // 若当前选择的音质不在支持列表中，自动切到支持的最高音质
            if (availableQualities.value && availableQualities.value.length > 0) {
              if (!availableQualities.value.includes(selectedQuality.value as QualityKey)) {
                selectedQuality.value = availableQualities.value[availableQualities.value.length - 1];
              }
            }
          } catch {
            availableQualities.value = null;
          } finally {
            isLoadingQualities.value = false;
          }
        }
      }
    }
  },
);

const chooseDir = async () => {
  const selected = await open({ directory: true, multiple: false, title: '选择下载目录' });
  if (selected && typeof selected === 'string') {
    downloadDir.value = selected;
  }
};

const handleDownload = async () => {
  if (!props.song) return;
  const song = props.song;
  emit('close');
  await downloadToLocal(song, {
    quality: selectedQuality.value,
    downloadDir: downloadDir.value || undefined,
    downloadAudio: downloadAudio.value,
    downloadLyrics: downloadLyrics.value,
    downloadCover: downloadCover.value,
  });
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-pop">
      <div
        v-if="visible"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
        @click.self="emit('close')"
      >
        <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[520px] max-w-[90vw] overflow-hidden">
          <!-- 标题栏 -->
          <div class="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
            <h3 class="font-bold text-gray-800 dark:text-gray-200 text-base">下载歌曲</h3>
            <button
              @click="emit('close')"
              class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              ✕
            </button>
          </div>

          <!-- 主体 -->
          <div class="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
            <!-- 歌曲信息 -->
            <div v-if="song" class="flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {{ song.title || song.name || '未知歌曲' }}
                </div>
                <div class="text-xs text-gray-400 truncate">{{ song.artist || '未知歌手' }}</div>
              </div>
            </div>

            <!-- 下载音质 -->
            <div>
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                下载音质
                <span v-if="isLoadingQualities" class="text-gray-400 font-normal">（加载中…）</span>
              </div>
              <!-- 支持的音质 -->
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="key in supportedQualityKeys"
                  :key="key"
                  type="button"
                  class="px-2 py-2 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap flex flex-col items-center gap-0.5 cursor-pointer"
                  :class="selectedQuality === key
                    ? 'bg-[#EC4141] text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
                  :title="QUALITY_META[key].description"
                  @click="selectedQuality = key"
                >
                  <span>{{ QUALITY_META[key].label }}</span>
                  <span
                    class="text-[10px] font-normal opacity-75"
                    :class="selectedQuality === key ? '' : 'text-gray-400 dark:text-gray-500'"
                  >{{ QUALITY_META[key].description }}</span>
                </button>
              </div>

              <!-- 不支持的音质折叠栏 -->
              <button
                v-if="unsupportedQualityKeys.length > 0"
                type="button"
                class="mt-2 flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
                @click="showUnsupportedQualities = !showUnsupportedQualities"
              >
                <ChevronDown
                  class="h-3 w-3 transition-transform"
                  :class="showUnsupportedQualities ? 'rotate-180' : ''"
                />
                <span>{{ showUnsupportedQualities ? '收起' : '查看' }}不支持的音质（{{ unsupportedQualityKeys.length }}）</span>
              </button>
              <Transition name="unsupported-collapse">
                <div v-if="showUnsupportedQualities && unsupportedQualityKeys.length > 0" class="grid grid-cols-3 gap-1.5 mt-2">
                  <button
                    v-for="key in unsupportedQualityKeys"
                    :key="key"
                    type="button"
                    disabled
                    class="px-2 py-2 text-xs font-semibold rounded-md text-center whitespace-nowrap flex flex-col items-center gap-0.5 bg-gray-50 dark:bg-white/5 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                    :title="'当前歌曲不支持此音质'"
                  >
                    <span>{{ QUALITY_META[key].label }}</span>
                    <span class="text-[10px] font-normal opacity-75 text-gray-400 dark:text-gray-500">{{ QUALITY_META[key].description }}</span>
                  </button>
                </div>
              </Transition>
            </div>

            <!-- 下载目录 -->
            <div>
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">下载目录</div>
              <div class="flex items-center gap-2">
                <div
                  class="flex-1 min-w-0 px-3 py-2 text-xs rounded-md bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 truncate"
                  :title="downloadDir"
                >
                  {{ downloadDir || '未选择（点击右侧按钮选择）' }}
                </div>
                <button
                  type="button"
                  class="shrink-0 px-3 py-2 text-xs font-medium rounded-md bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                  @click="chooseDir"
                >
                  选择
                </button>
              </div>
            </div>

            <!-- 下载内容 -->
            <div>
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">下载内容</div>
              <div class="space-y-2">
                <label
                  class="flex items-center gap-2.5 cursor-pointer select-none p-2 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <input
                    v-model="downloadAudio"
                    type="checkbox"
                    class="w-4 h-4 rounded accent-[#EC4141]"
                  />
                  <span class="text-sm text-gray-700 dark:text-gray-300">歌曲</span>
                </label>
                <label
                  class="flex items-center gap-2.5 cursor-pointer select-none p-2 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <input
                    v-model="downloadLyrics"
                    type="checkbox"
                    class="w-4 h-4 rounded accent-[#EC4141]"
                  />
                  <span class="text-sm text-gray-700 dark:text-gray-300">歌词</span>
                </label>
                <label
                  class="flex items-center gap-2.5 cursor-pointer select-none p-2 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <input
                    v-model="downloadCover"
                    type="checkbox"
                    class="w-4 h-4 rounded accent-[#EC4141]"
                  />
                  <span class="text-sm text-gray-700 dark:text-gray-300">封面</span>
                </label>
              </div>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div class="px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
              @click="emit('close')"
            >
              取消
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium rounded-md bg-[#EC4141] text-white hover:bg-[#d63a3a] transition-colors"
              @click="handleDownload"
            >
              下载
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 不支持音质折叠栏展开/收起过渡 */
.unsupported-collapse-enter-active,
.unsupported-collapse-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.unsupported-collapse-enter-from,
.unsupported-collapse-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
