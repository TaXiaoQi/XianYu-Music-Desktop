<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FileText, RefreshCw, Trash2, X } from 'lucide-vue-next';

import { useDeveloperMode } from '../../features/settings/developerMode';
import { useOnboarding } from '../../composables/useOnboarding';
import { useSettings } from '../../features/settings/useSettings';
import { useToast } from '../../composables/toast';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import LogExportActions from './LogExportActions.vue';
import {
  analyzeApplicationLogs,
  LOG_LEVELS,
  useApplicationLogs,
  type ApplicationLogAnalysis,
} from '../../services/applicationLogger';
import type { LogLevel, LogSettings } from '../../types';

type LogFilter = 'all' | LogLevel;

const levelLabels: Record<LogLevel, string> = {
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误',
};

const levelBadgeClass: Record<LogLevel, string> = {
  debug: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  error: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

const filterOptions: LogFilter[] = ['all', ...LOG_LEVELS];
const selectedFilter = ref<LogFilter>('all');
const showLogViewer = ref(false);
const showClearConfirmation = ref(false);

const { disableDeveloperMode } = useDeveloperMode();
const { triggerOnboarding } = useOnboarding();
const { settings, patchSettings } = useSettings();
const { showToast } = useToast();
const { entries, clearLogs } = useApplicationLogs();

// 延迟到 mount 后执行分析，避免阻塞页面首次渲染导致卡死
const defaultAnalysis: ApplicationLogAnalysis = {
  status: 'healthy',
  headline: '正在分析日志…',
  counts: { debug: 0, info: 0, warn: 0, error: 0 },
  total: 0,
  findings: [],
  topErrorCategory: null,
  latestErrorAt: null,
};
const analysis = ref<ApplicationLogAnalysis>(defaultAnalysis);
const loggingSettings = computed(() => settings.value.logging);
const entryCount = computed(() => entries.value.length);
// 直接从 analysis 派生 counts，避免每次 entries 变化都重新执行 analyzeApplicationLogs
const counts = computed(() => analysis.value.counts);
const filteredEntries = computed(() => entries.value
  .filter(entry => selectedFilter.value === 'all' || entry.level === selectedFilter.value)
  .slice()
  .reverse()
  .slice(0, 300));

const analysisToneClass = computed(() => {
  if (analysis.value.status === 'critical') {
    return 'border-rose-500/20 bg-rose-500/[0.06] text-rose-700 dark:text-rose-300';
  }
  if (analysis.value.status === 'warning') {
    return 'border-amber-500/20 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300';
  }
  return 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300';
});

const updateLoggingSettings = (patch: Partial<LogSettings>) => {
  patchSettings({ logging: patch });
};

const refreshAnalysis = () => {
  analysis.value = analyzeApplicationLogs(entries.value);
};

const openLogViewer = (filter: LogFilter = 'all') => {
  selectedFilter.value = filter;
  showLogViewer.value = true;
};

// 使用防抖避免日志快速写入时频繁触发分析（防止渲染→日志→分析→渲染反馈循环导致卡死）
let analysisDebounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  entryCount,
  () => {
    if (!loggingSettings.value.autoAnalyze) return;
    if (analysisDebounceTimer) clearTimeout(analysisDebounceTimer);
    analysisDebounceTimer = setTimeout(refreshAnalysis, 800);
  },
  { flush: 'post' },
);

watch(
  () => loggingSettings.value.autoAnalyze,
  enabled => {
    if (enabled) refreshAnalysis();
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  if (analysisDebounceTimer) clearTimeout(analysisDebounceTimer);
});

// 延迟到 mount + nextTick 后执行首次分析，避免阻塞页面首次渲染
onMounted(() => {
  nextTick(() => {
    analysis.value = analyzeApplicationLogs(entries.value);
  });
});

const formatLogTime = (timestamp: number) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(new Date(timestamp));

const handleClearLogs = () => {
  clearLogs();
  showClearConfirmation.value = false;
  refreshAnalysis();
  showToast('日志已清空', 'success');
};
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">调试</h2>
    </div>

    <section class="overflow-hidden rounded-xl border border-black/10 bg-white/35 dark:border-white/10 dark:bg-white/[0.03]">
      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">开发者模式</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-[#EC4141] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#d83b3b] active:scale-95"
          @click="disableDeveloperMode"
        >
          退出开发者模式
        </button>
      </div>

      <div class="border-t border-black/5 dark:border-white/5"></div>

      <div class="flex items-center justify-between gap-6 px-5 py-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">播放初始化动画</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-black/10 bg-white/60 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-white active:scale-95 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
          @click="triggerOnboarding"
        >
          播放
        </button>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">功能日志</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-white/45">日志仅保存在本机，敏感字段会在记录前自动脱敏。</p>
        </div>
        <button
          type="button"
          :disabled="entries.length === 0"
          class="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-xs text-gray-600 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
          @click="showClearConfirmation = true"
        >
          <Trash2 class="h-3.5 w-3.5" />
          清空日志
        </button>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <label class="rounded-xl border border-black/10 bg-white/40 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <span class="text-xs text-gray-500 dark:text-white/45">最低记录级别</span>
          <select
            :value="loggingSettings.minimumLevel"
            class="mt-2 h-9 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-sm text-gray-800 outline-none dark:border-white/10 dark:bg-black/20 dark:text-gray-100"
            @change="updateLoggingSettings({ minimumLevel: ($event.target as HTMLSelectElement).value as LogLevel })"
          >
            <option v-for="level in LOG_LEVELS" :key="level" :value="level">{{ levelLabels[level] }}</option>
          </select>
        </label>

        <div class="flex items-center justify-between rounded-xl border border-black/10 bg-white/40 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div>
            <div class="text-xs text-gray-500 dark:text-white/45">自动分析</div>
            <div class="mt-1 text-sm text-gray-800 dark:text-gray-200">日志变化时自动诊断</div>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="loggingSettings.autoAnalyze"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
            :class="loggingSettings.autoAnalyze ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="updateLoggingSettings({ autoAnalyze: !loggingSettings.autoAnalyze })"
          >
            <span
              class="h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
              :class="loggingSettings.autoAnalyze ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">自动分析</h3>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-xs text-gray-600 transition hover:bg-black/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
          @click="refreshAnalysis"
        >
          <RefreshCw class="h-3.5 w-3.5" />
          立即分析
        </button>
      </div>

      <div class="rounded-xl border p-4" :class="analysisToneClass">
        <div class="text-sm font-semibold">{{ analysis.headline }}</div>
        <ul class="mt-2 space-y-1 text-xs opacity-80">
          <li v-for="finding in analysis.findings" :key="finding">{{ finding }}</li>
        </ul>
      </div>

      <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
        <button
          v-for="level in LOG_LEVELS"
          :key="level"
          type="button"
          class="rounded-xl border border-black/10 bg-white/40 p-3 text-left transition hover:bg-white/70 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
          @click="openLogViewer(level)"
        >
          <div class="text-[11px] uppercase tracking-wider text-gray-500 dark:text-white/40">{{ levelLabels[level] }}</div>
          <div class="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{{ counts[level] }}</div>
        </button>
      </div>
    </section>

    <button
      type="button"
      class="group flex w-full items-center justify-between rounded-xl border border-black/10 bg-white/40 px-5 py-4 text-left transition hover:border-[#EC4141]/30 hover:bg-white/70 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-[#EC4141]/40 dark:hover:bg-white/[0.06]"
      @click="openLogViewer()"
    >
      <span class="flex items-center gap-3">
        <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-black/5 text-gray-600 transition group-hover:bg-[#EC4141]/10 group-hover:text-[#EC4141] dark:bg-white/5 dark:text-gray-300">
          <FileText class="h-4.5 w-4.5" />
        </span>
        <span>
          <span class="block text-sm font-medium text-gray-900 dark:text-gray-100">查看日志</span>
          <span class="mt-0.5 block text-xs text-gray-500 dark:text-white/40">共 {{ entryCount }} 条本地日志</span>
        </span>
      </span>
      <span class="text-sm text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-[#EC4141]">查看</span>
    </button>

    <LogExportActions />

    <ConfirmModal
      :visible="showClearConfirmation"
      title="确认清空全部日志"
      content="此操作会永久清空当前设备上保存的全部应用日志，且无法恢复。确定继续吗？"
      @confirm="handleClearLogs"
      @cancel="showClearConfirmation = false"
    />

  </div>

  <Teleport to="body">
    <div
      v-if="showLogViewer"
      class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm sm:p-6"
      @click.self="showLogViewer = false"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="应用日志"
        class="flex h-[min(86vh,820px)] w-[min(96vw,1180px)] min-h-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-[#f7f7f8] shadow-2xl dark:border-white/10 dark:bg-[#171719]"
      >
        <header class="flex shrink-0 items-center justify-between gap-4 border-b border-black/10 px-5 py-4 dark:border-white/10">
          <div>
            <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">应用日志</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-white/40">今日共 {{ entryCount }} 条，列表最多展示最新 300 条</p>
          </div>
          <button
            type="button"
            aria-label="关闭日志窗口"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-black/5 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
            @click="showLogViewer = false"
          >
            <X class="h-4.5 w-4.5" />
          </button>
        </header>

        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3 dark:border-white/5">
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="filter in filterOptions"
              :key="filter"
              type="button"
              class="rounded-full px-3 py-1.5 text-xs transition"
              :class="selectedFilter === filter
                ? 'bg-[#EC4141] text-white'
                : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10'"
              @click="selectedFilter = filter"
            >
              {{ filter === 'all' ? '全部' : levelLabels[filter] }}
              <span class="ml-1 opacity-70">{{ filter === 'all' ? entryCount : counts[filter] }}</span>
            </button>
          </div>
        </div>

        <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-black/[0.02] dark:bg-black/15">
          <div v-if="filteredEntries.length === 0" class="flex h-full min-h-48 items-center justify-center px-5 text-sm text-gray-400 dark:text-white/35">
            暂无符合条件的日志
          </div>
          <template v-else>
            <div
              v-for="entry in filteredEntries"
              :key="entry.id"
              class="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-3 border-b border-black/5 px-5 py-3 last:border-b-0 dark:border-white/5"
            >
              <span class="whitespace-nowrap text-[11px] tabular-nums text-gray-400 dark:text-white/35">{{ formatLogTime(entry.timestamp) }}</span>
              <span class="h-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" :class="levelBadgeClass[entry.level]">
                {{ entry.level }}
              </span>
              <div class="min-w-0">
                <div class="text-[11px] font-medium text-gray-500 dark:text-white/45">{{ entry.scope }} / {{ entry.category }}</div>
                <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-gray-700 dark:text-gray-200">{{ entry.message }}</pre>
              </div>
            </div>
          </template>
        </div>
      </section>
    </div>
  </Teleport>
</template>
