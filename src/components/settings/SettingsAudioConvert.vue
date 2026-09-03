<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '../../composables/toast';
import { audioConvertApi, type ConvertAudioResult, type FfmpegDetection } from '../../services/tauri/audioConvertApi';

const toast = useToast();

/** 支持的目标格式列表（与后端 audio_convert.rs 白名单一致） */
const TARGET_FORMATS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'aac', label: 'AAC' },
  { value: 'm4a', label: 'M4A' },
  { value: 'alac', label: 'ALAC' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' },
  { value: 'ogg', label: 'OGG' },
  { value: 'opus', label: 'Opus' },
  { value: 'wma', label: 'WMA' },
  { value: 'aiff', label: 'AIFF' },
  { value: 'ape', label: 'APE' },
];

const AUDIO_EXTENSIONS = ['mp3','aac','m4a','wav','flac','ogg','oga','opus','wma','aiff','aif','ape','alac','mp4','m4b'];

const FFMPEG_PATH_KEY = 'toolbox_ffmpeg_path';

const ffmpeg = ref<FfmpegDetection | null>(null);
const checking = ref(true);
/** 手动指定的 ffmpeg.exe 路径（持久化，优先于 PATH） */
const ffmpegPath = ref<string>(localStorage.getItem(FFMPEG_PATH_KEY) || '');

const inputs = ref<string[]>([]);
const outputDir = ref('');
const targetFormat = ref('mp3');
/** 输出文件名模板；空=原文件名；支持 {title}(原名) 与 {ext}(新扩展名) */
const outName = ref('');
/** 采样率（Hz）；0 表示保留原采样率 */
const sampleRate = ref(0);
const converting = ref(false);
const results = ref<ConvertAudioResult[] | null>(null);
const error = ref('');

const SAMPLE_RATES = [
  { value: 0, label: '保留原采样率' },
  { value: 22050, label: '22050 Hz' },
  { value: 32000, label: '32000 Hz' },
  { value: 44100, label: '44100 Hz' },
  { value: 48000, label: '48000 Hz' },
  { value: 96000, label: '96000 Hz' },
  { value: 192000, label: '192000 Hz' },
];

/** 实时 ffmpeg 日志（精简） */
interface ConvertLogEntry {
  file: string;
  text: string;
  kind: 'info' | 'error';
}
const logs = ref<ConvertLogEntry[]>([]);
const logsContainer = ref<HTMLElement | null>(null);

function pushLog(file: string, line: string) {
  const text = line.trim();
  if (!text) return;
  const kind: ConvertLogEntry['kind'] = /error|invalid|failed|unable|cannot|not found|denied|exception/i.test(text)
    ? 'error'
    : 'info';
  logs.value.push({ file, text, kind });
  if (logs.value.length > 300) logs.value.splice(0, logs.value.length - 300);
  nextTick(() => {
    if (logsContainer.value) logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
  });
}

let unlistenLog: (() => void) | null = null;

const getPathLeaf = (path: string) => {
  const segs = path.split(/[\\/]/).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : path;
};

const canConvert = computed(
  () => Boolean(ffmpeg.value?.available && inputs.value.length && outputDir.value),
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

/** 手动选择 ffmpeg.exe，绕过 PATH 依赖 */
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

/** 清除手动路径，回退到 PATH 检测 */
const clearFfmpegPath = async () => {
  ffmpegPath.value = '';
  localStorage.removeItem(FFMPEG_PATH_KEY);
  await checkFfmpeg();
};

onMounted(async () => {
  await checkFfmpeg();
  unlistenLog = await listen<{ inputPath: string; line: string }>('toolbox-convert-log', (e) => {
    const { inputPath, line } = e.payload;
    if (!converting.value) return;
    pushLog(getPathLeaf(inputPath), line);
  });
});

onUnmounted(() => {
  unlistenLog?.();
});

const openFfmpegSite = () => {
  openUrl('https://ffmpeg.org/download.html').catch(() => {});
};

const pickInputs = async () => {
  try {
    const selected = await open({
      multiple: true,
      title: '选择要转换的音频文件',
      filters: [{ name: '音频文件', extensions: AUDIO_EXTENSIONS }],
    });
    if (selected) {
      inputs.value = Array.isArray(selected) ? selected : [selected];
      results.value = null;
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
      title: '选择转换输出目录',
    });
    if (selected && typeof selected === 'string') {
      outputDir.value = selected;
    }
  } catch (e: any) {
    toast.showToast(`选择目录失败: ${e?.message || e}`, 'error');
  }
};

const startConvert = async () => {
  if (!canConvert.value) {
    toast.showToast('请先选择输入文件、目标格式与输出目录', 'error');
    return;
  }
  converting.value = true;
  error.value = '';
  results.value = null;
  logs.value = [];
  try {
    const res = await audioConvertApi.convertAudio(
      inputs.value,
      outputDir.value,
      targetFormat.value,
      {
        ffmpegPath: ffmpegPath.value || undefined,
        outName: outName.value.trim() || undefined,
        sampleRate: sampleRate.value > 0 ? sampleRate.value : undefined,
      },
    );
    results.value = res;
    const ok = res.filter((r) => r.success).length;
    const failed = res.length - ok;
    toast.showToast(
      ok === res.length ? `转换完成：成功 ${ok} 个` : `转换完成：成功 ${ok} 个，失败 ${failed} 个`,
      ok === res.length ? 'success' : 'error',
    );
  } catch (e: any) {
    error.value = String(e?.message || e);
    toast.showToast(`转换失败: ${error.value}`, 'error');
  } finally {
    converting.value = false;
  }
};

const resetAll = () => {
  inputs.value = [];
  outputDir.value = '';
  results.value = null;
  error.value = '';
};
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
            文件转换依赖系统安装的 <strong>ffmpeg</strong>。你需要在电脑上安装它，并确保它可被命令行直接调用（通常在安装时勾选「加入 PATH」）。
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

    <!-- 已就绪：转换界面 -->
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

        <!-- 1. 选择输入文件 -->
        <section class="toolbox-item p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">① 选择音频文件</div>
            <button type="button" class="toolbox-ghost-btn" @click="pickInputs">选择文件</button>
          </div>
          <div v-if="inputs.length" class="mt-3 flex flex-wrap gap-2">
            <span v-for="p in inputs" :key="p" class="rounded-md bg-black/5 px-2 py-1 text-[12px] text-gray-600 dark:bg-white/10 dark:text-gray-200">
              {{ getPathLeaf(p) }}
            </span>
          </div>
          <div v-else class="mt-3 border border-dashed border-gray-300/60 px-3 py-4 text-center text-[12px] text-gray-400 dark:border-white/15 dark:text-white/40">
            支持 mp3 / flac / wav / ogg / m4a / opus 等，可多选
          </div>
        </section>

        <!-- 2. 选择目标格式 -->
        <section class="toolbox-item p-4">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">② 目标格式与采样率</div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="f in TARGET_FORMATS"
              :key="f.value"
              type="button"
              class="rounded-md px-3 py-1.5 text-[12px] font-medium transition"
              :class="targetFormat === f.value
                ? 'bg-[#EC4141] text-white'
                : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15'"
              @click="targetFormat = f.value"
            >
              {{ f.label }}
            </button>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-gray-500 dark:text-white/55">
            <span>采样率：</span>
            <button
              v-for="s in SAMPLE_RATES"
              :key="s.value"
              type="button"
              class="rounded-md px-2.5 py-1 text-[12px] font-medium transition"
              :class="sampleRate === s.value
                ? 'bg-[#EC4141] text-white'
                : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15'"
              @click="sampleRate = s.value"
            >
              {{ s.label }}
            </button>
          </div>
        </section>

        <!-- 3. 输出目录与文件名 -->
        <section class="toolbox-item p-4">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">③ 输出目录与文件名</div>
          <div class="mt-3 flex items-center justify-between gap-3">
            <div class="min-w-0 break-all text-[12px] text-gray-500 dark:text-white/45">
              {{ outputDir || '未选择输出目录' }}
            </div>
            <button type="button" class="toolbox-ghost-btn" @click="pickOutputDir">选择目录</button>
          </div>
          <div class="mt-3">
            <input
              v-model="outName"
              type="text"
              spellcheck="false"
              placeholder="输出文件名（留空用原名；支持 {title}、{ext}）"
              class="w-full rounded-lg border border-gray-300/60 bg-black/5 px-3 py-2 text-[12px] text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/60 dark:border-white/15 dark:bg-white/5 dark:text-gray-200 dark:placeholder:text-white/30"
            />
          </div>
        </section>

        <div class="flex items-center gap-3">
          <button
            type="button"
            class="rounded-xl bg-[#EC4141] px-8 py-2.5 text-sm font-medium text-white shadow-[0_12px_24px_-12px_rgba(236,65,65,0.6)] transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="!canConvert || converting"
            @click="startConvert"
          >
            {{ converting ? '转换中...' : `开始转换 → ${TARGET_FORMATS.find(f => f.value === targetFormat)?.label}` }}
          </button>
          <button type="button" class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-white/70" @click="resetAll">清空</button>
        </div>
      </div>

      <!-- 右侧：实时日志 + 结果 -->
      <aside class="xl:sticky xl:top-0 xl:self-start">
        <section class="space-y-3">
          <!-- 实时 ffmpeg 日志 -->
          <div>
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
              class="toolbox-panel toolbox-log mb-5 min-h-[120px] space-y-0.5 p-3 font-mono text-[11px] leading-[1.6]"
            >
              <div v-if="!logs.length" class="py-2 text-gray-400/80 dark:text-white/30">
                {{ converting ? '正在连接 ffmpeg 输出...' : '转换时这里会实时显示 ffmpeg 日志（精简）。' }}
              </div>
              <div v-for="(l, i) in logs" :key="i" class="flex gap-2">
                <span class="shrink-0 text-gray-400/70 dark:text-white/25">{{ l.file }}</span>
                <span :class="l.kind === 'error' ? 'text-red-500 dark:text-red-400' : 'text-emerald-500/90 dark:text-emerald-300/90'">{{ l.text }}</span>
              </div>
            </div>
          </div>
          </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="toolbox-section-title"><span class="toolbox-section-bar"></span>转换结果</h2>
            <span v-if="results" class="toolbox-chip">{{ results.filter(r => r.success).length }}/{{ results.length }} 成功</span>
          </div>

          <div v-if="error" class="toolbox-panel border border-red-200/70 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {{ error }}
          </div>

          <div v-else-if="converting" class="toolbox-panel toolbox-panel--muted flex items-center justify-center gap-3 text-sm text-gray-500 dark:text-white/45">
            <svg class="h-5 w-5 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>正在转换 {{ inputs.length }} 个文件...</span>
          </div>

          <div v-else-if="!results || results.length === 0" class="toolbox-panel toolbox-panel--muted text-sm text-gray-500 dark:text-white/45">
            转换完成后，这里会显示每个文件的转换状态。
          </div>

          <div v-else class="toolbox-list">
            <div class="max-h-[480px] space-y-0 overflow-y-auto">
              <div v-for="(r, idx) in results" :key="idx" class="toolbox-list-row items-start">
                <span
                  class="mt-0.5 shrink-0 text-base leading-none"
                  :class="r.success ? 'text-emerald-500' : 'text-red-500'"
                >{{ r.success ? '✓' : '✕' }}</span>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium text-gray-800 dark:text-white/85">{{ getPathLeaf(r.input_path) }}</div>
                  <div v-if="r.output_path" class="truncate text-[11px] text-gray-400 dark:text-white/35">{{ getPathLeaf(r.output_path) }}</div>
                  <div v-if="!r.success && r.error" class="mt-1 break-words text-[12px] leading-5 text-red-500 dark:text-red-400">{{ r.error }}</div>
                </div>
              </div>
            </div>
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
.toolbox-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  color: #9ca3af;
  border: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(243, 244, 246, 0.6);
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
html.dark .toolbox-chip {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}
html.dark .toolbox-list {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}
html.dark .toolbox-list-row {
  border-bottom-color: rgba(255, 255, 255, 0.04);
}
</style>