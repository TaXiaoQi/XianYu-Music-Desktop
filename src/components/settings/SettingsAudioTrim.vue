<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useToast } from '../../composables/toast';
import { audioConvertApi, type FfmpegDetection } from '../../services/tauri/audioConvertApi';
import { audioTrimApi, type TrimAudioResult } from '../../services/tauri/audioTrimApi';

const toast = useToast();

const AUDIO_EXTENSIONS = ['mp3','aac','m4a','wav','flac','ogg','oga','opus','wma','aiff','aif','ape','alac','mp4','m4b'];
const FFMPEG_PATH_KEY = 'toolbox_ffmpeg_path';

const ffmpeg = ref<FfmpegDetection | null>(null);
const checking = ref(true);
/** 手动指定的 ffmpeg.exe 路径（与文件转换共用同一持久化 key） */
const ffmpegPath = ref<string>(localStorage.getItem(FFMPEG_PATH_KEY) || '');

const inputPath = ref('');
const inputName = ref('');
/** 音频总时长（秒），探测后填充 */
const totalDuration = ref(0);
const probing = ref(false);
/** 裁剪区间（秒）：起点与终点 */
const startSecs = ref(0);
const endSecs = ref(0);
/** 输出目录；空 = 与原文件同目录 */
const outputDir = ref('');
const trimming = ref(false);
const result = ref<TrimAudioResult | null>(null);
const error = ref('');

interface TrimLogEntry {
  text: string;
  kind: 'info' | 'error';
}
const logs = ref<TrimLogEntry[]>([]);
const logsContainer = ref<HTMLElement | null>(null);

function pushLog(line: string) {
  const text = line.trim();
  if (!text) return;
  const kind: TrimLogEntry['kind'] = /error|invalid|failed|unable|cannot|not found|denied|exception/i.test(text)
    ? 'error'
    : 'info';
  logs.value.push({ text, kind });
  if (logs.value.length > 300) logs.value.splice(0, logs.value.length - 300);
  nextTick(() => {
    if (logsContainer.value) logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
  });
}

let unlistenLog: (() => void) | null = null;

const roundedDuration = computed(() =>
  totalDuration.value > 0 ? Math.max(totalDuration.value, 0.1) : 1,
);
/** 起点百分比（0-100），用于高亮滑动条选区 */
const startPct = computed(() => (startSecs.value / roundedDuration.value) * 100);
/** 选区宽度百分比 */
const spanPct = computed(() =>
  Math.max(0, ((endSecs.value - startSecs.value) / roundedDuration.value) * 100),
);
const selectedSecs = computed(() => Math.max(0, endSecs.value - startSecs.value));

/** 成品试听地址：裁剪成功后把本地输出文件转成可被 <audio> 播放的 asset URL */
const resultAudioUrl = computed(() => {
  if (result.value?.success && result.value.output_path) {
    return convertFileSrc(result.value.output_path);
  }
  return '';
});

/** 选区试听（裁剪前）：用原文件按起止区间播放，借助媒体片段 #t=start,end */
const previewAudio = ref<HTMLAudioElement | null>(null);
const previewPlaying = ref(false);
const previewSrc = computed(() => {
  if (!inputPath.value || totalDuration.value <= 0) return '';
  const start = Math.min(startSecs.value, Math.max(0, endSecs.value - 0.1));
  const end = endSecs.value;
  return `${convertFileSrc(inputPath.value)}#t=${start.toFixed(1)},${end.toFixed(1)}`;
});

function stopPreview() {
  const audio = previewAudio.value;
  if (audio && !audio.paused) audio.pause();
  if (audio) audio.currentTime = 0;
  previewPlaying.value = false;
}

async function togglePreview() {
  const audio = previewAudio.value;
  if (!audio) return;
  if (previewPlaying.value) {
    stopPreview();
    return;
  }
  if (!previewSrc.value) return;
  try {
    audio.src = previewSrc.value;
    await audio.play();
    previewPlaying.value = true;
  } catch (e: any) {
    previewPlaying.value = false;
    toast.showToast(`试听失败: ${e?.message || e}`, 'error');
  }
}

function onPreviewEnded() {
  previewPlaying.value = false;
}

const fmtSecs = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const secStr = sec < 10 ? `0${sec.toFixed(1)}` : sec.toFixed(1);
  return `${m}:${secStr}`;
};

const canTrim = computed(
  () => Boolean(ffmpeg.value?.available && inputPath.value && selectedSecs.value > 0),
);

async function checkFfmpeg() {
  checking.value = true;
  try {
    ffmpeg.value = await audioConvertApi.detectFfmpeg(ffmpegPath.value || undefined);
  } catch (e: any) {
    ffmpeg.value = { available: false, path: ffmpegPath.value || null, version: null, error: String(e?.message || e) };
  } finally {
    checking.value = false;
  }
}

const pickFfmpeg = async () => {
  try {
    const selected = await open({
      multiple: false,
      title: '选择 ffmpeg.exe 可执行文件',
      filters: [{ name: 'ffmpeg 可执行文件', extensions: ['exe'] }],
    });
    if (selected && typeof selected === 'string') {
      ffmpegPath.value = selected;
      localStorage.setItem(FFMPEG_PATH_KEY, selected);
      await checkFfmpeg();
    }
  } catch (e: any) {
    toast.showToast(`选择 ffmpeg 失败: ${e?.message || e}`, 'error');
  }
};

const clearFfmpegPath = async () => {
  ffmpegPath.value = '';
  localStorage.removeItem(FFMPEG_PATH_KEY);
  await checkFfmpeg();
};

const openFfmpegSite = () => {
  openUrl('https://ffmpeg.org/download.html').catch(() => {});
};

const getPathLeaf = (path: string) => {
  const segs = path.split(/[\\/]/).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : path;
};

/** 选择单个音频文件并探测时长 */
const pickInput = async () => {
  stopPreview();
  try {
    const selected = await open({
      multiple: false,
      title: '选择要裁剪的音频文件',
      filters: [{ name: '音频文件', extensions: AUDIO_EXTENSIONS }],
    });
    if (!selected || typeof selected !== 'string') return;
    inputPath.value = selected;
    inputName.value = getPathLeaf(selected);
    result.value = null;
    error.value = '';
    logs.value = [];
    totalDuration.value = 0;
    probing.value = true;
    try {
      const d = await audioTrimApi.probeDuration(selected, ffmpegPath.value || undefined);
      totalDuration.value = d;
      startSecs.value = 0;
      endSecs.value = d;
    } catch (e: any) {
      error.value = String(e?.message || e);
      toast.showToast(`探测时长失败: ${error.value}`, 'error');
      totalDuration.value = 0;
    } finally {
      probing.value = false;
    }
  } catch (e: any) {
    toast.showToast(`选择文件失败: ${e?.message || e}`, 'error');
  }
};

const pickOutputDir = async () => {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择裁剪输出目录',
    });
    if (selected && typeof selected === 'string') outputDir.value = selected;
  } catch (e: any) {
    toast.showToast(`选择目录失败: ${e?.message || e}`, 'error');
  }
};

const onStartInput = (e: Event) => {
  stopPreview();
  const v = Number((e.target as HTMLInputElement).value);
  startSecs.value = Math.min(v, endSecs.value - 0.1);
};
const onEndInput = (e: Event) => {
  stopPreview();
  const v = Number((e.target as HTMLInputElement).value);
  endSecs.value = Math.max(v, startSecs.value + 0.1);
};

const startTrim = async () => {
  stopPreview();
  if (!canTrim.value) {
    toast.showToast('请先选择音频文件并确认裁剪区间', 'error');
    return;
  }
  trimming.value = true;
  error.value = '';
  result.value = null;
  logs.value = [];
  try {
    const res = await audioTrimApi.trimAudio(inputPath.value, startSecs.value, endSecs.value, {
      ...(outputDir.value ? { outputDir: outputDir.value } : {}),
      ...(ffmpegPath.value ? { ffmpegPath: ffmpegPath.value } : {}),
    });
    result.value = res;
    if (res.success) {
      toast.showToast(`裁剪完成：${getPathLeaf(res.output_path)}`, 'success');
    } else {
      toast.showToast(`裁剪失败：${res.error || '未知错误'}`, 'error');
    }
  } catch (e: any) {
    error.value = String(e?.message || e);
    toast.showToast(`裁剪失败: ${error.value}`, 'error');
  } finally {
    trimming.value = false;
  }
};

const resetAll = () => {
  stopPreview();
  inputPath.value = '';
  inputName.value = '';
  totalDuration.value = 0;
  startSecs.value = 0;
  endSecs.value = 0;
  result.value = null;
  error.value = '';
};

onMounted(async () => {
  await checkFfmpeg();
  unlistenLog = await listen<{ inputPath: string; line: string }>('toolbox-trim-log', (e) => {
    if (!trimming.value) return;
    pushLog(e.payload.line);
  });
});

onUnmounted(() => {
  stopPreview();
  unlistenLog?.();
});
</script>

<template>
  <div class="w-full space-y-6 pb-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <!-- 检测中 -->
    <div v-if="checking" class="toolbox-panel toolbox-panel--muted flex items-center gap-3 text-sm text-gray-500 dark:text-white/45">
      <svg class="h-5 w-5 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span>正在检测 ffmpeg...</span>
    </div>

    <!-- 未检测到 ffmpeg：引导下载 -->
    <div v-else-if="!ffmpeg?.available" class="toolbox-panel p-6">
      <div class="flex items-start gap-4">
        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="text-[15px] font-semibold text-gray-900 dark:text-white">未检测到 ffmpeg</h3>
          <p class="mt-1 text-[13px] leading-6 text-gray-500 dark:text-white/55">
            音频剪辑依赖系统安装的 <strong>ffmpeg</strong>，请在电脑上安装它，并确保可被命令行直接调用（或手动选择 ffmpeg.exe）。
          </p>
          <div v-if="ffmpeg?.error" class="mt-2 text-[12px] text-red-500 dark:text-red-400">检测详情：{{ ffmpeg.error }}</div>
          <div v-if="ffmpegPath" class="mt-2 flex items-center gap-2">
            <span class="truncate rounded-md bg-black/5 px-2 py-1 text-[12px] text-gray-500 dark:bg-white/10 dark:text-white/55">已指定：{{ ffmpegPath }}</span>
            <button type="button" class="shrink-0 text-[12px] text-gray-400 hover:text-red-500" @click="clearFfmpegPath">清除</button>
          </div>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" class="rounded-xl bg-[#EC4141] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#d63a3a]" @click="openFfmpegSite">
              去 ffmpeg 官网下载
            </button>
            <button type="button" class="toolbox-ghost-btn !bg-gray-500/80 hover:!bg-gray-500" @click="pickFfmpeg">
              手动选择 ffmpeg.exe
            </button>
            <button type="button" class="toolbox-ghost-btn !bg-gray-500/80 hover:!bg-gray-500" @click="checkFfmpeg">
              重新检测
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 已就绪：裁剪界面 -->
    <div v-else class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(420px,3fr)]">
      <div class="space-y-6">
        <!-- 状态条 -->
        <div class="flex items-center justify-between gap-3">
          <span class="inline-flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-300">
            <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
            ffmpeg 可用
          </span>
          <button type="button" class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-white/70" @click="checkFfmpeg">
            重新检测
          </button>
        </div>

        <!-- 1. 选择音频文件 -->
        <section class="toolbox-item p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">① 选择音频文件（单个）</div>
            <button type="button" class="toolbox-ghost-btn" @click="pickInput">选择文件</button>
          </div>
          <div v-if="inputName" class="mt-3 truncate rounded-md bg-black/5 px-2.5 py-1.5 text-[12px] text-gray-600 dark:bg-white/10 dark:text-gray-200">
            {{ inputName }}
          </div>
          <div v-else class="mt-3 border border-dashed border-gray-300/60 px-3 py-4 text-center text-[12px] text-gray-400 dark:border-white/15 dark:text-white/40">
            选择 mp3 / flac / wav / ogg / m4a 等音频，裁剪后保持原格式无损输出
          </div>
        </section>

        <!-- 2. 裁剪区间 -->
        <section class="toolbox-item p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">② 拖动滑块选择裁剪区间</div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                v-if="inputName && totalDuration > 0"
                type="button"
                class="trim-preview-btn"
                @click="togglePreview"
              >
                <svg v-if="!previewPlaying" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.89a1.5 1.5 0 0 0 0-2.54L6.3 2.84Z" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5.75 3A1.75 1.75 0 0 0 4 4.75v10.5A1.75 1.75 0 0 0 5.75 17h2.5A1.75 1.75 0 0 0 10 15.25V4.75A1.75 1.75 0 0 0 8.25 3h-2.5ZM13.75 3A1.75 1.75 0 0 0 12 4.75v10.5A1.75 1.75 0 0 0 13.75 17h2.5A1.75 1.75 0 0 0 18 15.25V4.75A1.75 1.75 0 0 0 16.25 3h-2.5Z" />
                </svg>
                {{ previewPlaying ? '停止试听' : '试听选区' }}
              </button>
              <span v-if="totalDuration > 0" class="rounded-full bg-black/5 px-2.5 py-1 text-[11px] text-gray-500 dark:bg-white/10 dark:text-white/55">
                总时长 {{ fmtSecs(totalDuration) }}
              </span>
            </div>
          </div>

          <audio ref="previewAudio" class="hidden" preload="none" @ended="onPreviewEnded"></audio>

          <div v-if="probing" class="mt-4 flex items-center gap-3 text-[12px] text-gray-500 dark:text-white/45">
            <svg class="h-4 w-4 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>正在探测音频时长...</span>
          </div>

          <div v-else-if="totalDuration <= 0" class="mt-3 border border-dashed border-gray-300/60 px-3 py-4 text-center text-[12px] text-gray-400 dark:border-white/15 dark:text-white/40">
            选择音频文件后，这里会出现可拖动的裁剪进度条
          </div>

          <div v-else class="mt-4">
            <div class="trim-range">
              <!-- 底座轨道 + 选中高亮 -->
              <div class="trim-range-track"></div>
              <div
                class="trim-range-selection"
                :style="{ left: `${startPct}%`, width: `${spanPct}%` }"
              ></div>
              <!-- 起点滑块（上层）与终点滑块（下层） -->
              <input
                class="trim-range-input trim-range-input--top"
                type="range"
                min="0"
                :max="totalDuration"
                step="0.1"
                :value="startSecs"
                @input="onStartInput"
              />
              <input
                class="trim-range-input trim-range-input--bottom"
                type="range"
                min="0"
                :max="totalDuration"
                step="0.1"
                :value="endSecs"
                @input="onEndInput"
              />
            </div>

            <div class="mt-3 flex items-center justify-between text-[11px] font-medium">
              <span class="text-gray-500 dark:text-white/50">起点 {{ fmtSecs(startSecs) }}</span>
              <span class="rounded-md bg-[#EC4141]/10 px-2 py-0.5 text-[#EC4141]">
                将截取 {{ fmtSecs(selectedSecs) }}
              </span>
              <span class="text-gray-500 dark:text-white/50">终点 {{ fmtSecs(endSecs) }}</span>
            </div>
          </div>
        </section>

        <!-- 3. 输出目录 -->
        <section class="toolbox-item p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">③ 输出目录</div>
            <button type="button" class="toolbox-ghost-btn" @click="pickOutputDir">选择目录</button>
          </div>
          <div class="mt-2 min-w-0 break-all text-[12px] text-gray-500 dark:text-white/45">
            {{ outputDir || '未选择（默认输出到原文件所在目录，文件名追加 _trim）' }}
          </div>
        </section>

        <div class="flex items-center gap-3">
          <button
            type="button"
            class="rounded-xl bg-[#EC4141] px-8 py-2.5 text-sm font-medium text-white shadow-[0_12px_24px_-12px_rgba(236,65,65,0.6)] transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="!canTrim || trimming"
            @click="startTrim"
          >
            {{ trimming ? '裁剪中...' : '开始裁剪' }}
          </button>
          <button type="button" class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-white/70" @click="resetAll">清空</button>
        </div>
      </div>

      <!-- 右侧：实时日志 + 结果 -->
      <aside class="xl:sticky xl:top-0 xl:self-start space-y-6">
        <section class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="toolbox-section-title"><span class="toolbox-section-bar"></span>实时日志</h2>
            <button
              v-if="logs.length"
              type="button"
              class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-white/70"
              @click="logs = []"
            >清空</button>
          </div>
          <div
            ref="logsContainer"
            class="toolbox-panel toolbox-log min-h-[120px] space-y-0.5 bg-black/5 p-3 font-mono text-[11px] leading-[1.6] dark:bg-white/5"
          >
            <div v-if="!logs.length" class="py-2 text-gray-400/80 dark:text-white/30">
              {{ trimming ? '正在连接 ffmpeg 输出...' : '裁剪时这里会实时显示 ffmpeg 日志（精简）。' }}
            </div>
            <div v-for="(l, i) in logs" :key="i" class="break-all">
              <span :class="l.kind === 'error' ? 'text-red-500 dark:text-red-400' : 'text-emerald-500/90 dark:text-emerald-300/90'">{{ l.text }}</span>
            </div>
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="toolbox-section-title"><span class="toolbox-section-bar"></span>裁剪结果</h2>

          <div v-if="error" class="toolbox-panel border border-red-200/70 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {{ error }}
          </div>

          <div v-else-if="trimming" class="toolbox-panel toolbox-panel--muted flex items-center justify-center gap-3 text-sm text-gray-500 dark:text-white/45">
            <svg class="h-5 w-5 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>正在裁剪...</span>
          </div>

          <div v-else-if="!result" class="toolbox-panel toolbox-panel--muted text-sm text-gray-500 dark:text-white/45">
            完成后这里会显示裁剪输出文件。
          </div>

          <div v-else class="toolbox-list">
            <div class="toolbox-list-row items-start">
              <span
                class="mt-0.5 shrink-0 text-base leading-none"
                :class="result.success ? 'text-emerald-500' : 'text-red-500'"
              >{{ result.success ? '✓' : '✕' }}</span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-gray-800 dark:text-white/85">{{ getPathLeaf(result.input_path) }}</div>
                <div v-if="result.output_path" class="truncate text-[11px] text-gray-400 dark:text-white/35">{{ getPathLeaf(result.output_path) }}</div>
                <div v-if="!result.success && result.error" class="mt-1 break-words text-[12px] leading-5 text-red-500 dark:text-red-400">{{ result.error }}</div>
              </div>
            </div>

            <!-- 成品试听 -->
            <audio
              v-if="resultAudioUrl"
              :src="resultAudioUrl"
              controls
              preload="none"
              class="mt-2 w-full"
            ></audio>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.toolbox-panel {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
}
.toolbox-panel--muted {
  padding: 20px 24px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
}
.toolbox-item {
  padding: 14px 16px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
  transition: background 0.2s, border-color 0.2s;
}
.toolbox-ghost-btn {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: #ec4141;
  font-size: 0.75rem;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  transition: background 160ms ease;
}
.toolbox-ghost-btn:hover {
  background: #d13b3b;
}
.trim-preview-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 9999px;
  border: 1px solid rgba(236, 65, 65, 0.5);
  background: rgba(236, 65, 65, 0.1);
  font-size: 0.75rem;
  font-weight: 600;
  color: #ec4141;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}
.trim-preview-btn:hover {
  background: #ec4141;
  color: #fff;
}
.toolbox-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 700;
  color: #1f2937;
}
:root.dark .toolbox-section-title {
  color: #e5e7eb;
}
.toolbox-section-bar {
  display: inline-block;
  width: 4px;
  height: 16px;
  border-radius: 9999px;
  background: #ec4141;
}
.toolbox-list {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
  overflow: hidden;
}
.toolbox-list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(229, 231, 235, 0.2);
}
.toolbox-list-row:last-child {
  border-bottom: none;
}

/* ---------- 双头滑块 ---------- */
.trim-range {
  position: relative;
  height: 32px;
  user-select: none;
}
.trim-range-track {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  border-radius: 9999px;
  background: rgba(120, 120, 130, 0.25);
}
.trim-range-selection {
  position: absolute;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  border-radius: 9999px;
  background: #ec4141;
}
.trim-range-input {
  -webkit-appearance: none;
  appearance: none;
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 100%;
  height: 32px;
  margin: 0;
  background: transparent;
  pointer-events: none;
}
.trim-range-input--top {
  z-index: 3;
}
.trim-range-input--bottom {
  z-index: 2;
}
.trim-range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  pointer-events: auto;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ec4141;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  cursor: grab;
}
.trim-range-input::-webkit-slider-thumb:active {
  cursor: grabbing;
}
.trim-range-input::-moz-range-thumb {
  pointer-events: auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ec4141;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  cursor: grab;
}
.trim-range-input::-webkit-slider-runnable-track {
  background: transparent;
  border: none;
}
.trim-range-input::-moz-range-track {
  background: transparent;
  border: none;
}
</style>

<style>
html.dark .toolbox-panel,
html.dark .toolbox-panel--muted {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}
html.dark .toolbox-item {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}
html.dark .toolbox-list {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}
html.dark .toolbox-list-row {
  border-bottom-color: rgba(255, 255, 255, 0.04);
}
</style>