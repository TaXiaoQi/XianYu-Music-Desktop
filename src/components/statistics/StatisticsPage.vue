<script setup lang="ts">
/**
 * 首页「统计」页：卡片化个人听歌数据看板。
 * 自上而下：时间范围切换 → 概览卡 → 近 7 天趋势 → 24 小时分布 → Top 榜 → 曲库构成。
 * 排行榜已拆到独立的 LeaderboardPage，本页只关心个人听歌数据。
 */
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useStatisticsStore, type TimeRangeType } from '../../features/statistics/store';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { useI18n, type I18nKey } from '../../features/i18n';
import { getListenStatsDisplay } from '../../services/domain/leaderboardService';
import { normalizePath } from '../../utils/path';
import StatsTrendChart from './StatsTrendChart.vue';
import StatsHourChart from './StatsHourChart.vue';
import StatsTopBars from './StatsTopBars.vue';
import StatsCompositionRing from './StatsCompositionRing.vue';
import { recentDayOfMonth } from './statsCharts';

const { t, isEnglish } = useI18n();

// 与设置页一致的卡片样式
const CARD_CLASS = 'rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10';
const ACCENT = '#EC4141';
const HIRES_COLOR = '#F0A020';
const OTHER_COLOR = '#9CA3AF';

const RANGES: { value: TimeRangeType; key: I18nKey }[] = [
  { value: 'All', key: 'stats.rangeAll' },
  { value: 'Days7', key: 'stats.rangeDays7' },
  { value: 'Days30', key: 'stats.rangeDays30' },
  { value: 'ThisYear', key: 'stats.rangeThisYear' },
];

const listenDisplay = ref<{ daily: number; weekly: number; total: number }>({ daily: 0, weekly: 0, total: 0 });
const refreshListenDisplay = async () => {
  try {
    listenDisplay.value = await getListenStatsDisplay();
  } catch {
    // 获取失败时保留旧值，不影响页面展示
  }
};

function formatStatisticsDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return isEnglish.value ? '0 min' : '0分钟';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (isEnglish.value) return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
  return hours > 0 ? `${hours}小时 ${minutes}分钟` : `${minutes}分钟`;
}

const statisticsStore = useStatisticsStore();
const {
  stats,
  behaviorStats,
  loading,
  error,
} = storeToRefs(statisticsStore);

const { canonicalSongs } = useLibraryBrowse();

// 时间范围：页面挂载时重置为「全部」，且不持久化
const selectedRange = ref<TimeRangeType>('All');
const rangeLoading = ref(false);
let rangeRequestId = 0;

// 切换范围只刷新听歌数据；用请求号防止快速切换时的竞态把 loading 状态改乱
async function selectRange(range: TimeRangeType) {
  if (range === selectedRange.value) return;
  selectedRange.value = range;
  const requestId = ++rangeRequestId;
  rangeLoading.value = true;
  try {
    await statisticsStore.refreshBehaviorOnly(range);
  } catch {
    // 错误已写入 store.error，页面统一展示
  } finally {
    if (requestId === rangeRequestId) {
      rangeLoading.value = false;
    }
  }
}

let statsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let statsFirstActivation = true;

const refreshCurrentRange = async () => {
  await statisticsStore.refreshBehaviorOnly(selectedRange.value);
  await refreshListenDisplay();
};

const startStatsTimer = () => {
  if (statsRefreshTimer) return;
  statsRefreshTimer = setInterval(async () => {
    try {
      await refreshCurrentRange();
    } catch {
      // 刷新失败静默处理，不影响用户使用
    }
  }, 60_000);
};

const stopStatsTimer = () => {
  if (statsRefreshTimer) {
    clearInterval(statsRefreshTimer);
    statsRefreshTimer = null;
  }
};

onMounted(async () => {
  statisticsStore.cancelHeavyDataRelease();
  selectedRange.value = 'All';
  await statisticsStore.refreshBehaviorOnly('All');
  if (!statisticsStore.stats) {
    await statisticsStore.ensureLoaded('All');
  }
  void refreshListenDisplay();

  startStatsTimer();
});

onActivated(() => {
  if (statsFirstActivation) {
    statsFirstActivation = false;
    return;
  }
  startStatsTimer();
  void (async () => {
    try {
      await refreshCurrentRange();
    } catch {
      // 刷新失败静默处理
    }
  })();
});

onDeactivated(() => {
  stopStatsTimer();
});

onUnmounted(() => {
  statisticsStore.scheduleHeavyDataRelease();
  stopStatsTimer();
});

async function handleRefresh() {
  try {
    await statisticsStore.refreshAll(selectedRange.value);
  } catch {
    // Store state already carries the error.
  }
}

// —— 概览 ——
const losslessRatio = computed(() => {
  const current = stats.value;
  if (!current || current.total_songs <= 0) return 0;
  return Math.round((current.lossless_count / current.total_songs) * 100);
});

// —— 趋势（近 7 天，单位：秒）——
const trendValues = computed(() => behaviorStats.value?.recent_activity ?? []);
const trendLabels = computed(() => recentDayOfMonth(trendValues.value.length || 7).map(String));
const trendTotal = computed(() => trendValues.value.reduce((sum, value) => (
  sum + (Number.isFinite(value) && value > 0 ? value : 0)
), 0));

// —— 时段分布（24 小时，单位：播放次数）——
const hourValues = computed(() => behaviorStats.value?.hour_distribution ?? []);

// —— Top 榜（各取前 5，条长表达占比，数值用播放次数）——
function resolveSongLabel(songPath: string): { title: string; artist: string } {
  const normalized = normalizePath(songPath);
  const song = canonicalSongs.value.find(item => normalizePath(item.path) === normalized);
  if (song) {
    return {
      title: song.title || song.name || t('stats.unknownSong'),
      artist: song.artist || t('stats.unknownArtist'),
    };
  }
  const fileName = songPath.split(/[/\\]/).pop() || t('stats.deletedSong');
  return { title: fileName, artist: t('stats.unknownArtist') };
}

const topSongs = computed(() => (behaviorStats.value?.top_songs ?? []).slice(0, 5).map(song => {
  const resolved = resolveSongLabel(song.song_path);
  return { label: resolved.title, sublabel: resolved.artist, value: song.play_count };
}));

const topArtists = computed(() => (behaviorStats.value?.top_artists ?? []).slice(0, 5).map(artist => ({
  label: artist.artist || t('stats.unknownArtist'),
  value: artist.play_count,
})));

const topAlbums = computed(() => (behaviorStats.value?.top_albums ?? []).slice(0, 5).map(album => ({
  label: album.album || '—',
  value: album.play_count,
})));

// —— 曲库构成（无损 / 高解析 / 其它）——
const compositionSegments = computed(() => {
  const current = stats.value;
  const lossless = current?.lossless_count ?? 0;
  const hires = current?.hires_count ?? 0;
  const total = current?.total_songs ?? 0;
  const other = Math.max(total - lossless - hires, 0);
  return [
    { label: t('stats.compLossless'), value: lossless, color: ACCENT },
    { label: t('stats.compHires'), value: hires, color: HIRES_COLOR },
    { label: t('stats.compOther'), value: other, color: OTHER_COLOR },
  ];
});
const compositionTotal = computed(() => stats.value?.total_songs ?? 0);
</script>

<template>
  <div class="relative h-full">
    <div class="statistics-page custom-scrollbar h-full w-full select-none overflow-y-auto">
      <div class="mx-auto max-w-6xl px-4 pt-2 pb-10 md:px-6 md:pb-12">
        <!-- 时间范围切换：常驻，数据卡片 loading 时不跟着闪烁 -->
        <div class="mb-3 flex items-center justify-between gap-3">
          <div
            class="inline-flex rounded-xl border border-gray-200/40 bg-white/20 p-0.5 dark:border-gray-800/40 dark:bg-black/10"
            role="group"
            :aria-label="t('stats.rangeLabel')"
          >
            <button
              v-for="range in RANGES"
              :key="range.value"
              type="button"
              class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              :class="range.value === selectedRange
                ? 'bg-[#EC4141] text-white'
                : 'text-gray-600 hover:text-[#EC4141] dark:text-gray-300'"
              @click="selectRange(range.value)"
            >
              {{ t(range.key) }}
            </button>
          </div>
        </div>

        <div v-if="loading && !stats" class="space-y-8">
          <div class="h-40 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div class="h-36 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
            <div class="h-36 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
          </div>
          <div class="h-40 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
          <div class="h-64 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
        </div>

        <div v-else-if="error" class="p-10 rounded-3xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p class="text-red-600 dark:text-red-400 text-xl">{{ t('stats.loadFailed') }}{{ error }}</p>
          <button @click="handleRefresh" class="mt-4 px-6 py-3 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors text-base font-medium">
            {{ t('stats.retry') }}
          </button>
        </div>

        <div
          v-else-if="stats && behaviorStats"
          class="space-y-4 transition-opacity"
          :class="rangeLoading ? 'pointer-events-none opacity-50 animate-pulse' : ''"
        >
          <!-- 概览卡 -->
          <section class="grid grid-cols-2 gap-3 md:grid-cols-4 animate-fade-in-up">
            <div :class="CARD_CLASS">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('stats.listenDuration') }}</p>
              <p class="mt-1 text-xl font-black tracking-tight text-gray-900 dark:text-white">{{ formatStatisticsDuration(listenDisplay.total) }}</p>
            </div>
            <div :class="CARD_CLASS">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('stats.playCount') }}</p>
              <p class="mt-1 text-xl font-black tracking-tight text-gray-900 dark:text-white">{{ behaviorStats.total_plays }}</p>
            </div>
            <div :class="CARD_CLASS">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('stats.todayDuration') }}</p>
              <p class="mt-1 text-xl font-black tracking-tight text-gray-900 dark:text-white">{{ formatStatisticsDuration(listenDisplay.daily) }}</p>
              <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ t('stats.weekDuration') }} · {{ formatStatisticsDuration(listenDisplay.weekly) }}</p>
            </div>
            <div :class="CARD_CLASS">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('stats.libraryScale') }}</p>
              <p class="mt-1 text-xl font-black tracking-tight text-gray-900 dark:text-white">{{ t('stats.songCount', { count: stats.total_songs }) }}</p>
              <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ t('stats.losslessRatio') }} · {{ losslessRatio }}%</p>
            </div>
          </section>

          <!-- 近 7 天趋势 -->
          <section :class="CARD_CLASS" class="animate-fade-in-up" style="animation-delay: 60ms;">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h3 class="text-sm font-bold text-gray-800 dark:text-gray-200">{{ t('stats.trendTitle') }}</h3>
              <span class="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">{{ formatStatisticsDuration(trendTotal) }}</span>
            </div>
            <StatsTrendChart
              :values="trendValues"
              :labels="trendLabels"
              :accent="ACCENT"
              :empty-hint="t('stats.trendEmpty')"
              :format-value="formatStatisticsDuration"
            />
          </section>

          <!-- 24 小时分布 -->
          <section :class="CARD_CLASS" class="animate-fade-in-up" style="animation-delay: 120ms;">
            <h3 class="mb-3 text-sm font-bold text-gray-800 dark:text-gray-200">{{ t('stats.hourTitle') }}</h3>
            <StatsHourChart :values="hourValues" />
          </section>

          <!-- Top 榜 -->
          <section class="grid grid-cols-1 gap-3 md:grid-cols-3 animate-fade-in-up" style="animation-delay: 180ms;">
            <div :class="CARD_CLASS">
              <h3 class="mb-3 text-sm font-bold text-gray-800 dark:text-gray-200">{{ t('stats.topSongs') }}</h3>
              <StatsTopBars :items="topSongs" :accent="ACCENT" :empty-hint="t('stats.topEmpty')" />
            </div>
            <div :class="CARD_CLASS">
              <h3 class="mb-3 text-sm font-bold text-gray-800 dark:text-gray-200">{{ t('stats.topArtists') }}</h3>
              <StatsTopBars :items="topArtists" :accent="ACCENT" :empty-hint="t('stats.topEmpty')" />
            </div>
            <div :class="CARD_CLASS">
              <h3 class="mb-3 text-sm font-bold text-gray-800 dark:text-gray-200">{{ t('stats.topAlbums') }}</h3>
              <StatsTopBars :items="topAlbums" :accent="ACCENT" :empty-hint="t('stats.topEmpty')" />
            </div>
          </section>

          <!-- 曲库构成 -->
          <section :class="CARD_CLASS" class="animate-fade-in-up" style="animation-delay: 240ms;">
            <h3 class="mb-3 text-sm font-bold text-gray-800 dark:text-gray-200">{{ t('stats.compositionTitle') }}</h3>
            <StatsCompositionRing :segments="compositionSegments" :total="compositionTotal" />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}
</style>

<style>
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
    filter: blur(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

.animate-fade-in-up {
  opacity: 0;
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .animate-fade-in-up {
    animation: none;
    opacity: 1;
    transform: none;
    filter: none;
  }
}
</style>
