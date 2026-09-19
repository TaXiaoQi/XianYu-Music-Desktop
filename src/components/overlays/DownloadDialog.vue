<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';

import { downloadToLocal } from '../../composables/useDownloadToLocal';
import { useSettings } from '../../features/settings/useSettings';
import { usePlaybackStore } from '../../features/playback/store';
import { getOnlineAvailableQualities } from '../../features/playback/onlinePlaybackResolver';
import {
  ensureSharedQualityProbe,
  ensureProbeRequestedUrls,
  onSharedProbeUpdate,
  sharedProbeAvailable,
} from '../../services/domain/qualitySharedProbe';
import { probeSizesForKeys } from '../../services/domain/qualitySizeMeta';
import { formatFileSize } from '../../utils/format';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import type { Song, DownloadFileNameStyle, DownloadQuality, QualityKey } from '../../types';

const props = defineProps<{
  visible: boolean;
  song: Song | null;
  initialQuality?: DownloadQuality | null;
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { settings } = useSettings();
const playbackStore = usePlaybackStore();

const selectedQuality = ref<DownloadQuality>('320k');
const downloadDir = ref('');
const selectedFileNameStyle = ref<DownloadFileNameStyle>('artist-title');
const downloadLyrics = ref(false);
const availableQualities = ref<QualityKey[] | null>(null);
const declaredQualities = ref<QualityKey[] | null>(null);
const probedUrls = ref<Partial<Record<QualityKey, string>>>({});
const qualitySizes = ref<Partial<Record<QualityKey, number>>>({});
const isProbing = ref(false);
const qualityListRef = ref<HTMLElement | null>(null);
const qualityScrollProgress = ref({ show: false, top: 0, height: 100 });

const FILE_NAME_STYLE_OPTIONS: { value: DownloadFileNameStyle; label: string; description: string }[] = [
  { value: 'artist-title', label: '歌手 - 歌名', description: '歌手在前' },
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

let probeOff: (() => void) | null = null;

const isCurrentPlaybackSong = (song: Song) => {
  const playingSong = playbackStore.currentSong;
  const targetPath = song.path;
  const targetSourcePath = song.cue_source_path || song.path;
  const playingPath = playingSong?.path;
  const playingSourcePath = playingSong?.cue_source_path || playingSong?.path;
  return playingPath === targetPath || playingSourcePath === targetSourcePath;
};

const getPlaybackAvailableQualities = (song: Song): QualityKey[] | null => {
  if (!isCurrentPlaybackSong(song)) return null;
  const qualities = playbackStore.currentAvailableQualities;
  return qualities && qualities.length > 0 ? [...qualities] : null;
};

const getInitialDownloadQuality = (song: Song | null): DownloadQuality => {
  if (props.initialQuality) {
    return props.initialQuality;
  }
  const playingQuality = playbackStore.currentPlayingQuality;
  if (song && playingQuality && isCurrentPlaybackSong(song)) {
    return playingQuality;
  }
  return (settings.value.download.quality as DownloadQuality) ?? '320k';
};

const ensureSelectedQualityAvailable = (available: QualityKey[]) => {
  if (available.length === 0) return;
  const selected = selectedQuality.value as QualityKey;
  if (available.includes(selected)) return;

  const fallbackBehavior = settings.value.download.qualityFallbackBehavior ?? 'lower';
  const selectedRank = QUALITY_META[selected]?.rank ?? QUALITY_META['320k'].rank;
  const sorted = [...available].sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank);

  if (fallbackBehavior === 'higher') {
    selectedQuality.value = sorted.find(q => QUALITY_META[q].rank > selectedRank)
      ?? sorted[sorted.length - 1];
  } else {
    selectedQuality.value = [...sorted].reverse().find(q => QUALITY_META[q].rank < selectedRank)
      ?? sorted[0];
  }
};

const compactFileSize = (bytes: number) =>
  formatFileSize(bytes).replace(/\s*MB$/, 'M').replace(/\s*GB$/, 'G').replace(/\s*KB$/, 'K');

const getAudioExtLabel = (key: QualityKey, url?: string) => {
  if (url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const match = pathname.match(/\.([a-z0-9]+)$/);
      if (match?.[1]) return match[1].toUpperCase();
    } catch {
      const match = url.toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
      if (match?.[1]) return match[1].toUpperCase();
    }
  }
  return QUALITY_META[key]?.isLossless ? 'FLAC' : 'MP3';
};

const qualityExtraText = (key: QualityKey) => {
  const url = probedUrls.value[key];
  const size = qualitySizes.value[key];
  const ext = getAudioExtLabel(key, url);
  if (typeof size === 'number' && size > 0) {
    return `${ext} · ${compactFileSize(size)}`;
  }
  if (isProbing.value) return `${ext} · 探测中`;
  return `${ext} · 未知体积`;
};

const releaseDownloadProbe = () => {
  probeOff?.();
  probeOff = null;
};

const probedSizesSet = new Set<QualityKey>();

const probeQualitySizesIncremental = async (
  song: Song,
  keys: QualityKey[],
  urlFor: (q: QualityKey) => string | undefined,
) => {
  const targets = keys.filter(k => !probedSizesSet.has(k));
  targets.forEach(k => probedSizesSet.add(k));
  await probeSizesForKeys(song, targets, urlFor, (q, bytes) => {
    qualitySizes.value = { ...qualitySizes.value, [q]: bytes };
  });
};

const supportedQualityKeys = computed<QualityKey[]>(() => {
  if (isProbing.value) {
    const declared = declaredQualities.value;
    return (declared && declared.length > 0)
      ? ALL_QUALITY_KEYS.filter(k => declared.includes(k))
      : [];
  }
  const list = availableQualities.value;
  if (list === null) return [];
  return ALL_QUALITY_KEYS.filter(k => list.includes(k));
});

const hasNoQualityOptions = computed(() => supportedQualityKeys.value.length === 0);

const scrollSelectedQualityIntoView = async () => {
  await nextTick();
  requestAnimationFrame(() => {
    const container = qualityListRef.value;
    if (!container) return;

    const target = container.querySelector<HTMLElement>(`[data-quality-value="${selectedQuality.value}"]`);
    if (!target) return;

    const targetTop = target.offsetTop - (container.clientHeight - target.clientHeight) / 2;
    container.scrollTop = Math.max(0, targetTop);
    updateQualityScrollProgress();
  });
};

const updateQualityScrollProgress = () => {
  const container = qualityListRef.value;
  if (!container) {
    qualityScrollProgress.value = { show: false, top: 0, height: 100 };
    return;
  }

  const maxScroll = container.scrollHeight - container.clientHeight;
  if (maxScroll <= 1) {
    qualityScrollProgress.value = { show: false, top: 0, height: 100 };
    return;
  }

  const height = Math.max(18, (container.clientHeight / container.scrollHeight) * 100);
  const top = (container.scrollTop / maxScroll) * (100 - height);
  qualityScrollProgress.value = { show: true, top, height };
};

const hasNoAvailableQuality = computed(() =>
  !isProbing.value
  && availableQualities.value !== null
  && availableQualities.value.length === 0,
);

const abortProbe = () => {
  probeOff?.();
  probeOff = null;
  isProbing.value = false;
};

const probeQualities = async (song: Song) => {
  const songPath = song.cue_source_path || song.path;
  if (!songPath.startsWith('lx://') && !songPath.startsWith('plugin://')) {
    return;
  }

  abortProbe();
  isProbing.value = true;

  try {
    declaredQualities.value = await getOnlineAvailableQualities(songPath, song);
  } catch {
    declaredQualities.value = null;
  }
  if (!props.visible) {
    isProbing.value = false;
    return;
  }

  const probe = await ensureSharedQualityProbe(song, declaredQualities.value);
  if (!probe) {
    isProbing.value = false;
    return;
  }

  const apply = () => {
    const shown = sharedProbeAvailable(probe);
    availableQualities.value = probe.done ? shown : null;
    probedUrls.value = { ...probe.resolvedUrls };
    void ensureProbeRequestedUrls(probe, props.song!, shown);
    const urlFor = (q: QualityKey) => probe.requestedUrls?.[q] ?? probe.resolvedUrls[q];
    void probeQualitySizesIncremental(props.song!, shown, urlFor);
    if (probe.done) {
      isProbing.value = false;
      const avail = sharedProbeAvailable(probe);
      availableQualities.value = avail;
      ensureSelectedQualityAvailable(avail);
      releaseDownloadProbe();
    }
  };

  probeOff = onSharedProbeUpdate(probe, apply);
  apply();
};

watch(
  () => [props.visible, props.song] as const,
  ([visible, song]) => {
    if (!visible) {
      abortProbe();
      return;
    }

    selectedQuality.value = getInitialDownloadQuality(song);
    downloadDir.value = settings.value.download.downloadPath ?? '';
    selectedFileNameStyle.value = settings.value.download.fileNameStyle ?? 'artist-title';
    downloadLyrics.value = settings.value.download.downloadLyrics ?? false;
    availableQualities.value = null;
    declaredQualities.value = null;
    probedUrls.value = {};
    qualitySizes.value = {};
    probedSizesSet.clear();

    if (song) {
      const playbackQualities = getPlaybackAvailableQualities(song);
      if (playbackQualities) {
        availableQualities.value = playbackQualities;
        declaredQualities.value = playbackQualities;
        ensureSelectedQualityAvailable(playbackQualities);
      }
      void probeQualities(song);
    }
  },
);

watch(
  () => [
    props.visible,
    supportedQualityKeys.value.join('|'),
    selectedQuality.value,
  ] as const,
  ([visible]) => {
    if (visible) {
      void scrollSelectedQualityIntoView();
      void nextTick(updateQualityScrollProgress);
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
    downloadCover: false,
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
        <div class="modal-content bg-white/80 dark:bg-gray-900/90 rounded-xl shadow-2xl w-[380px] max-w-[84vw] overflow-hidden">
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

          <div class="px-3.5 py-2.5 space-y-2.5 max-h-[64vh] overflow-y-auto custom-scrollbar">
            <div>
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                下载音质
                <span v-if="isProbing" class="text-gray-400 font-normal">（正在探测可用音质…）</span>
              </div>
              <div class="relative">
                <div
                  v-if="!hasNoQualityOptions"
                  ref="qualityListRef"
                  class="space-y-1.5 transition-opacity max-h-[242px] overflow-y-auto pr-3 custom-scrollbar"
                  :class="isProbing ? 'opacity-60 pointer-events-none' : ''"
                  @scroll="updateQualityScrollProgress"
                >
                  <button
                    v-for="key in supportedQualityKeys"
                    :key="key"
                    :data-quality-value="key"
                    type="button"
                    class="w-full px-3 py-2 text-left rounded-lg transition-colors flex items-center justify-between gap-3 cursor-pointer"
                    :class="selectedQuality === key
                      ? 'bg-[#EC4141]/10 text-[#EC4141]'
                      : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
                    :title="`${QUALITY_META[key].description} · ${qualityExtraText(key)}`"
                    @click="selectedQuality = key"
                  >
                    <span class="min-w-0 flex flex-col">
                      <span class="text-xs font-semibold truncate">{{ QUALITY_META[key].label }}</span>
                      <span
                        class="text-[10px] font-normal truncate"
                        :class="selectedQuality === key ? 'text-[#EC4141]/70' : 'text-gray-400 dark:text-gray-500'"
                      >{{ QUALITY_META[key].description }}</span>
                    </span>
                    <span
                      class="shrink-0 text-[11px] font-semibold whitespace-nowrap"
                      :class="selectedQuality === key ? 'text-[#EC4141]' : 'text-gray-500 dark:text-gray-400'"
                    >{{ qualityExtraText(key) }}</span>
                  </button>
                </div>
                <div
                  v-else-if="!hasNoAvailableQuality"
                  class="px-3 py-2.5 text-xs rounded-md bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400"
                >
                  {{ isProbing ? '正在探测可下载音质…' : '未获取到可下载音质列表，将使用当前音质尝试下载。' }}
                </div>
                <div
                  v-if="qualityScrollProgress.show"
                  class="pointer-events-none absolute right-0 top-0 h-full w-1 rounded-full bg-gray-200/70 dark:bg-white/10 overflow-hidden"
                  aria-hidden="true"
                >
                  <div
                    class="absolute left-0 w-full rounded-full bg-[#EC4141]/75"
                    :style="{
                      top: `${qualityScrollProgress.top}%`,
                      height: `${qualityScrollProgress.height}%`,
                    }"
                  ></div>
                </div>
              </div>

              <div
                v-if="hasNoAvailableQuality"
                class="mt-2 px-3 py-2.5 text-xs rounded-md bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
              >
                未探测到可下载的音质，仍可点击下载尝试（会自动降级并使用后端兜底音源）。
              </div>

            </div>

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
