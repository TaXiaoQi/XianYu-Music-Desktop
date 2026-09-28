<script setup lang="ts">
/**
 * 首页「统计」页：卡片化个人听歌数据看板。
 * 自上而下：时间范围切换 → 概览卡 → 近 7 天趋势 → 24 小时分布 → Top 榜 → 曲库构成。
 * 排行榜已拆到独立的 LeaderboardPage，本页只关心个人听歌数据。
 */
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { Calendar, Clock, Database, Disc3, Headphones, Music, Play, TrendingUp } from 'lucide-vue-next';

import { useStatisticsStore, type TimeRangeType } from '../../features/statistics/store';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { useI18n, type I18nKey } from '../../features/i18n';
import { useSettingsStore } from '../../features/settings/store';
import { getListenStatsDisplay } from '../../services/domain/leaderboardService';
import { normalizePath } from '../../utils/path';
import { formatFileSize } from '../../utils/format';
import StatsTrendChart from './StatsTrendChart.vue';
import StatsHourChart from './StatsHourChart.vue';
import StatsTopBars from './StatsTopBars.vue';
import StatsCompositionRing from './StatsCompositionRing.vue';
import { recentDayOfMonth } from './statsCharts';

const { t, isEnglish } = useI18n();

// 经典扁平档（useGlassSwitch=false）的文案表，逐字取自 58c03b25^（= 04cacc5c）那版统计页。
// 玻璃档仍走上面统一的 t('stats.*')；这里只为扁平档的八项指标保留原文（含英文），
// 让 v-else 分支的标记可以逐字照抄而无需另造键名。
const TEXT = computed(() => isEnglish.value ? {
  totalListenDuration: 'Total Listening Time',
  todayListenDuration: "Today's Listening Time",
  songTotalDuration: 'Library Duration',
  librarySize: 'Library Size',
  losslessRatio: 'Lossless Ratio',
  totalSongs: 'Total Songs',
  playCount: 'Plays',
  longestPlayed: 'Most Played',
  hourlyDistribution: 'Listening by Hour',
  loadFailed: 'Failed to load: ',
  retry: 'Retry',
  unknownSong: 'Unknown Song',
  unknownArtist: 'Unknown Artist',
  deletedSong: 'Deleted Song',
} : {
  totalListenDuration: '总听歌时长',
  todayListenDuration: '今日听歌时长',
  songTotalDuration: '歌曲总时长',
  librarySize: '库大小',
  losslessRatio: '无损占比',
  totalSongs: '总歌曲',
  playCount: '播放次数',
  longestPlayed: '常听歌曲',
  hourlyDistribution: '24小时播放分布',
  loadFailed: '加载失败：',
  retry: '重试',
  unknownSong: '未知歌曲',
  unknownArtist: '未知歌手',
  deletedSong: '已删除歌曲',
});

// 首页卡片有两套观感，由设置「样式」里的 useGlassSwitch 决定：
// - 玻璃（true）：参考稿的玻璃拟态卡（淡色图标方块 + 装饰角标 + hover 缩放）
// - 经典扁平（false）：改造前的统计页；下面数据块里有一整段 v-else-if 分支
//   逐字还原 58c03b25^（= 04cacc5c）的标记——八项指标两行四列，无图标方块、无卡片外壳、无图表
const HOME_CARD_CLASS = 'rounded-xl border border-white/20 bg-white/40 p-4 backdrop-blur-md transition-transform duration-300 ease-out hover:scale-[1.02] dark:bg-white/5';
const FLAT_CARD_CLASS = 'rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10';

// 读取设置里的「玻璃样式」开关；store 的 theme 是响应式 computed，切换无需重载
const settingsStore = useSettingsStore();
const isGlass = computed(() => settingsStore.theme.useGlassSwitch);

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

// —— 扁平档「常听歌曲」：取播放次数最高的一首，逐字取自 58c03b25^（= 04cacc5c）——
const longestPlayed = computed(() => {
  const top = behaviorStats.value?.top_songs?.[0];
  if (!top) {
    return null;
  }

  const normalizedPath = normalizePath(top.song_path);
  const song = canonicalSongs.value.find(item => normalizePath(item.path) === normalizedPath);

  if (song) {
    return {
      title: song.title || song.name || TEXT.value.unknownSong,
      artist: song.artist || TEXT.value.unknownArtist,
      playCount: top.play_count,
    };
  }

  const fileName = top.song_path.split(/[/\\]/).pop() || TEXT.value.deletedSong;
  return {
    title: fileName,
    artist: TEXT.value.unknownArtist,
    playCount: top.play_count,
  };
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
      <div
        class="mx-auto max-w-6xl px-4 pb-10 md:px-6 md:pb-12"
        :class="isGlass ? 'pt-2' : 'pt-[clamp(0.25rem,0.6vw,0.75rem)]'"
      >
        <!-- 时间范围切换：仅玻璃档显示（58c03b25 引入；经典扁平档逐字还原 58c03b25^ 的旧版，没有这一行）。
             区间控件常驻于玻璃档，数据卡片 loading 时不跟着闪烁。 -->
        <div v-if="isGlass" class="mb-3 flex items-center justify-between gap-3">
          <div
            class="inline-flex rounded-xl"
            :class="isGlass
              ? 'border border-white/20 bg-white/40 p-0.5 backdrop-blur-md dark:bg-white/5'
              : 'border border-gray-200/40 bg-white/20 p-0.5 dark:border-gray-800/40 dark:bg-black/10'"
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

        <!-- 玻璃模式：3110e0da 的观感（淡色图标方块 + 装饰角标 + 斜体标题 + hover 缩放） -->
        <div
          v-else-if="stats && behaviorStats && isGlass"
          class="space-y-4 transition-opacity"
          :class="rangeLoading ? 'pointer-events-none opacity-50 animate-pulse' : ''"
        >
          <!-- 概览卡（玻璃：淡色图标方块 + 右下角装饰图标；经典扁平：还原改造前的朴素卡） -->
          <section class="grid grid-cols-2 gap-3 md:grid-cols-4 animate-fade-in-up">
            <div :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS" class="group relative overflow-hidden">
              <Headphones
                v-if="isGlass"
                aria-hidden="true"
                class="pointer-events-none absolute -right-2 -bottom-2 h-14 w-14 text-blue-500 opacity-30 transition-opacity duration-300 group-hover:opacity-100 dark:text-blue-400 dark:opacity-20 dark:group-hover:opacity-50"
                stroke-width="1.5"
              />
              <div class="relative flex items-start gap-3">
                <div v-if="isGlass" class="shrink-0 rounded-lg bg-blue-500/10 p-2 text-blue-500 dark:bg-blue-500/15 dark:text-blue-400">
                  <Clock class="h-5 w-5" stroke-width="1.5" />
                </div>
                <div class="min-w-0">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('stats.listenDuration') }}</p>
                  <p class="mt-1 text-xl tracking-tight text-gray-900 dark:text-white" :class="isGlass ? 'font-bold' : 'font-black'">{{ formatStatisticsDuration(listenDisplay.total) }}</p>
                </div>
              </div>
            </div>
            <div :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS" class="group relative overflow-hidden">
              <Music
                v-if="isGlass"
                aria-hidden="true"
                class="pointer-events-none absolute -right-2 -bottom-2 h-14 w-14 text-indigo-500 opacity-30 transition-opacity duration-300 group-hover:opacity-100 dark:text-indigo-400 dark:opacity-20 dark:group-hover:opacity-50"
                stroke-width="1.5"
              />
              <div class="relative flex items-start gap-3">
                <div v-if="isGlass" class="shrink-0 rounded-lg bg-indigo-500/10 p-2 text-indigo-500 dark:bg-indigo-500/15 dark:text-indigo-400">
                  <Play class="h-5 w-5" stroke-width="1.5" />
                </div>
                <div class="min-w-0">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('stats.playCount') }}</p>
                  <p class="mt-1 text-xl tracking-tight text-gray-900 dark:text-white" :class="isGlass ? 'font-bold' : 'font-black'">{{ behaviorStats.total_plays }}</p>
                </div>
              </div>
            </div>
            <div :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS" class="group relative overflow-hidden">
              <TrendingUp
                v-if="isGlass"
                aria-hidden="true"
                class="pointer-events-none absolute -right-2 -bottom-2 h-14 w-14 text-violet-500 opacity-30 transition-opacity duration-300 group-hover:opacity-100 dark:text-violet-400 dark:opacity-20 dark:group-hover:opacity-50"
                stroke-width="1.5"
              />
              <div class="relative flex items-start gap-3">
                <div v-if="isGlass" class="shrink-0 rounded-lg bg-violet-500/10 p-2 text-violet-500 dark:bg-violet-500/15 dark:text-violet-400">
                  <Calendar class="h-5 w-5" stroke-width="1.5" />
                </div>
                <div class="min-w-0">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('stats.todayDuration') }}</p>
                  <p class="mt-1 text-xl tracking-tight text-gray-900 dark:text-white" :class="isGlass ? 'font-bold' : 'font-black'">{{ formatStatisticsDuration(listenDisplay.daily) }}</p>
                  <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ t('stats.weekDuration') }} · {{ formatStatisticsDuration(listenDisplay.weekly) }}</p>
                </div>
              </div>
            </div>
            <div :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS" class="group relative overflow-hidden">
              <Disc3
                v-if="isGlass"
                aria-hidden="true"
                class="pointer-events-none absolute -right-2 -bottom-2 h-14 w-14 text-purple-500 opacity-30 transition-opacity duration-300 group-hover:opacity-100 dark:text-purple-400 dark:opacity-20 dark:group-hover:opacity-50"
                stroke-width="1.5"
              />
              <div class="relative flex items-start gap-3">
                <div v-if="isGlass" class="shrink-0 rounded-lg bg-purple-500/10 p-2 text-purple-500 dark:bg-purple-500/15 dark:text-purple-400">
                  <Database class="h-5 w-5" stroke-width="1.5" />
                </div>
                <div class="min-w-0">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('stats.libraryScale') }}</p>
                  <p class="mt-1 text-xl tracking-tight text-gray-900 dark:text-white" :class="isGlass ? 'font-bold' : 'font-black'">{{ t('stats.songCount', { count: stats.total_songs }) }}</p>
                  <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ t('stats.losslessRatio') }} · {{ losslessRatio }}%</p>
                </div>
              </div>
            </div>
          </section>

          <!-- 近 7 天趋势（动画挂在外层，卡片自身保留 hover 缩放） -->
          <div class="animate-fade-in-up" style="animation-delay: 60ms;">
            <section :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS">
              <div class="mb-3 flex items-center justify-between gap-3">
                <h3 class="text-gray-800 dark:text-gray-200" :class="isGlass ? 'text-lg font-bold italic' : 'text-sm font-bold'">{{ t('stats.trendTitle') }}</h3>
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
          </div>

          <!-- 24 小时分布 -->
          <div class="animate-fade-in-up" style="animation-delay: 120ms;">
            <section :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS">
              <h3 class="mb-3 text-gray-800 dark:text-gray-200" :class="isGlass ? 'text-lg font-bold italic' : 'text-sm font-bold'">{{ t('stats.hourTitle') }}</h3>
              <StatsHourChart :values="hourValues" />
            </section>
          </div>

          <!-- Top 榜 -->
          <section class="grid grid-cols-1 gap-3 md:grid-cols-3 animate-fade-in-up" style="animation-delay: 180ms;">
            <div :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS">
              <h3 class="mb-3 text-gray-800 dark:text-gray-200" :class="isGlass ? 'text-lg font-bold italic' : 'text-sm font-bold'">{{ t('stats.topSongs') }}</h3>
              <StatsTopBars :items="topSongs" :accent="ACCENT" :empty-hint="t('stats.topEmpty')" />
            </div>
            <div :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS">
              <h3 class="mb-3 text-gray-800 dark:text-gray-200" :class="isGlass ? 'text-lg font-bold italic' : 'text-sm font-bold'">{{ t('stats.topArtists') }}</h3>
              <StatsTopBars :items="topArtists" :accent="ACCENT" :empty-hint="t('stats.topEmpty')" />
            </div>
            <div :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS">
              <h3 class="mb-3 text-gray-800 dark:text-gray-200" :class="isGlass ? 'text-lg font-bold italic' : 'text-sm font-bold'">{{ t('stats.topAlbums') }}</h3>
              <StatsTopBars :items="topAlbums" :accent="ACCENT" :empty-hint="t('stats.topEmpty')" />
            </div>
          </section>

          <!-- 曲库构成 -->
          <div class="animate-fade-in-up" style="animation-delay: 240ms;">
            <section :class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS">
              <h3 class="mb-3 text-gray-800 dark:text-gray-200" :class="isGlass ? 'text-lg font-bold italic' : 'text-sm font-bold'">{{ t('stats.compositionTitle') }}</h3>
              <StatsCompositionRing :segments="compositionSegments" :total="compositionTotal" />
            </section>
          </div>
        </div>

        <!-- 经典扁平模式：逐字还原 58c03b25^（= 04cacc5c）的统计页——八项指标两行四列，
             无图标方块、无卡片外壳、无图表；链上只保留最后一支 v-else-if -->
        <div
          v-else-if="stats && behaviorStats"
          class="space-y-[clamp(0.5rem,1vw,0.875rem)]"
        >
          <section class="px-[clamp(1rem,2.5vw,3rem)] pt-[clamp(0.25rem,0.5vw,0.5rem)] pb-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up">
            <div class="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1.3fr] gap-x-[clamp(0.75rem,2vw,2rem)] items-end">
              <div class="col-span-2 md:col-span-1 flex flex-col justify-end">
                <p class="text-black dark:text-white text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider mb-2">{{ TEXT.totalSongs }}</p>
                <p class="text-black dark:text-white text-[clamp(1.5rem,3.5vw,2.25rem)] font-black tracking-tight leading-none">{{ stats.total_songs }}</p>
              </div>
              <div class="flex flex-col justify-end min-w-0">
                <p class="text-black/70 dark:text-white/70 text-[clamp(0.7rem,0.9vw,0.875rem)] font-light tracking-wider mb-1">{{ TEXT.songTotalDuration }}</p>
                <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-none">{{ formatStatisticsDuration(stats.total_duration) }}</p>
              </div>
              <div class="flex flex-col justify-end min-w-0">
                <p class="text-black/70 dark:text-white/70 text-[clamp(0.7rem,0.9vw,0.875rem)] font-light tracking-wider mb-1">{{ TEXT.librarySize }}</p>
                <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-none">{{ formatFileSize(stats.total_file_size) }}</p>
              </div>
              <div class="col-span-2 md:col-span-1 flex flex-col justify-end min-w-0">
                <p class="text-black/70 dark:text-white/70 text-[clamp(0.7rem,0.9vw,0.875rem)] font-light tracking-wider mb-1">{{ TEXT.losslessRatio }}</p>
                <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-none">{{ losslessRatio }}%</p>
              </div>
            </div>
          </section>

          <section class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 100ms;">
            <div class="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1.3fr] gap-x-[clamp(0.75rem,2vw,2rem)]">
              <div class="col-span-2 md:col-span-1 min-w-0">
                <p class="text-black dark:text-white text-[clamp(0.9rem,1.25vw,1.125rem)] font-light tracking-wider mb-2">{{ TEXT.totalListenDuration }}</p>
                <p class="text-black dark:text-white text-[clamp(1.375rem,2.75vw,1.75rem)] font-black tracking-tight leading-none whitespace-nowrap">{{ formatStatisticsDuration(listenDisplay.total) }}</p>
              </div>
              <div class="hidden md:flex flex-col justify-end min-w-0" aria-hidden="false">
                <p class="text-black/70 dark:text-white/70 text-[clamp(0.7rem,0.9vw,0.875rem)] font-light tracking-wider mb-1">{{ TEXT.todayListenDuration }}</p>
                <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-none">{{ formatStatisticsDuration(listenDisplay.daily) }}</p>
              </div>
              <div class="col-span-2 md:col-span-1 min-w-0">
                <p class="text-black dark:text-white text-[clamp(0.8rem,1.1vw,1rem)] font-light tracking-wider mb-2">{{ TEXT.playCount }}</p>
                <p class="text-black dark:text-white text-[clamp(1.25rem,2.5vw,1.625rem)] font-black tracking-tight leading-none">{{ behaviorStats.total_plays }}</p>
              </div>
              <div v-if="longestPlayed" class="col-span-2 md:col-span-1 min-w-0">
                <p class="text-black dark:text-white text-[clamp(0.8rem,1.1vw,1rem)] font-light tracking-wider mb-2">{{ TEXT.longestPlayed }}</p>
                <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-tight mb-1 truncate">{{ longestPlayed.title }}</p>
                <p class="text-black/70 dark:text-white/70 text-[clamp(0.8rem,1.1vw,1rem)] font-medium truncate">{{ longestPlayed.artist }} · {{ longestPlayed.playCount }}{{ isEnglish ? ' plays' : '次' }}</p>
              </div>
            </div>
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
