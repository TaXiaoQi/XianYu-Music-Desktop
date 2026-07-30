<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Check, ChevronDown, FolderOpen, Download, X, Loader2 } from 'lucide-vue-next';
import type { DownloadFileNameStyle, DownloadQuality, Song, QualityKey } from '../../types';
import { QUALITY_META, ALL_QUALITY_KEYS_DESC } from '../../types';
import { useSettings } from '../../features/settings/useSettings';
import { useToast } from '../../composables/toast';
import {
  downloadSong,
  probeAvailableQualities,
  formatFileSize,
  buildFileNameBase,
  sanitizeFileName,
  type ProbedQuality,
} from '../../services/downloadService';
import { recordDownload, fileNameFromPath } from '../../services/downloadHistory';

const props = defineProps<{
  visible: boolean;
  song: Song | null;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  /** 下载成功并写入记录后触发，供父组件刷新「已下载」状态 */
  (e: 'downloaded'): void;
}>();

const { settings } = useSettings();
const { showToast } = useToast();

/**
 * UI 音质选项。probeAvailableQualities 按 quality 键直接返回（12 档统一标准），
 * 这里把探测得到的大小/扩展名与 12 档元信息合并，按品质从高到低展示。
 */
type QualityOption = {
  value: DownloadQuality; // = QualityKey
  label: string;          // 中文标签（低清/普通/中等/HQ/SQ/Hi-Res/高解析度/黑胶/杜比/臻品/全景/母带）
  desc: string;           // 比特率/格式文案
  /** 探测得到的大小文案（空串表示未知） */
  sizeText: string;
  /** 探测得到的文件扩展名（含点） */
  ext: string;
};

// 对话框内的当次选择（初始化自全局设置，默认 '320k' = HQ）
const selectedQuality = ref<DownloadQuality>('320k');
const selectedDir = ref('');
const rememberPath = ref(false);
const withLyrics = ref(true);
const isQualityMenuOpen = ref(false);

// 文件名样式
const selectedFileNameStyle = ref<DownloadFileNameStyle>('artist-title');
const isFileNameMenuOpen = ref(false);

const FILE_NAME_STYLE_OPTIONS: { value: DownloadFileNameStyle; label: string }[] = [
  { value: 'artist-title', label: '歌手 - 歌名' },
  { value: 'title-artist', label: '歌名 - 歌手' },
  { value: 'title-artist-album', label: '歌名 - 歌手 - 专辑' },
];

const selectedFileNameStyleLabel = computed(
  () => FILE_NAME_STYLE_OPTIONS.find((o) => o.value === selectedFileNameStyle.value)?.label
    ?? '歌手 - 歌名',
);

/** 实时预览最终文件名（扩展名取当前选中音质的探测结果） */
const fileNamePreview = computed(() => {
  if (!props.song) return '';
  const base = buildFileNameBase(props.song, selectedFileNameStyle.value);
  const ext = selectedQualityOption.value?.ext || '';
  return sanitizeFileName(base) + ext;
});

function toggleFileNameMenu() {
  if (isDownloading.value) return;
  isFileNameMenuOpen.value = !isFileNameMenuOpen.value;
}

function selectFileNameStyle(value: DownloadFileNameStyle) {
  selectedFileNameStyle.value = value;
  isFileNameMenuOpen.value = false;
}

// 探测状态：打开对话框时立即探测音源，探测完成后才能选择音质
const isProbing = ref(false);
const probeError = ref('');
const probedList = ref<ProbedQuality[]>([]);

/**
 * 可用音质选项列表：从 probeAvailableQualities 返回的 ProbedQuality 列表
 * 直接映射为 12 档 UI 选项，保持从高到低顺序（ALL_QUALITY_KEYS_DESC）。
 * 支持插件返回任意 12 档内的音质（如 mgg / 192k / hires / vinyl / dolby / atmos / master）。
 */
const availableQualityOptions = computed<QualityOption[]>(() => {
  const byQuality = new Map<QualityKey, ProbedQuality>();
  for (const p of probedList.value) {
    if (!byQuality.has(p.quality as QualityKey)) byQuality.set(p.quality as QualityKey, p);
  }
  return ALL_QUALITY_KEYS_DESC
    .filter((q) => byQuality.has(q))
    .map<QualityOption>((q) => {
      const info = byQuality.get(q)!;
      const meta = QUALITY_META[q];
      return { value: q, label: meta.label, desc: meta.description, sizeText: info.sizeText, ext: info.ext };
    });
});

const isDownloading = ref(false);
const progress = ref(0);
let unlistenProgress: UnlistenFn | null = null;
// 避免慢探测在对话框关闭/换歌后仍写回状态
let probeToken = 0;

const songLabel = computed(() => {
  if (!props.song) return '';
  const title = props.song.title || props.song.name || '未知歌曲';
  const artist = props.song.artist || '';
  return artist ? `${artist} - ${title}` : title;
});

const dirLabel = computed(() => selectedDir.value || '未设置，请选择下载目录');

function formatQualityBadge(o: QualityOption): string {
  const parts: string[] = [o.label];
  if (o.ext) parts.push(o.ext.replace(/^\./, '').toUpperCase());
  parts.push(formatFileSize(o.sizeText));
  return parts.join(' · ');
}

const selectedQualityOption = computed(() =>
  availableQualityOptions.value.find((o) => o.value === selectedQuality.value),
);

const selectedQualityLabel = computed(() =>
  selectedQualityOption.value
    ? formatQualityBadge(selectedQualityOption.value)
    : QUALITY_META[selectedQuality.value as QualityKey]?.label ?? 'HQ',
);

// 探测当前歌曲实际可下载的档位
async function runProbe(song: Song) {
  const token = ++probeToken;
  isProbing.value = true;
  probeError.value = '';
  probedList.value = [];
  try {
    const list = await probeAvailableQualities(song);
    if (token !== probeToken) return;
    probedList.value = list;
    // 若用户默认选的档位音源没有，自动落到最高可用档
    const opts = availableQualityOptions.value;
    if (!opts.some((o) => o.value === selectedQuality.value)) {
      selectedQuality.value = opts[0]?.value ?? selectedQuality.value;
    }
    if (opts.length === 0) {
      probeError.value = '未探测到可下载的音源，可能无版权或音源暂不可用';
    }
  } catch (e: any) {
    if (token !== probeToken) return;
    probeError.value = e?.message || '探测音源失败';
  } finally {
    if (token === probeToken) isProbing.value = false;
  }
}

// 打开对话框时用全局设置初始化当次选择，并立即启动探测
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      selectedQuality.value = settings.value.download.quality;
      selectedDir.value = settings.value.download.downloadPath;
      rememberPath.value = settings.value.download.rememberDownloadPath;
      withLyrics.value = settings.value.download.downloadLyrics;
      selectedFileNameStyle.value = settings.value.download.fileNameStyle ?? 'artist-title';
      isFileNameMenuOpen.value = false;
      isQualityMenuOpen.value = false;
      isDownloading.value = false;
      progress.value = 0;
      probedList.value = [];
      probeError.value = '';
      if (props.song) void runProbe(props.song);
    } else {
      // 关闭时废止正在进行的探测
      probeToken++;
      isProbing.value = false;
    }
  },
);

// 对话框保持打开但换歌时重新探测
watch(
  () => props.song,
  (song) => {
    if (props.visible && song) void runProbe(song);
  },
);

function close() {
  if (isDownloading.value) return;
  emit('update:visible', false);
}

function toggleQualityMenu() {
  if (isProbing.value || availableQualityOptions.value.length === 0) return;
  isQualityMenuOpen.value = !isQualityMenuOpen.value;
}

const canStartDownload = computed(
  () => !isProbing.value && !isDownloading.value && availableQualityOptions.value.length > 0,
);

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

  // 文件名样式：记住本次选择，下次打开对话框沿用
  settings.value.download.fileNameStyle = selectedFileNameStyle.value;

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
      fileNameStyle: selectedFileNameStyle.value,
      overwriteExisting: settings.value.download.overwriteExisting,
      downloadLyrics: withLyrics.value,
      lyricsFormat: settings.value.download.lyricsFormat,
      onProgress: (percent) => {
        progress.value = Math.min(100, Math.round(percent));
      },
    });
    progress.value = 100;

    // 记录本次下载（位置 + 文件名），供后续播放到该歌曲时显示「已下载」状态
    await recordDownload({
      songPath: props.song.cue_source_path || props.song.path,
      filePath: result.filePath,
      fileName: fileNameFromPath(result.filePath),
      quality: result.hitQuality,
      downloadedAt: Date.now(),
      title: props.song.title || props.song.name,
      artist: props.song.artist,
    });
    emit('downloaded');

    const lyricNote = result.lyricsSaved ? '（含歌词）' : '';
    // 命中的实际档位可能低于用户所选（无版权自动降级）
    const hitMeta = QUALITY_META[result.hitQuality as QualityKey];
    const hitLabel = hitMeta ? `${hitMeta.label} ${hitMeta.description}` : result.hitQuality;
    // 比较 rank：命中音质 rank 低于用户选择的 rank 即为降级（rank 越大音质越好）
    const selectedMeta = QUALITY_META[selectedQuality.value as QualityKey];
    const degraded = selectedMeta && hitMeta ? hitMeta.rank < selectedMeta.rank : result.hitQuality !== selectedQuality.value;
    const note = degraded ? `（实际下载音质：${hitLabel}）` : '';
    showToast(`下载完成${note}${lyricNote}`, degraded ? 'info' : 'success');
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

            <!-- 音质选择：先探测再展示实际可用档位 -->
            <div class="space-y-1.5">
              <div class="text-xs font-semibold text-gray-500 dark:text-white/50">下载音质</div>

              <!-- 探测中 -->
              <div v-if="isProbing" class="download-select__loading">
                <Loader2 class="download-select__spinner" />
                <span>正在探测可用音源…</span>
              </div>

              <!-- 探测失败或无可用档位 -->
              <div v-else-if="availableQualityOptions.length === 0" class="download-select__empty">
                {{ probeError || '未探测到可下载的音源' }}
              </div>

              <!-- 探测完成：只显示实际可用档位 -->
              <div v-else class="download-select">
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
                      v-for="option in availableQualityOptions"
                      :key="option.value"
                      type="button"
                      class="download-select__option"
                      :class="{ 'download-select__option--selected': selectedQuality === option.value }"
                      @click="selectQuality(option.value)"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="text-[13px] font-semibold">{{ option.label }}</span>
                          <span v-if="option.ext" class="download-select__ext-badge">
                            {{ option.ext.replace(/^\./, '').toUpperCase() }}
                          </span>
                        </div>
                        <div class="download-select__option-desc">
                          {{ option.desc }} · {{ formatFileSize(option.sizeText) }}
                        </div>
                      </div>
                      <Check v-if="selectedQuality === option.value" class="h-4 w-4 flex-none" />
                    </button>
                  </div>
                </transition>
              </div>
            </div>

            <!-- 文件名样式 -->
            <div class="space-y-1.5">
              <div class="text-xs font-semibold text-gray-500 dark:text-white/50">文件名样式</div>
              <div class="download-select">
                <button
                  type="button"
                  class="download-select__trigger"
                  :class="{ 'download-select__trigger--open': isFileNameMenuOpen }"
                  :disabled="isDownloading"
                  @click="toggleFileNameMenu"
                >
                  <span>{{ selectedFileNameStyleLabel }}</span>
                  <ChevronDown
                    class="download-select__icon"
                    :class="{ 'download-select__icon--open': isFileNameMenuOpen }"
                  />
                </button>
                <transition name="download-menu">
                  <div v-if="isFileNameMenuOpen" class="download-select__menu">
                    <button
                      v-for="option in FILE_NAME_STYLE_OPTIONS"
                      :key="option.value"
                      type="button"
                      class="download-select__option"
                      :class="{ 'download-select__option--selected': selectedFileNameStyle === option.value }"
                      @click="selectFileNameStyle(option.value)"
                    >
                      <div class="min-w-0 flex-1 text-[13px] font-semibold">{{ option.label }}</div>
                      <Check v-if="selectedFileNameStyle === option.value" class="h-4 w-4 flex-none" />
                    </button>
                  </div>
                </transition>
              </div>
              <!-- 最终文件名预览 -->
              <div class="download-filename-preview" :title="fileNamePreview">
                {{ fileNamePreview }}
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
              :disabled="!canStartDownload"
              @click="startDownload"
            >
              <span v-if="isProbing" class="inline-flex items-center gap-1.5">
                <Loader2 class="h-4 w-4 animate-spin" />
                探测中...
              </span>
              <span v-else>{{ isDownloading ? '下载中...' : '开始下载' }}</span>
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

.download-select__loading,
.download-select__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px dashed rgba(148, 163, 184, 0.32);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  color: rgba(55, 65, 81, 0.72);
}

.download-select__empty {
  color: rgba(236, 65, 65, 0.9);
  border-style: solid;
  border-color: rgba(236, 65, 65, 0.24);
  background: rgba(236, 65, 65, 0.06);
}

.download-select__spinner {
  height: 16px;
  width: 16px;
  flex: 0 0 auto;
  color: #ec4141;
  animation: download-spin 900ms linear infinite;
}

@keyframes download-spin {
  to {
    transform: rotate(360deg);
  }
}

:global(.dark) .download-select__loading {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
}

:global(.dark) .download-select__empty {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(236, 65, 65, 0.14);
  color: rgba(255, 200, 200, 0.95);
}

.download-select__trigger {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* 窗口很窄时避免文字被压成竖排 */
  white-space: nowrap;
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
  white-space: nowrap;
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

.download-filename-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 2px;
  font-size: 11px;
  color: rgba(100, 116, 139, 0.9);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

:global(.dark) .download-filename-preview {
  color: rgba(255, 255, 255, 0.5);
}

.download-select__ext-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

:global(.dark) .download-select__ext-badge {
  background: rgba(236, 65, 65, 0.22);
  color: #ff8a8a;
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
