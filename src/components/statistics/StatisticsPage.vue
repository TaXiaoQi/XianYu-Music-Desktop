<script setup lang="ts">
/**
 * 首页「统计」页：卡片化个人听歌数据看板。
 * 玻璃档（useGlassSwitch=true）：时间范围切换 → 概览卡 → 近 7 天趋势 → 24 小时分布 → Top 榜 → 曲库构成；
 *   排行榜走独立的 LeaderboardPage（首页「排行榜」子标签），本页不内联它。
 * 经典扁平档（useGlassSwitch=false）：八项指标 + 内联排行榜，逐字还原 04cacc5c^（排行榜拆分前）的统计页。
 */
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { Calendar, Clock, Database, Disc3, Headphones, Music, Play, TrendingUp } from 'lucide-vue-next';

import { useStatisticsStore, type TimeRangeType } from '../../features/statistics/store';
import { useAuthStore } from '../../features/auth/store';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { useI18n, type I18nKey } from '../../features/i18n';
import { useSettings } from '../../features/settings/useSettings';
import { useSettingsStore } from '../../features/settings/store';
import { openOnlineDetail } from '../../features/onlineDetail/store';
import {
  fetchAllLeaderboards,
  getListenStatsDisplay,
  type LeaderboardData,
  type LeaderboardEntry,
  type LeaderboardPeriod,
} from '../../services/domain/leaderboardService';
import { normalizePath } from '../../utils/path';
import { formatFileSize } from '../../utils/format';
import SongContextMenu from '../overlays/SongContextMenu.vue';
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
  leaderboard: 'Listening Leaderboard',
  loadFailed: 'Failed to load: ',
  retry: 'Retry',
  refresh: 'Refresh',
  noLeaderboard: 'No leaderboard data yet',
  leaderboardFailed: 'Failed to load leaderboard',
  clickToRetry: 'Click to retry',
  unknownSong: 'Unknown Song',
  unknownArtist: 'Unknown Artist',
  deletedSong: 'Deleted Song',
  you: 'You',
  loginAria: 'Go to sign in and view your ranking',
  loginTitle: 'Sign in to view your ranking',
  loginInitial: '?',
  notLoggedIn: 'Not signed in',
  viewAfterLogin: 'Sign in to view your ranking',
  goToLogin: 'Sign In',
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
  leaderboard: '听歌排行榜',
  loadFailed: '加载失败：',
  retry: '重试',
  refresh: '刷新',
  noLeaderboard: '暂无排行榜数据',
  leaderboardFailed: '排行榜加载失败',
  clickToRetry: '点击重试',
  unknownSong: '未知歌曲',
  unknownArtist: '未知歌手',
  deletedSong: '已删除歌曲',
  you: '你',
  loginAria: '前往登录页面查看个人排名',
  loginTitle: '登录后查看个人排名',
  loginInitial: '未',
  notLoggedIn: '未登录',
  viewAfterLogin: '登录后查看个人排名',
  goToLogin: '去登录',
});

// 首页卡片有两套观感，由设置「样式」里的 useGlassSwitch 决定：
// - 玻璃（true）：参考稿的玻璃拟态卡（淡色图标方块 + 装饰角标 + hover 缩放）。
//   玻璃质感分四层：类串里的 inset 顶/底高光 + 深外影 + backdrop-blur-lg/saturate-150
//   是其中两层；另两层（边缘折射渐变 + 四角光斑的 ::before、hover 掠射光泽的 ::after）
//   挂在下方 scoped 样式块的 glass-card 类上，见「玻璃档卡片质感」段。
// - 经典扁平（false）：改造前的统计页；下面数据块里有一整段 v-else-if 分支
//   逐字还原 58c03b25^（= 04cacc5c）的标记——八项指标两行四列，无图标方块、无卡片外壳、无图表
const HOME_CARD_CLASS = 'glass-card rounded-xl border border-white/30 bg-white/40 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(255,255,255,0.10),0_8px_24px_rgba(15,23,42,0.10)] backdrop-blur-lg backdrop-saturate-150 transition-transform duration-300 ease-out hover:scale-[1.02] dark:border-white/15 dark:bg-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),inset_0_-1px_0_rgba(255,255,255,0.05),0_10px_28px_rgba(0,0,0,0.35)]';
const FLAT_CARD_CLASS = 'rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10';

// 读取设置里的「玻璃样式」开关；store 的 theme 是响应式 computed，切换无需重载
const settingsStore = useSettingsStore();
const isGlass = computed(() => settingsStore.theme.useGlassSwitch);

// 两档共用：主题（排行榜显示开关 + 自定义背景）、登录态与路由——供内联排行榜（经典扁平档）使用
const { theme } = useSettings();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

// 自定义背景时，内联排行榜「我的名次」吸底行改用半透明玻璃底
const hasCustomBackground = computed(() => (
  theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)
));

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
      await loadLeaderboard(true);
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
  isLeaderboardReady.value = true;
  void loadLeaderboard();

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
      await loadLeaderboard();
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

// —— 内联排行榜（经典扁平档）——
// 逐字取自 04cacc5c^（排行榜拆成独立 tab 之前）的统计页脚本。玻璃档下排行榜走独立的
// LeaderboardPage，本页不内联它：loadLeaderboard 在玻璃档直接返回，因此下面的循环刷新、
// 激活刷新与登录/路由 watch 在玻璃档都不产生额外请求，玻璃档行为与本页改造前一致。
const leaderboard = ref<LeaderboardEntry[]>([]);
const leaderboardLoading = ref(true);
const leaderboardError = ref<string | null>(null);
const currentPeriod = ref<LeaderboardPeriod>('daily');
let leaderboardRequestId = 0;

const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetEntry = ref<LeaderboardEntry | null>(null);

function handleLeaderboardContextMenu(e: MouseEvent, item: LeaderboardEntry) {
  e.preventDefault();
  contextMenuTargetEntry.value = item;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
}

function handleViewLeaderboardUser() {
  const entry = contextMenuTargetEntry.value;
  if (!entry) return;
  openOnlineDetail({
    type: 'user',
    title: entry.nickname || entry.username,
    subtitle: `@${entry.username}`,
    coverUrl: entry.avatar || '',
    rawData: { username: entry.ciyuanxi_id || entry.username, ciyuanxi_id: entry.ciyuanxi_id },
    platformId: entry.ciyuanxi_id || entry.username,
    engineType: 'musicfree',
  });
  showContextMenu.value = false;
}

const lbTrace: string[] = [];
const lbDebug = (msg: string) => {
  try {
    lbTrace.push(`${new Date().toISOString().slice(11, 23)} ${msg}`);
    if (lbTrace.length > 40) lbTrace.shift();
    (window as any).__lbTrace = lbTrace;
  } catch { /* 诊断埋点绝不能影响业务 */ }
};
lbDebug(`init period=${currentPeriod.value} loading=${leaderboardLoading.value}`);

const leaderboardCache = new Map<LeaderboardPeriod, { list: LeaderboardEntry[]; fetchedAt: number }>();

const leaderboardSwitchKey = ref(0);

const periodLabel = computed(() => {
  switch (currentPeriod.value) {
    case 'daily': return isEnglish.value ? 'Daily listening time' : '单日听歌时长排行';
    case 'weekly': return isEnglish.value ? 'Weekly listening time' : '本周听歌时长排行';
    default: return isEnglish.value ? 'All-time listening time' : '累计听歌时长排行';
  }
});

async function loadLeaderboard(silent = false, period: LeaderboardPeriod = currentPeriod.value) {
  // 玻璃档的排行榜由独立 LeaderboardPage 加载，本页不重复请求
  if (isGlass.value) return;
  const requestId = ++leaderboardRequestId;
  lbDebug(`load req=${requestId} silent=${silent} period=${period} len=${leaderboard.value.length} loading=${leaderboardLoading.value} hasCache=${leaderboardCache.has(period)}`);
  const cached = leaderboardCache.get(period);
  if (cached && leaderboard.value.length === 0) {
    lbDebug(`show-cache req=${requestId} len=${cached.list.length}`);
    leaderboard.value = cached.list;
  }
  if (!silent && !cached) {
    lbDebug(`show-skeleton req=${requestId}`);
    leaderboard.value = [];
    leaderboardLoading.value = true;
    leaderboardError.value = null;
  }
  try {
    const all = await fetchAllLeaderboards(15);
    if (requestId !== leaderboardRequestId) return;
    const resetApplied = Boolean(all.resetApplied);
    await refreshListenDisplay();
    const results: Record<LeaderboardPeriod, LeaderboardData> = {
      daily: all.daily,
      weekly: all.weekly,
      total: all.total,
    };
    for (const p of (['daily', 'weekly', 'total'] as LeaderboardPeriod[])) {
      const data = results[p];
      const list = [...data.leaderboard];
      if (data.me && !list.some(u => u.isMe)) {
        list.push(data.me);
      }
      leaderboardCache.set(p, { list, fetchedAt: Date.now() });
    }
    leaderboard.value = leaderboardCache.get(period)?.list ?? [];
    lbDebug(`data-applied req=${requestId} period=${period} len=${leaderboard.value.length} silent=${silent} prevLen=${leaderboardDisplay.value.top.length}`);
    if (resetApplied) {
      await statisticsStore.refreshBehaviorOnly('All');
    }
    if (silent) leaderboardError.value = null;
  } catch (e) {
    if (requestId !== leaderboardRequestId) return;
    if (!silent || leaderboard.value.length === 0) {
      const msg = e instanceof Error ? e.message : String(e);
      lbDebug(`error req=${requestId} silent=${silent} msg=${msg.slice(0, 60)}`);
      leaderboardError.value = msg;
      leaderboard.value = [];
    }
  } finally {
    if (requestId === leaderboardRequestId) {
      lbDebug(`loading-off req=${requestId} len=${leaderboard.value.length}`);
      leaderboardLoading.value = false;
    }
  }
}

function switchPeriod(period: LeaderboardPeriod) {
  if (currentPeriod.value === period) return;
  lbDebug(`switch ${currentPeriod.value}->${period} len=${leaderboard.value.length}`);
  currentPeriod.value = period;
  leaderboardRequestId++;
  leaderboardSwitchKey.value++;
  const cached = leaderboardCache.get(period);
  if (cached) {
    lbDebug(`switch-cache len=${cached.list.length}`);
    leaderboard.value = cached.list;
    leaderboardLoading.value = false;
    leaderboardError.value = null;
  } else {
    void loadLeaderboard(false, period);
  }
}

const PERIOD_OPTIONS = computed<{ value: LeaderboardPeriod; label: string }[]>(() => isEnglish.value ? [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'total', label: 'All Time' },
] : [
  { value: 'daily', label: '日榜' },
  { value: 'weekly', label: '周榜' },
  { value: 'total', label: '总榜' },
]);

const leaderboardDisplay = computed(() => {
  const top15 = leaderboard.value.slice(0, 15);
  const me = leaderboard.value.find(u => u.isMe);
  return { top: top15, me };
});

function formatLeaderboardDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (isEnglish.value) {
    if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`;
    return `${m} min`;
  }
  if (h > 0) return `${h}小时${m > 0 ? `${m}分` : ''}`;
  return `${m}分钟`;
}

const isLeaderboardReady = ref(false);
const openLoginPage = () => {
  void router.push('/auth');
};

watch(() => route.path, (newPath, oldPath) => {
  if (newPath === '/' && oldPath && oldPath !== '/') {
    void loadLeaderboard();
  }
});

watch(() => authStore.isLoggedIn, (isLoggedIn, wasLoggedIn) => {
  if (isLoggedIn !== wasLoggedIn && isLeaderboardReady.value) {
    void loadLeaderboard();
  }
});

watch(() => authStore.user?.username, () => {
  if (isLeaderboardReady.value) {
    void loadLeaderboard();
  }
});

// 玻璃↔扁平运行时切换：默认档是扁平，但用户可能先停在玻璃档——切进扁平档时立即拉一次内联
// 排行榜；切回玻璃档无需处理，定时器里的 loadLeaderboard 会自行短路。
watch(isGlass, (glass) => {
  if (!glass) {
    void loadLeaderboard();
  }
});
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
              ? 'border border-white/20 bg-white/40 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-md backdrop-saturate-150 dark:bg-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]'
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
                <div v-if="isGlass" class="shrink-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] bg-blue-500/10 p-2 text-blue-500 dark:bg-blue-500/15 dark:text-blue-400">
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
                <div v-if="isGlass" class="shrink-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] bg-indigo-500/10 p-2 text-indigo-500 dark:bg-indigo-500/15 dark:text-indigo-400">
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
                <div v-if="isGlass" class="shrink-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] bg-violet-500/10 p-2 text-violet-500 dark:bg-violet-500/15 dark:text-violet-400">
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
                <div v-if="isGlass" class="shrink-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] bg-purple-500/10 p-2 text-purple-500 dark:bg-purple-500/15 dark:text-purple-400">
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

          <!-- 内联排行榜：逐字取自 04cacc5c^（排行榜拆成独立 tab 之前）的统计页。
               本段只存在于经典扁平分支，玻璃档排行榜仍是独立的 LeaderboardPage。 -->
          <section v-if="theme.showLeaderboard" class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 400ms;">
            <div class="flex items-end justify-between gap-3 flex-wrap mb-[clamp(0.5rem,1vw,0.875rem)]">
              <div>
                <p class="text-black dark:text-white text-[clamp(0.8rem,1.1vw,1rem)] font-light tracking-wider">{{ TEXT.leaderboard }}</p>
                <p class="text-black/50 dark:text-white/50 text-[clamp(0.7rem,0.9vw,0.8rem)] font-light mt-1">{{ periodLabel }}</p>
              </div>
              <div class="flex items-center gap-2">
                <div class="leaderboard-period-tabs">
                  <button
                    v-for="p in PERIOD_OPTIONS"
                    :key="p.value"
                    type="button"
                    class="leaderboard-period-tab"
                    :class="{ active: currentPeriod === p.value }"
                    :disabled="leaderboardLoading"
                    @click="switchPeriod(p.value)"
                  >
                    {{ p.label }}
                  </button>
                </div>
                <button
                  type="button"
                  class="text-[clamp(0.7rem,0.9vw,0.8rem)] text-black/60 dark:text-white/60 hover:text-[#EC4141] dark:hover:text-[#EC4141] font-medium transition cursor-pointer"
                  @click="loadLeaderboard()"
                >
                  {{ TEXT.refresh }}
                </button>
              </div>
            </div>

            <div v-if="leaderboardLoading" class="grid gap-2">
              <div
                v-for="i in 5"
                :key="i"
                class="h-12 rounded-xl bg-gray-100/60 dark:bg-white/5 animate-pulse"
              ></div>
            </div>

            <div v-else-if="leaderboardDisplay.top.length === 0 && !leaderboardError" class="py-8 text-center">
              <p class="text-black/50 dark:text-white/50 text-sm">{{ TEXT.noLeaderboard }}</p>
            </div>

            <div v-else-if="leaderboardError && leaderboardDisplay.top.length === 0" class="py-8 text-center">
              <p class="text-black/50 dark:text-white/50 text-sm">{{ TEXT.leaderboardFailed }}</p>
              <button
                type="button"
                class="mt-2 text-[clamp(0.7rem,0.9vw,0.8rem)] text-[#EC4141] font-medium transition cursor-pointer"
                @click="loadLeaderboard()"
              >
                {{ TEXT.clickToRetry }}
              </button>
            </div>

            <div v-else :key="`lb-list-${leaderboardSwitchKey}`" class="grid gap-1.5">
              <div
                v-for="(item, index) in leaderboardDisplay.top"
                :key="item.username"
                class="leaderboard-row animate-fade-in-up"
                :class="{ 'is-me': item.isMe, 'is-top-3': item.rank <= 3 }"
                :style="{ animationDelay: `${index * 60}ms` }"
                @contextmenu="handleLeaderboardContextMenu($event, item)"
              >
                <div
                  class="leaderboard-rank animate-rank-pop"
                  :class="`rank-${item.rank <= 3 ? item.rank : 'normal'}`"
                  :style="{ animationDelay: `${index * 60 + 200}ms` }"
                >
                  {{ item.rank }}
                </div>
                <div class="leaderboard-avatar">
                  <img v-if="item.avatar" :src="item.avatar" alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" />
                  <span v-else>{{ item.nickname.slice(0, 1).toUpperCase() }}</span>
                </div>
                <div class="leaderboard-info">
                  <div class="leaderboard-name text-gray-800 dark:text-white/90">
                    {{ item.nickname }}
                    <span v-if="item.isMe" class="leaderboard-tag">{{ TEXT.you }}</span>
                  </div>
                  <div class="leaderboard-username text-black/45 dark:text-white/45">@{{ item.nickname || item.username }}</div>
                </div>
                <div class="leaderboard-duration text-gray-800 dark:text-white/90">{{ formatLeaderboardDuration(item.duration) }}</div>
              </div>
            </div>

            <template v-if="!leaderboardLoading && leaderboardDisplay.me">
              <div class="leaderboard-divider text-black/30 dark:text-white/30">
                <span>···</span>
              </div>
              <div
                :key="`lb-me-${leaderboardSwitchKey}`"
                class="leaderboard-row is-me is-sticky animate-fade-in-up"
                :class="{ 'leaderboard-row--glass-on-custom-background': hasCustomBackground }"
                :style="{ animationDelay: `${leaderboardDisplay.top.length * 60 + 200}ms` }"
                @contextmenu="handleLeaderboardContextMenu($event, leaderboardDisplay.me)"
              >
                <div
                  class="leaderboard-rank animate-rank-pop"
                  :class="`rank-${leaderboardDisplay.me.rank <= 3 ? leaderboardDisplay.me.rank : 'normal'}`"
                  :style="{ animationDelay: `${leaderboardDisplay.top.length * 60 + 400}ms` }"
                >
                  {{ leaderboardDisplay.me.rank }}
                </div>
                <div class="leaderboard-avatar">
                  <img v-if="leaderboardDisplay.me.avatar" :src="leaderboardDisplay.me.avatar" alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" />
                  <span v-else>{{ leaderboardDisplay.me.nickname.slice(0, 1).toUpperCase() }}</span>
                </div>
                <div class="leaderboard-info">
                  <div class="leaderboard-name text-gray-800 dark:text-white/90">
                    {{ leaderboardDisplay.me.nickname }}
                    <span class="leaderboard-tag">{{ TEXT.you }}</span>
                  </div>
                  <div class="leaderboard-username text-black/45 dark:text-white/45">@{{ leaderboardDisplay.me.nickname || leaderboardDisplay.me.username }}</div>
                </div>
                <div class="leaderboard-duration text-gray-800 dark:text-white/90">{{ formatLeaderboardDuration(leaderboardDisplay.me.duration) }}</div>
              </div>
            </template>

            <template v-else-if="!leaderboardLoading && !authStore.isLoggedIn">
              <div class="leaderboard-divider text-black/30 dark:text-white/30">
                <span>···</span>
              </div>
              <button
                type="button"
                class="leaderboard-row leaderboard-row--login is-me is-sticky w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EC4141]/50"
                :class="{ 'leaderboard-row--glass-on-custom-background': hasCustomBackground }"
                :aria-label="TEXT.loginAria"
                :title="TEXT.loginTitle"
                @click="openLoginPage"
              >
                <div class="leaderboard-rank rank-normal">—</div>
                <div class="leaderboard-avatar">
                  <span>{{ TEXT.loginInitial }}</span>
                </div>
                <div class="leaderboard-info">
                  <div class="leaderboard-name text-gray-800 dark:text-white/90">{{ TEXT.notLoggedIn }}</div>
                  <div class="leaderboard-username text-black/45 dark:text-white/45">{{ TEXT.viewAfterLogin }}</div>
                </div>
                <div class="leaderboard-duration text-[#EC4141]">{{ TEXT.goToLogin }}</div>
              </button>
            </template>
          </section>
        </div>
      </div>
    </div>

    <SongContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="null"
      :is-playlist-view="false"
      :is-online-search="false"
      :leaderboard-entry="contextMenuTargetEntry"
      @close="showContextMenu = false"
      @view-leaderboard-user="handleViewLeaderboardUser"
    />
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

/* ==================== 玻璃档卡片质感（glass-card 伪元素自发光层） ====================
   HOME_CARD_CLASS 挂 glass-card，这里补类串装不下的两块自发光层（纯色页面底没有
   内容可供 blur 折射，光泽只能自己发光）：
   - ::before：边缘折射渐变 + 四角光斑。单一光源下不同角部折射率不同——左上最亮
     (0.35) → 右上次之 (0.20) → 右下 (0.08) / 左下 (0.05) 极弱，即「卡片边角的
     折射率变化」。border-radius 与类串 rounded-xl 同步。
   - ::after：hover 掠射光泽。高光带用 background-position 在卡片内扫过（transition，
     无循环动画）；不用 transform 位移——图表卡的 section 没有 overflow-hidden
     （d0bf8434 的教训：不给 section 补 overflow-hidden，会裁剪图表悬浮内容），
     位移会把光带扫出卡片外。prefers-reduced-motion 下整层禁用。
   深色档：高光/光斑 alpha 全线调低、光斑改冷白 (226,232,240)；外阴影加深在类串
   dark:shadow 里。可调点：各 rgba alpha、radial-gradient 的 at/尺寸百分比、
   光带 background-size/时长/alpha。 */
.glass-card {
  position: relative;
}

.glass-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.75rem; /* 与 rounded-xl 同步 */
  pointer-events: none;
  z-index: 1;
  background:
    radial-gradient(120% 90% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 55%),
    radial-gradient(100% 80% at 100% 0%, rgba(255, 255, 255, 0.20), transparent 50%),
    radial-gradient(90% 70% at 100% 100%, rgba(255, 255, 255, 0.08), transparent 45%),
    radial-gradient(90% 70% at 0% 100%, rgba(255, 255, 255, 0.05), transparent 45%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0) 38%, rgba(255, 255, 255, 0) 62%, rgba(255, 255, 255, 0.06));
}

.dark .glass-card::before {
  background:
    radial-gradient(120% 90% at 0% 0%, rgba(226, 232, 240, 0.14), transparent 55%),
    radial-gradient(100% 80% at 100% 0%, rgba(226, 232, 240, 0.08), transparent 50%),
    radial-gradient(90% 70% at 100% 100%, rgba(226, 232, 240, 0.04), transparent 45%),
    radial-gradient(90% 70% at 0% 100%, rgba(226, 232, 240, 0.03), transparent 45%),
    linear-gradient(160deg, rgba(226, 232, 240, 0.05), rgba(226, 232, 240, 0) 38%, rgba(226, 232, 240, 0) 62%, rgba(226, 232, 240, 0.03));
}

.glass-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.75rem; /* 与 rounded-xl 同步 */
  pointer-events: none;
  z-index: 1;
  background-image: linear-gradient(115deg, transparent 25%, rgba(255, 255, 255, 0.25) 50%, transparent 75%);
  background-repeat: no-repeat;
  background-size: 220% 100%;
  background-position: 0% 0;
  opacity: 0;
  transition: background-position 0.9s cubic-bezier(0.25, 1, 0.35, 1), opacity 0.3s ease;
}

.glass-card:hover::after {
  background-position: 100% 0;
  opacity: 1;
}

.dark .glass-card::after {
  background-image: linear-gradient(115deg, transparent 25%, rgba(226, 232, 240, 0.12) 50%, transparent 75%);
}

@media (prefers-reduced-motion: reduce) {
  .glass-card::after {
    display: none;
  }
}

/* ==================== 内联排行榜（经典扁平档）====================
   样式逐字取自 LeaderboardPage.vue 的 scoped 块；内联后这些类挂在统计页模板里，
   因此同样登记在统计页的 scoped 块中。 */
.leaderboard-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid transparent;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.leaderboard-row:hover {
  background: rgba(0, 0, 0, 0.05);
  transform: translateX(2px);
}

.leaderboard-row--login {
  font: inherit;
}

.leaderboard-row.is-top-3 {
  background: rgba(236, 65, 65, 0.04);
}

.leaderboard-row.is-me {
  background: rgba(236, 65, 65, 0.08);
  border-color: rgba(236, 65, 65, 0.25);
}

.leaderboard-row.is-sticky {
  position: sticky;
  bottom: 0;
  z-index: 10;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(236, 65, 65, 0.35);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.06);
}

.leaderboard-row.is-sticky.leaderboard-row--glass-on-custom-background {
  background: rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
}

.leaderboard-rank {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 700;
  flex-shrink: 0;
}

.leaderboard-rank.rank-normal {
  color: rgba(0, 0, 0, 0.5);
  background: rgba(0, 0, 0, 0.05);
}

.leaderboard-rank.rank-1 {
  color: #fff;
  background: linear-gradient(135deg, #FFD700, #FFA500);
  box-shadow: 0 2px 8px rgba(255, 165, 0, 0.3);
}

.leaderboard-rank.rank-2 {
  color: #fff;
  background: linear-gradient(135deg, #C0C0C0, #A8A8A8);
  box-shadow: 0 2px 8px rgba(168, 168, 168, 0.3);
}

.leaderboard-rank.rank-3 {
  color: #fff;
  background: linear-gradient(135deg, #CD7F32, #A0522D);
  box-shadow: 0 2px 8px rgba(160, 82, 45, 0.3);
}

.leaderboard-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.06);
  color: #EC4141;
  font-size: 0.9rem;
  font-weight: 700;
  flex-shrink: 0;
}

.leaderboard-info {
  flex: 1;
  min-width: 0;
}

.leaderboard-name {
  font-size: 0.875rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leaderboard-tag {
  display: inline-grid;
  place-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  color: #fff;
  background: #EC4141;
  flex-shrink: 0;
}

.leaderboard-username {
  font-size: 0.7rem;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leaderboard-duration {
  font-size: 0.85rem;
  font-weight: 700;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.leaderboard-divider {
  display: grid;
  place-items: center;
  padding: 4px 0;
  font-size: 0.75rem;
  letter-spacing: 2px;
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

/* ==================== 内联排行榜（经典扁平档）：全局块 ====================
   逐字取自 LeaderboardPage.vue 的全局块；带 .dark 前缀的规则需保持全局作用域。 */
.animate-rank-pop {
  animation: rankPop 0.4s cubic-bezier(0.34, 1.15, 0.64, 1) forwards;
}

@keyframes rankPop {
  from {
    transform: scale(0.4);
  }

  to {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-fade-in-up {
    animation: none;
    opacity: 1;
    transform: none;
    filter: none;
  }

  .animate-rank-pop {
    animation: none;
  }
}

/* ==================== 听歌排行榜深色模式适配 ==================== */
.dark .leaderboard-row {
  background: rgba(255, 255, 255, 0.04);
}

.dark .leaderboard-row:hover {
  background: rgba(255, 255, 255, 0.07);
}

.dark .leaderboard-row.is-top-3 {
  background: rgba(236, 65, 65, 0.08);
}

.dark .leaderboard-row.is-me {
  background: rgba(236, 65, 65, 0.12);
  border-color: rgba(236, 65, 65, 0.35);
}

.dark .leaderboard-row.is-sticky {
  background: rgba(30, 30, 30, 0.92);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
}

.dark .leaderboard-row.is-sticky.leaderboard-row--glass-on-custom-background {
  background: rgba(30, 30, 30, 0.58);
}

.dark .leaderboard-rank.rank-normal {
  color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.08);
}

.dark .leaderboard-avatar {
  background: rgba(255, 255, 255, 0.1);
}

/* ==================== 排行榜周期切换 ==================== */
.leaderboard-period-tabs {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 10px;
  padding: 3px;
}

.dark .leaderboard-period-tabs {
  background: rgba(255, 255, 255, 0.06);
}

.leaderboard-period-tab {
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.5);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.dark .leaderboard-period-tab {
  color: rgba(255, 255, 255, 0.5);
}

.leaderboard-period-tab:hover:not(.active):not(:disabled) {
  color: rgba(0, 0, 0, 0.7);
  background: rgba(0, 0, 0, 0.04);
}

.dark .leaderboard-period-tab:hover:not(.active):not(:disabled) {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.06);
}

.leaderboard-period-tab.active {
  color: #fff;
  background: #EC4141;
  box-shadow: 0 1px 4px rgba(236, 65, 65, 0.3);
}

.leaderboard-period-tab:disabled {
  opacity: 0.5;
  cursor: pointer;
}
</style>
