<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';

import { downloadToLocal } from '../../composables/useDownloadToLocal';
import { useSettings } from '../../features/settings/useSettings';
import { usePlaybackStore } from '../../features/playback/store';
import { getOnlineAvailableQualities } from '../../features/playback/onlinePlaybackResolver';
import { probeDownloadableQualities } from '../../services/downloadService';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import type { Song, DownloadFileNameStyle, DownloadQuality, QualityKey } from '../../types';

const props = defineProps<{ visible: boolean; song: Song | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { settings } = useSettings();
const playbackStore = usePlaybackStore();

// 音质与目录每次打开都跟随设置（不记忆）
const selectedQuality = ref<DownloadQuality>('320k');
const downloadDir = ref('');
const selectedFileNameStyle = ref<DownloadFileNameStyle>('artist-title');
const downloadLyrics = ref(false);
/**
 * 实测可下载的音质列表。
 * null 表示尚未探测（回退到全部可选）；空数组表示探测完成且无可用档位。
 */
const availableQualities = ref<QualityKey[] | null>(null);
/** 插件声明的档位列表，探测期间用于显示骨架 */
const declaredQualities = ref<QualityKey[] | null>(null);
/** 探测阶段已解析的直链，下载时透传复用 */
const probedUrls = ref<Partial<Record<QualityKey, string>>>({});
const isProbing = ref(false);

const FILE_NAME_STYLE_OPTIONS: { value: DownloadFileNameStyle; label: string; description: string }[] = [
  { value: 'artist-title', label: '歌手 - 歌名', description: '艺术家在前' },
  { value: 'title-artist', label: '歌名 - 歌手', description: '歌名在前' },
  { value: 'title-artist-album', label: '歌名 - 歌手 - 专辑', description: '附加专辑' },
];

const dialogTitle = computed(() => {
  const song = props.song;
  if (!song) return '下载歌曲';
  const title = song.title || song.name || '未知歌曲';
  const artist = song.artist || '未知歌手';
  return `${title}-${artist}`;
});

/** 当前探测任务的中止控制器（弹窗关闭或切歌时中止，防止旧结果覆盖新歌） */
let probeController: AbortController | null = null;

interface TrustedPlaybackQuality {
  quality: QualityKey;
  url: string;
}

/** 判断播放链路命中的 URL 是否疑似把无损档静默降级成有损格式 */
const isLikelyDegradedLosslessUrl = (quality: QualityKey, url: string) => {
  if (!QUALITY_META[quality]?.isLossless) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\.(mp3|m4a|aac|ogg|wma)$/.test(pathname);
  } catch {
    return /\.(mp3|m4a|aac|ogg|wma)(?:[?#]|$)/i.test(url);
  }
};

/**
 * 复用播放链路已经解析成功的音质与直链。
 *
 * 只信任“当前正在播放同一首歌”的实际命中结果，并过滤无损档返回有损 URL 的情况。
 * 这样下载弹窗打开时可以先展示这个确定可用的档位，后续探测完成后再合并其它档位。
 */
const getTrustedPlaybackQuality = (song: Song): TrustedPlaybackQuality | null => {
  const playingSong = playbackStore.currentSong;
  const targetPath = song.path;
  const targetSourcePath = song.cue_source_path || song.path;
  const playingPath = playingSong?.path;
  const playingSourcePath = playingSong?.cue_source_path || playingSong?.path;
  const isSameSong = playingPath === targetPath || playingSourcePath === targetSourcePath;
  if (!isSameSong) return null;

  const quality = playbackStore.currentPlayingQuality;
  const url = playbackStore.currentPlayingAudioUrl;
  if (!quality || !url || !/^https?:\/\//.test(url)) return null;
  if (isLikelyDegradedLosslessUrl(quality, url)) return null;

  return { quality, url };
};

/** 将播放命中的可信档位合并进实测结果，避免后台探测完成后覆盖掉该档位 */
const mergeTrustedPlaybackQuality = (
  song: Song,
  available: QualityKey[],
  resolvedUrls: Partial<Record<QualityKey, string>>,
) => {
  const trusted = getTrustedPlaybackQuality(song);
  if (!trusted) {
    return { available, resolvedUrls };
  }

  return {
    available: available.includes(trusted.quality)
      ? available
      : [...available, trusted.quality],
    resolvedUrls: {
      ...resolvedUrls,
      [trusted.quality]: resolvedUrls[trusted.quality] ?? trusted.url,
    },
  };
};

/** 主区展示的档位：探测中显示声明列表（骨架），探测后显示实测可用列表 */
const supportedQualityKeys = computed<QualityKey[]>(() => {
  if (isProbing.value) {
    const declared = declaredQualities.value;
    return (declared && declared.length > 0)
      ? ALL_QUALITY_KEYS.filter(k => declared.includes(k))
      : ALL_QUALITY_KEYS;
  }
  const list = availableQualities.value;
  if (list === null) return ALL_QUALITY_KEYS;
  return ALL_QUALITY_KEYS.filter(k => list.includes(k));
});

/** 探测完成且所有档位都不可用 */
const hasNoAvailableQuality = computed(() =>
  !isProbing.value
  && availableQualities.value !== null
  && availableQualities.value.length === 0,
);

/** 中止进行中的探测 */
const abortProbe = () => {
  probeController?.abort();
  probeController = null;
  isProbing.value = false;
};

/**
 * 探测当前歌曲各档位的真实可下载性。
 *
 * 分两步：先取插件声明列表（快，通常无网络请求，用于确定探测范围与展示骨架），
 * 再对声明的档位实际请求直链，只保留真正拿到有效 URL 的档位。
 */
const probeQualities = async (song: Song) => {
  const songPath = song.cue_source_path || song.path;
  if (!songPath.startsWith('lx://') && !songPath.startsWith('plugin://')) {
    return;
  }

  abortProbe();
  const controller = new AbortController();
  probeController = controller;
  isProbing.value = true;

  try {
    // 1. 插件声明列表：作为探测上界与探测期间的展示骨架
    try {
      declaredQualities.value = await getOnlineAvailableQualities(songPath, song);
    } catch {
      declaredQualities.value = null;
    }
    if (controller.signal.aborted) return;

    // 2. 实测探测
    const result = await probeDownloadableQualities(song, declaredQualities.value, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;

    const merged = mergeTrustedPlaybackQuality(song, result.available, result.resolvedUrls);
    availableQualities.value = merged.available;
    probedUrls.value = merged.resolvedUrls;

    // 当前选中档位不可用时，切到实测可用的最高档
    if (merged.available.length > 0
      && !merged.available.includes(selectedQuality.value as QualityKey)) {
      selectedQuality.value = merged.available[merged.available.length - 1];
    }
  } catch (e: any) {
    if (!controller.signal.aborted) {
      console.warn('[DownloadDialog] 音质探测失败:', e?.message || e);
      // 探测失败时回退到"未知"，保持全部档位可选，不堵死用户
      availableQualities.value = null;
    }
  } finally {
    if (probeController === controller) {
      probeController = null;
      isProbing.value = false;
    }
  }
};

// 弹窗打开时用设置初始化音质和目录，并探测真实可用音质
watch(
  () => [props.visible, props.song] as const,
  ([visible, song]) => {
    if (!visible) {
      abortProbe();
      return;
    }

    selectedQuality.value = (settings.value.download.quality as DownloadQuality) ?? '320k';
    downloadDir.value = settings.value.download.downloadPath ?? '';
    selectedFileNameStyle.value = settings.value.download.fileNameStyle ?? 'artist-title';
    downloadLyrics.value = false;
    availableQualities.value = null;
    declaredQualities.value = null;
    probedUrls.value = {};

    if (song) {
      const trusted = getTrustedPlaybackQuality(song);
      if (trusted) {
        availableQualities.value = [trusted.quality];
        probedUrls.value = { [trusted.quality]: trusted.url };
        selectedQuality.value = trusted.quality;
      }
      void probeQualities(song);
    }
  },
);

onUnmounted(abortProbe);

const chooseDir = async () => {
  const selected = await open({ directory: true, multiple: false, title: '选择下载目录' });
  if (selected && typeof selected === 'string') {
    downloadDir.value = selected;
  }
};

const handleDownload = async () => {
  if (!props.song) return;
  const song = props.song;
  const preResolvedUrls = probedUrls.value;
  emit('close');
  await downloadToLocal(song, {
    quality: selectedQuality.value,
    downloadDir: downloadDir.value || undefined,
    downloadAudio: true,
    downloadLyrics: downloadLyrics.value,
    downloadCover: true,
    fileNameStyle: selectedFileNameStyle.value,
    preResolvedUrls,
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
        <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[380px] max-w-[84vw] overflow-hidden">
          <!-- 标题栏 -->
          <div class="px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
            <h3
              class="font-bold text-gray-800 dark:text-gray-200 text-base truncate pr-3"
              :title="dialogTitle"
            >{{ dialogTitle }}</h3>
            <button
              @click="emit('close')"
              class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              ✕
            </button>
          </div>

          <!-- 主体 -->
          <div class="px-3.5 py-2.5 space-y-2.5 max-h-[64vh] overflow-y-auto custom-scrollbar">
            <!-- 下载音质 -->
            <div>
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                下载音质
                <span v-if="isProbing" class="text-gray-400 font-normal">（正在探测可用音质…）</span>
              </div>
              <!-- 可用音质：探测中显示声明列表并禁用交互，避免点到最终不可用的档位 -->
              <div
                class="grid grid-cols-3 gap-1.5 transition-opacity"
                :class="isProbing ? 'opacity-60 pointer-events-none' : ''"
              >
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

              <!-- 探测完成但无可用档位：仍允许直接下载（走降级 + 后端兜底） -->
              <div
                v-if="hasNoAvailableQuality"
                class="mt-2 px-3 py-2.5 text-xs rounded-md bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
              >
                未探测到可下载的音质，仍可点击下载尝试（会自动降级并使用后端兜底音源）。
              </div>

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
                  class="shrink-0 px-3 py-2 text-xs font-medium rounded-md bg-[#EC4141] text-white hover:bg-[#d13b3b] transition-colors"
                  @click="chooseDir"
                >
                  选择
                </button>
              </div>
            </div>

            <!-- 文件命名样式 -->
            <div>
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">文件命名样式</div>
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="option in FILE_NAME_STYLE_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="px-2 py-2 text-xs font-semibold rounded-md transition-colors text-center flex flex-col items-center gap-0.5"
                  :class="selectedFileNameStyle === option.value
                    ? 'bg-[#EC4141] text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
                  :title="option.description"
                  @click="selectedFileNameStyle = option.value"
                >
                  <span>{{ option.label }}</span>
                  <span
                    class="text-[10px] font-normal opacity-75"
                    :class="selectedFileNameStyle === option.value ? '' : 'text-gray-400 dark:text-gray-500'"
                  >{{ option.description }}</span>
                </button>
              </div>
            </div>

            <!-- 下载独立歌词 -->
            <div>
              <button
                type="button"
                class="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-left"
                @click="downloadLyrics = !downloadLyrics"
              >
                <div class="min-w-0">
                  <div class="text-sm font-medium text-gray-700 dark:text-gray-300">下载独立歌词</div>
                  <div class="text-xs text-gray-400 dark:text-gray-500">默认关闭，开启后在音频文件旁保存 .lrc/.txt</div>
                </div>
                <span
                  class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
                  :class="downloadLyrics ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
                >
                  <span
                    class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                    :class="downloadLyrics ? 'translate-x-6' : 'translate-x-1'"
                  />
                </span>
              </button>
            </div>

          </div>

          <!-- 底部按钮 -->
          <div class="px-3.5 py-2.5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
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
