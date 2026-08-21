<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useStatisticsStore } from '../../features/statistics/store';
import { useAuthStore } from '../../features/auth/store';
import { useSettings } from '../../features/settings/useSettings';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { useI18n } from '../../features/i18n';
import { openOnlineDetail } from '../../features/onlineDetail/store';
import { fetchLeaderboard, getLocalListenDurations, type LeaderboardEntry, type LeaderboardPeriod } from '../../services/leaderboardService';
import { normalizePath } from '../../utils/path';
import { formatFileSize } from '../../utils/format';
import SongContextMenu from '../overlays/SongContextMenu.vue';

const authStore = useAuthStore();
const router = useRouter();
const { theme } = useSettings();
const { isEnglish } = useI18n();

// 排行榜右键菜单状态
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

/** 右键"查看"：打开用户详情页（收藏/歌单 tab） */
function handleViewLeaderboardUser() {
  const entry = contextMenuTargetEntry.value;
  if (!entry) return;
  openOnlineDetail({
    type: 'user',
    title: entry.nickname || entry.username,
    subtitle: `@${entry.username}`,
    coverUrl: entry.avatar || '',
    // username 用于同步查询键，必须用弦予号(ciyuanxi_id)，昵称仅用于展示
    rawData: { username: entry.ciyuanxi_id || entry.username, ciyuanxi_id: entry.ciyuanxi_id },
    platformId: entry.ciyuanxi_id || entry.username,
    engineType: 'musicfree',
  });
  showContextMenu.value = false;
}

const hasCustomBackground = computed(() => (
  theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)
));

const TEXT = computed(() => isEnglish.value ? {
  totalListenDuration: 'Total Listening Time',
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

const leaderboard = ref<LeaderboardEntry[]>([]);
const leaderboardLoading = ref(true);
const leaderboardError = ref<string | null>(null);
const currentPeriod = ref<LeaderboardPeriod>('daily');
let leaderboardRequestId = 0;

// ==================== 排行榜逐行入场动画 ====================
/** 行入场错峰间隔与单行动画时长（ms）：间隔拉大到 100ms 让逐行波浪清晰可辨 */
const ROW_ENTER_STAGGER = 100;
const ROW_ENTER_DURATION = 450;
/** 入场动画进行中：行动画类生效；结束后移除类，
    悬停跳跃动画才能安全接管 animation 属性（否则会把入场动画顶掉导致 opacity 回落为 0） */
const rowEnterAnimating = ref(false);
/** 已完成入场动画的行（username 集合）：这些行立即解除入场类，
    悬停冲刺即刻可用，无需等整个榜单全部入场结束 */
const enteredRowKeys = ref<Set<string>>(new Set());
let rowEnterAnimTimer: ReturnType<typeof setTimeout> | undefined;

/** 数据加载完成后播放逐行入场：总时长按行数（Top + 底部个人排名/登录栏）估算，超时自动收尾 */
function playRowEnterAnimation() {
  clearTimeout(rowEnterAnimTimer);
  rowEnterAnimating.value = true;
  enteredRowKeys.value = new Set();
  const rows = leaderboardDisplay.value.top.length + 1;
  rowEnterAnimTimer = setTimeout(() => {
    rowEnterAnimating.value = false;
  }, rows * ROW_ENTER_STAGGER + ROW_ENTER_DURATION + 120);
}

function stopRowEnterAnimation() {
  clearTimeout(rowEnterAnimTimer);
  rowEnterAnimating.value = false;
  enteredRowKeys.value = new Set();
}

/** 行入场动画结束（animationend）：按行解除入场类，让该行悬停冲刺立即可用。
    只认行自身的 fadeInUp（e.target === e.currentTarget），
    排除从排名徽章 animate-rank-pop 冒泡上来的同名事件 */
function handleRowAnimationEnd(e: AnimationEvent, key: string) {
  if (e.animationName !== 'fadeInUp' || e.target !== e.currentTarget) return;
  const next = new Set(enteredRowKeys.value);
  next.add(key);
  enteredRowKeys.value = next;
}

const periodLabel = computed(() => {
  switch (currentPeriod.value) {
    case 'daily': return isEnglish.value ? 'Daily listening time' : '单日听歌时长排行';
    case 'weekly': return isEnglish.value ? 'Weekly listening time' : '本周听歌时长排行';
    default: return isEnglish.value ? 'All-time listening time' : '累计听歌时长排行';
  }
});

async function loadLeaderboard(silent = false) {
  const requestId = ++leaderboardRequestId;
  // 静默刷新时不清空列表、不显示骨架屏，原地更新数据，避免刷新造成闪烁
  if (!silent) {
    stopRowEnterAnimation();
    leaderboard.value = [];
    leaderboardLoading.value = true;
    leaderboardError.value = null;
  }
  try {
    // 获取日/周/总三个周期的听歌时长，上报到后端用于分周期排行榜
    const durations = await getLocalListenDurations();
    if (requestId !== leaderboardRequestId) return;
    const data = await fetchLeaderboard(15, durations, currentPeriod.value);
    if (requestId !== leaderboardRequestId) return;
    leaderboard.value = data.leaderboard;
    // 如果本次上报触发了服务端重置信号，本地统计已被清空，需刷新展示
    if (data.resetApplied) {
      await statisticsStore.refreshBehaviorOnly('All');
    }
    // 如果当前用户不在 Top 列表中，将其追加到列表末尾（用于底部固定显示）
    if (data.me && !leaderboard.value.some(u => u.isMe)) {
      leaderboard.value.push(data.me);
    }
    // 非静默加载（周期切换/手动刷新/路由返回）：列表重建后播放逐行入场动画
    if (!silent) playRowEnterAnimation();
    if (silent) leaderboardError.value = null;
  } catch (e) {
    if (requestId !== leaderboardRequestId) return;
    // 静默刷新失败时保留已展示的数据，不打断用户
    if (!silent || leaderboard.value.length === 0) {
      const msg = e instanceof Error ? e.message : String(e);
      leaderboardError.value = msg;
      leaderboard.value = [];
    }
  } finally {
    if (requestId === leaderboardRequestId) {
      leaderboardLoading.value = false;
    }
  }
}

function switchPeriod(period: LeaderboardPeriod) {
  if (currentPeriod.value === period) return;
  currentPeriod.value = period;
  void loadLeaderboard();
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

// 前15名 + 始终返回自己的排名（用于底部固定显示）
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

let statsRefreshTimer: ReturnType<typeof setInterval> | null = null;
/** KeepAlive 首次激活与 onMounted 同帧触发，跳过首次重复刷新 */
let statsFirstActivation = true;

const startStatsTimer = () => {
  if (statsRefreshTimer) return;
  statsRefreshTimer = setInterval(async () => {
    try {
      await statisticsStore.refreshBehaviorOnly('All');
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
const isLeaderboardReady = ref(false);

const route = useRoute();
const openLoginPage = () => {
  void router.push('/auth');
};

// 监听路由变化：从其他页面切回首页时重新加载排行榜（显示骨架屏动画）
watch(() => route.path, (newPath, oldPath) => {
  if (newPath === '/' && oldPath && oldPath !== '/') {
    void loadLeaderboard();
  }
});

// 登录态变化时刷新：登录后补充个人排名，退出后立即移除个人信息。
watch(() => authStore.isLoggedIn, (isLoggedIn, wasLoggedIn) => {
  if (isLoggedIn !== wasLoggedIn && isLeaderboardReady.value) {
    void loadLeaderboard();
  }
});

// 用户名变化时刷新：用户修改名字后排行榜需显示最新名称
watch(() => authStore.user?.username, () => {
  if (isLeaderboardReady.value) {
    void loadLeaderboard();
  }
});

onMounted(async () => {
  statisticsStore.cancelHeavyDataRelease();
  // 每次进入统计页都强制刷新行为统计（不依赖缓存），确保听歌时长是最新的
  await statisticsStore.refreshBehaviorOnly('All');
  if (!statisticsStore.stats) {
    await statisticsStore.ensureLoaded('All');
  }
  // 统计数据加载完成后，再加载排行榜（需要 total_duration 上报到后端）
  isLeaderboardReady.value = true;
  void loadLeaderboard();

  // 每分钟自动刷新行为统计，「总听歌时长」按分钟粒度更新，
  // 同时静默刷新排行榜（原地更新、不闪骨架屏），使停留页面期间排行榜持续同步最新时长。
  startStatsTimer();
});

// KeepAlive 场景：从其他 TAB 切回时，补上离开期间的行为统计与排行榜增量（静默刷新）
onActivated(() => {
  if (statsFirstActivation) {
    statsFirstActivation = false;
    return;
  }
  startStatsTimer();
  void (async () => {
    try {
      await statisticsStore.refreshBehaviorOnly('All');
      await loadLeaderboard(true);
    } catch {
      // 刷新失败静默处理
    }
  })();
});

// KeepAlive 场景：切到其他 TAB 时暂停轮询，避免后台空转
onDeactivated(() => {
  stopStatsTimer();
});

onUnmounted(() => {
  statisticsStore.scheduleHeavyDataRelease();
  stopStatsTimer();
  stopRowEnterAnimation();
});

async function handleRefresh() {
  try {
    await statisticsStore.refreshAll('All');
  } catch {
    // Store state already carries the error.
  }
}

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

const losslessRatio = computed(() => {
  if (!stats.value || stats.value.total_songs === 0) return 0;
  return Math.round((stats.value.lossless_count / stats.value.total_songs) * 100);
});
</script>

<template>
  <div class="relative h-full">
    <div class="statistics-page h-full overflow-y-auto custom-scrollbar w-full select-none">
    <div class="px-4 pt-[clamp(0.25rem,0.6vw,0.75rem)] pb-10 md:px-6 md:pb-12 max-w-6xl mx-auto">
      <!-- Loading state -->
      <div v-if="loading && !stats" class="space-y-8">
        <div class="h-40 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div class="h-36 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
          <div class="h-36 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
        </div>
        <div class="h-40 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
        <div class="h-64 rounded-3xl bg-gray-100/60 dark:bg-white/5 animate-pulse"></div>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="p-10 rounded-3xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <p class="text-red-600 dark:text-red-400 text-xl">{{ TEXT.loadFailed }}{{ error }}</p>
        <button @click="handleRefresh" class="mt-4 px-6 py-3 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors text-base font-medium">
          {{ TEXT.retry }}
        </button>
      </div>

      <!-- Main content -->
      <div v-else-if="stats && behaviorStats" class="space-y-[clamp(0.5rem,1vw,0.875rem)]">
        <!-- 库概览：总歌曲 + 歌曲总时长/库大小/无损占比 -->
        <!-- 与下方「听歌概览」使用完全相同的列模板，保证两行纵向严格对齐 -->
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

        <!-- 听歌概览：总听歌时长 + 播放次数/常听歌曲 -->
        <!-- 列模板与上方完全一致：播放次数严格对齐「库大小」，常听歌曲严格对齐「无损占比」 -->
        <section class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 100ms;">
          <div class="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1.3fr] gap-x-[clamp(0.75rem,2vw,2rem)]">
            <div class="col-span-2 md:col-span-1 min-w-0">
              <p class="text-black dark:text-white text-[clamp(0.9rem,1.25vw,1.125rem)] font-light tracking-wider mb-2">{{ TEXT.totalListenDuration }}</p>
              <p class="text-black dark:text-white text-[clamp(1.375rem,2.75vw,1.75rem)] font-black tracking-tight leading-none whitespace-nowrap">{{ formatStatisticsDuration(behaviorStats.total_duration) }}</p>
            </div>
            <!-- 桌面端列占位：与「歌曲总时长」同列，保持网格对齐 -->
            <div class="hidden md:block" aria-hidden="true"></div>
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

        <!-- 听歌排行榜 -->
        <section v-if="theme.showLeaderboard" class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 400ms;">
          <div class="flex items-end justify-between gap-3 flex-wrap mb-[clamp(0.5rem,1vw,0.875rem)]">
            <div>
              <p class="text-black dark:text-white text-[clamp(0.8rem,1.1vw,1rem)] font-light tracking-wider">{{ TEXT.leaderboard }}</p>
              <p class="text-black/50 dark:text-white/50 text-[clamp(0.7rem,0.9vw,0.8rem)] font-light mt-1">{{ periodLabel }}</p>
            </div>
            <div class="flex items-center gap-2">
              <!-- 周期切换 -->
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

          <!-- 加载骨架屏 -->
          <div v-if="leaderboardLoading" class="grid gap-2">
            <div
              v-for="i in 5"
              :key="i"
              class="h-12 rounded-xl bg-gray-100/60 dark:bg-white/5 animate-pulse"
            ></div>
          </div>

          <!-- 无数据提示 -->
          <div v-else-if="leaderboardDisplay.top.length === 0 && !leaderboardError" class="py-8 text-center">
            <p class="text-black/50 dark:text-white/50 text-sm">{{ TEXT.noLeaderboard }}</p>
          </div>

          <!-- 加载失败提示 -->
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

          <!-- 排行榜列表 -->
          <div v-else class="grid gap-1.5">
            <div
              v-for="(item, index) in leaderboardDisplay.top"
              :key="item.username"
              class="leaderboard-row"
              :class="{ 'is-me': item.isMe, 'is-top-3': item.rank <= 3, 'animate-fade-in-up': rowEnterAnimating && !enteredRowKeys.has(item.username) }"
              :style="rowEnterAnimating && !enteredRowKeys.has(item.username) ? { animationDelay: `${index * ROW_ENTER_STAGGER}ms` } : undefined"
              @contextmenu="handleLeaderboardContextMenu($event, item)"
              @animationend="handleRowAnimationEnd($event, item.username)"
            >
              <div
                class="leaderboard-rank animate-rank-pop"
                :class="`rank-${item.rank <= 3 ? item.rank : 'normal'}`"
                :style="{ animationDelay: `${index * ROW_ENTER_STAGGER + 250}ms` }"
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

          <!-- 个人排名（始终固定在底部显示） -->
          <template v-if="!leaderboardLoading && leaderboardDisplay.me">
            <div class="leaderboard-divider text-black/30 dark:text-white/30">
              <span>···</span>
            </div>
            <div
              class="leaderboard-row is-me is-sticky"
              :class="{ 'leaderboard-row--glass-on-custom-background': hasCustomBackground, 'animate-fade-in-up': rowEnterAnimating }"
              :style="rowEnterAnimating ? { animationDelay: `${leaderboardDisplay.top.length * ROW_ENTER_STAGGER + 150}ms` } : undefined"
              @contextmenu="handleLeaderboardContextMenu($event, leaderboardDisplay.me)"
            >
              <div
                class="leaderboard-rank animate-rank-pop"
                :class="`rank-${leaderboardDisplay.me.rank <= 3 ? leaderboardDisplay.me.rank : 'normal'}`"
                :style="{ animationDelay: `${leaderboardDisplay.top.length * ROW_ENTER_STAGGER + 400}ms` }"
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

          <!-- 未登录时保留个人排名栏，但不展示任何个人数据 -->
          <template v-else-if="!leaderboardLoading && !authStore.isLoggedIn">
            <div class="leaderboard-divider text-black/30 dark:text-white/30">
              <span>···</span>
            </div>
            <button
              type="button"
              class="leaderboard-row leaderboard-row--login is-me is-sticky w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EC4141]/50"
              :class="{ 'leaderboard-row--glass-on-custom-background': hasCustomBackground, 'animate-fade-in-up': rowEnterAnimating }"
              :style="rowEnterAnimating ? { animationDelay: '150ms' } : undefined"
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

/* 听歌排行榜 */
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
}

/* 悬停冲刺：高亮的同时向右冲——全程纯水平运动，无任何上下位移。
   物理模型为水平阻尼弹簧：主冲越过落点（14px）→ 反向回弹（5px）
   → 再小幅冲回（9.5px）→ 落定 8px，振幅每半周期衰减一半（+6 → -3 → +1.5），
   共 360ms；移开后由基础 transform 过渡滑回原位。
   入场动画类挂着时不触发（dash 会顶掉入场动画导致 opacity 回落为 0）；
   钉底的 sticky 行（个人排名/登录栏）不动，保持稳定 */
.leaderboard-row:hover:not(.animate-fade-in-up):not(.is-sticky) {
  transform: translateX(8px);
  animation: leaderboard-dash 0.36s forwards;
}

@keyframes leaderboard-dash {
  /* 主冲：初速冲出，阻尼减速冲过落点 */
  0%   { transform: translateX(0);     animation-timing-function: cubic-bezier(0.17, 0.67, 0.35, 1); }
  /* 冲过头：最远点 14px，速度归零 */
  50%  { transform: translateX(14px);  animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  /* 回弹一：反向冲过落点到 5px */
  70%  { transform: translateX(5px);   animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  /* 回弹二：再小幅冲回到 9.5px */
  85%  { transform: translateX(9.5px); animation-timing-function: cubic-bezier(0.3, 0.6, 0.4, 1); }
  /* 落定：与 :hover 静态 transform 一致 */
  100% { transform: translateX(8px); }
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

/* 悬停规则需置于 is-top-3 / is-me 之后并提高优先级，否则静态底色会覆盖 hover 高亮 */
.leaderboard-row.is-top-3:hover {
  background: rgba(236, 65, 65, 0.09);
  border-color: rgba(236, 65, 65, 0.2);
}

.leaderboard-row.is-me:not(.is-sticky):hover {
  background: rgba(236, 65, 65, 0.13);
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

/* 自定义壁纸下保留壁纸层次，同时保证底部个人排名清晰可读。 */
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

/* 普通排名（非前三）的颜色，通过 Tailwind 在模板上控制 */
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

/* 入场动画：both 填充（delay 期 backwards 隐藏、结束 forwards 保持终态），
   不在类上声明基础 opacity: 0——这样即使动画被悬停冲刺顶掉，
   opacity 也会回到默认值 1 而不是闪失为 0 */
.animate-fade-in-up {
  animation: fadeInUp 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* 排名数字：放大淡入效果，延迟于整行之后触发。
   不单独控制 opacity，跟随整行淡入，避免整行显示后排名"闪"出 */
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

  .leaderboard-row:hover:not(.animate-fade-in-up):not(.is-sticky) {
    animation: none;
    transform: translateX(2px);
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

.dark .leaderboard-row.is-top-3:hover {
  background: rgba(236, 65, 65, 0.15);
  border-color: rgba(236, 65, 65, 0.3);
}

.dark .leaderboard-row.is-me:not(.is-sticky):hover {
  background: rgba(236, 65, 65, 0.19);
}

/* is-sticky 放在 is-me 之后，确保 sticky 行的模糊背景优先于 is-me 的红色背景 */
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
  /* 加载中短暂禁用仍保持手型光标，避免鼠标闪成「禁止」图标 */
  cursor: pointer;
}
</style>
