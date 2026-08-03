<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useStatisticsStore } from '../../features/statistics/store';
import { useAuthStore } from '../../features/auth/store';
import { useSettings } from '../../features/settings/useSettings';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { fetchLeaderboard, type LeaderboardEntry } from '../../services/leaderboardService';
import { normalizePath } from '../../utils/path';
import { formatFileSize } from '../../utils/format';

const authStore = useAuthStore();
const router = useRouter();
const { theme } = useSettings();

const hasCustomBackground = computed(() => (
  theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)
));

const TEXT = {
  totalListenDuration: '总听歌时长',
  songTotalDuration: '歌曲总时长',
  librarySize: '库大小',
  losslessRatio: '无损占比',
  totalSongs: '总歌曲',
  playCount: '播放次数',
  longestPlayed: '常听歌曲',
  hourlyDistribution: '24小时播放分布',
  leaderboard: '听歌排行榜',
  leaderboardSubtitle: '单日听歌时长排行',
  loadFailed: '加载失败：',
  retry: '重试',
  unknownSong: '未知歌曲',
  unknownArtist: '未知艺术家',
  deletedSong: '已删除歌曲',
  hourUnit: '小时',
  minuteUnit: '分钟',
  secondUnit: '秒',
  you: '你',
};

// 听歌排行榜：LeaderboardEntry 类型从 leaderboardService 导入

const leaderboard = ref<LeaderboardEntry[]>([]);
const leaderboardLoading = ref(true);
const leaderboardError = ref<string | null>(null);
let leaderboardRequestId = 0;

async function loadLeaderboard() {
  const requestId = ++leaderboardRequestId;
  // 先清空数据并显示骨架屏
  leaderboard.value = [];
  leaderboardLoading.value = true;
  leaderboardError.value = null;
  try {
    // 传递本地统计的听歌时长，先上报到后端再获取排行榜
    const localDuration = behaviorStats.value?.total_duration ?? 0;
    const data = await fetchLeaderboard(50, localDuration);
    if (requestId !== leaderboardRequestId) return;
    leaderboard.value = data.leaderboard;
    // 如果当前用户不在 Top 列表中，将其追加到列表末尾（用于底部固定显示）
    if (data.me && !leaderboard.value.some(u => u.isMe)) {
      leaderboard.value.push(data.me);
    }
  } catch (e) {
    if (requestId !== leaderboardRequestId) return;
    const msg = e instanceof Error ? e.message : String(e);
    leaderboardError.value = msg;
    leaderboard.value = [];
  } finally {
    if (requestId === leaderboardRequestId) {
      leaderboardLoading.value = false;
    }
  }
}

// 前15名 + 始终返回自己的排名（用于底部固定显示）
const leaderboardDisplay = computed(() => {
  const top15 = leaderboard.value.slice(0, 15);
  const me = leaderboard.value.find(u => u.isMe);
  return { top: top15, me };
});

function formatLeaderboardDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}小时${m > 0 ? `${m}分` : ''}`;
  return `${m}分钟`;
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

  // 每 30 秒自动刷新行为统计，让「总听歌时长」准实时更新
  statsRefreshTimer = setInterval(async () => {
    try {
      await statisticsStore.refreshBehaviorOnly('All');
    } catch {
      // 刷新失败静默处理，不影响用户使用
    }
  }, 30_000);
});

onUnmounted(() => {
  statisticsStore.scheduleHeavyDataRelease();
  if (statsRefreshTimer) {
    clearInterval(statsRefreshTimer);
    statsRefreshTimer = null;
  }
});

async function handleRefresh() {
  try {
    await statisticsStore.refreshAll('All');
  } catch {
    // Store state already carries the error.
  }
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) {
    return `0${TEXT.minuteUnit}`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}${TEXT.hourUnit} ${minutes}${TEXT.minuteUnit}`;
  }

  if (minutes > 0) {
    return `${minutes}${TEXT.minuteUnit} ${secs}${TEXT.secondUnit}`;
  }

  return `${secs}${TEXT.secondUnit}`;
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
      title: song.title || song.name || TEXT.unknownSong,
      artist: song.artist || TEXT.unknownArtist,
      playCount: top.play_count,
    };
  }

  const fileName = top.song_path.split(/[/\\]/).pop() || TEXT.deletedSong;
  return {
    title: fileName,
    artist: TEXT.unknownArtist,
    playCount: top.play_count,
  };
});

const losslessRatio = computed(() => {
  if (!stats.value || stats.value.total_songs === 0) return 0;
  return Math.round((stats.value.lossless_count / stats.value.total_songs) * 100);
});
</script>

<template>
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
        <!-- 总歌曲 + 右侧三个小分支 -->
        <section class="px-[clamp(1rem,2.5vw,3rem)] pt-[clamp(0.25rem,0.5vw,0.5rem)] pb-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up">
          <div class="flex items-end justify-between gap-[clamp(3rem,6vw,6rem)] flex-wrap">
            <!-- 左：总歌曲 -->
            <div class="shrink-0 flex flex-col justify-end">
              <p class="text-black dark:text-white text-[clamp(0.875rem,1.2vw,1.125rem)] font-light tracking-wider mb-2">{{ TEXT.totalSongs }}</p>
              <p class="text-black dark:text-white text-[clamp(1.5rem,3.5vw,2.25rem)] font-black tracking-tight leading-none">{{ stats.total_songs }}</p>
            </div>
            <!-- 右：三个小分支，均匀分布 -->
            <div class="flex-1 grid grid-cols-3 gap-[clamp(0.5rem,1.5vw,2rem)] min-w-0">
              <div class="flex flex-col justify-end">
                <p class="text-black/70 dark:text-white/70 text-[clamp(0.7rem,0.9vw,0.875rem)] font-light tracking-wider mb-1">{{ TEXT.songTotalDuration }}</p>
                <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-none">{{ formatDuration(stats.total_duration) }}</p>
              </div>
              <div class="flex flex-col justify-end">
                <p class="text-black/70 dark:text-white/70 text-[clamp(0.7rem,0.9vw,0.875rem)] font-light tracking-wider mb-1">{{ TEXT.librarySize }}</p>
                <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-none">{{ formatFileSize(stats.total_file_size) }}</p>
              </div>
              <div class="flex flex-col justify-end">
                <p class="text-black/70 dark:text-white/70 text-[clamp(0.7rem,0.9vw,0.875rem)] font-light tracking-wider mb-1">{{ TEXT.losslessRatio }}</p>
                <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-none">{{ losslessRatio }}%</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 总听歌时长 + 播放次数 + 常听歌曲 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-[clamp(0.5rem,1vw,0.875rem)]">
          <section class="px-[clamp(1rem,2.2vw,2.5rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up flex flex-col justify-start" style="animation-delay: 100ms;">
            <p class="text-black dark:text-white text-[clamp(0.9rem,1.25vw,1.125rem)] font-light tracking-wider mb-2">{{ TEXT.totalListenDuration }}</p>
            <p class="text-black dark:text-white text-[clamp(1.625rem,3.25vw,2rem)] font-black tracking-tight leading-none whitespace-nowrap">{{ formatDuration(behaviorStats.total_duration) }}</p>
          </section>

          <section class="px-[clamp(1rem,2.2vw,2.5rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up flex flex-col justify-start md:ml-[clamp(3.25rem,5.75vw,5.5rem)]" style="animation-delay: 200ms;">
            <p class="text-black dark:text-white text-[clamp(0.8rem,1.1vw,1rem)] font-light tracking-wider mb-2">{{ TEXT.playCount }}</p>
            <p class="text-black dark:text-white text-[clamp(1.5rem,3vw,1.875rem)] font-black tracking-tight leading-none">{{ behaviorStats.total_plays }}</p>
          </section>

          <section v-if="longestPlayed" class="px-[clamp(1rem,2.2vw,2.5rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up flex flex-col justify-start" style="animation-delay: 300ms;">
            <p class="text-black dark:text-white text-[clamp(0.8rem,1.1vw,1rem)] font-light tracking-wider mb-2">{{ TEXT.longestPlayed }}</p>
            <p class="text-black dark:text-white text-[clamp(1rem,1.8vw,1.25rem)] font-black tracking-tight leading-tight mb-1 truncate">{{ longestPlayed.title }}</p>
            <p class="text-black/70 dark:text-white/70 text-[clamp(0.8rem,1.1vw,1rem)] font-medium truncate">{{ longestPlayed.artist }} · {{ longestPlayed.playCount }}次</p>
          </section>
        </div>

        <!-- 听歌排行榜 -->
        <section class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 400ms;">
          <div class="flex items-end justify-between gap-3 flex-wrap mb-[clamp(0.5rem,1vw,0.875rem)]">
            <div>
              <p class="text-black dark:text-white text-[clamp(0.8rem,1.1vw,1rem)] font-light tracking-wider">{{ TEXT.leaderboard }}</p>
              <p class="text-black/50 dark:text-white/50 text-[clamp(0.7rem,0.9vw,0.8rem)] font-light mt-1">{{ TEXT.leaderboardSubtitle }}</p>
            </div>
            <button
              type="button"
              class="text-[clamp(0.7rem,0.9vw,0.8rem)] text-black/60 dark:text-white/60 hover:text-[#EC4141] dark:hover:text-[#EC4141] font-medium transition cursor-pointer"
              @click="loadLeaderboard"
            >
              刷新
            </button>
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
            <p class="text-black/50 dark:text-white/50 text-sm">暂无排行榜数据</p>
          </div>

          <!-- 加载失败提示 -->
          <div v-else-if="leaderboardError && leaderboardDisplay.top.length === 0" class="py-8 text-center">
            <p class="text-black/50 dark:text-white/50 text-sm">排行榜加载失败</p>
            <button
              type="button"
              class="mt-2 text-[clamp(0.7rem,0.9vw,0.8rem)] text-[#EC4141] font-medium transition cursor-pointer"
              @click="loadLeaderboard"
            >
              点击重试
            </button>
          </div>

          <!-- 排行榜列表 -->
          <div v-else class="grid gap-1.5">
            <div
              v-for="(item, index) in leaderboardDisplay.top"
              :key="item.username"
              class="leaderboard-row animate-fade-in-up"
              :class="{ 'is-me': item.isMe, 'is-top-3': item.rank <= 3 }"
              :style="{ animationDelay: `${index * 60}ms` }"
            >
              <div
                class="leaderboard-rank animate-rank-pop"
                :class="`rank-${item.rank <= 3 ? item.rank : 'normal'}`"
                :style="{ animationDelay: `${index * 60 + 200}ms` }"
              >
                {{ item.rank }}
              </div>
              <div class="leaderboard-avatar">
                <img v-if="item.avatar" :src="item.avatar" alt="" class="h-full w-full object-cover" />
                <span v-else>{{ item.nickname.slice(0, 1).toUpperCase() }}</span>
              </div>
              <div class="leaderboard-info">
                <div class="leaderboard-name text-gray-800 dark:text-white/90">
                  {{ item.nickname }}
                  <span v-if="item.isMe" class="leaderboard-tag">{{ TEXT.you }}</span>
                </div>
                <div class="leaderboard-username text-black/45 dark:text-white/45">@{{ item.username }}</div>
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
              class="leaderboard-row is-me is-sticky animate-fade-in-up"
              :class="{ 'leaderboard-row--glass-on-custom-background': hasCustomBackground }"
              :style="{ animationDelay: `${leaderboardDisplay.top.length * 60 + 200}ms` }"
            >
              <div
                class="leaderboard-rank animate-rank-pop"
                :class="`rank-${leaderboardDisplay.me.rank <= 3 ? leaderboardDisplay.me.rank : 'normal'}`"
                :style="{ animationDelay: `${leaderboardDisplay.top.length * 60 + 400}ms` }"
              >
                {{ leaderboardDisplay.me.rank }}
              </div>
              <div class="leaderboard-avatar">
                <img v-if="leaderboardDisplay.me.avatar" :src="leaderboardDisplay.me.avatar" alt="" class="h-full w-full object-cover" />
                <span v-else>{{ leaderboardDisplay.me.nickname.slice(0, 1).toUpperCase() }}</span>
              </div>
              <div class="leaderboard-info">
                <div class="leaderboard-name text-gray-800 dark:text-white/90">
                  {{ leaderboardDisplay.me.nickname }}
                  <span class="leaderboard-tag">{{ TEXT.you }}</span>
                </div>
                <div class="leaderboard-username text-black/45 dark:text-white/45">@{{ leaderboardDisplay.me.username }}</div>
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
              :class="{ 'leaderboard-row--glass-on-custom-background': hasCustomBackground }"
              aria-label="前往登录页面查看个人排名"
              title="登录后查看个人排名"
              @click="openLoginPage"
            >
              <div class="leaderboard-rank rank-normal">—</div>
              <div class="leaderboard-avatar">
                <span>未</span>
              </div>
              <div class="leaderboard-info">
                <div class="leaderboard-name text-gray-800 dark:text-white/90">未登录</div>
                <div class="leaderboard-username text-black/45 dark:text-white/45">登录后查看个人排名</div>
              </div>
              <div class="leaderboard-duration text-[#EC4141]">去登录</div>
            </button>
          </template>
        </section>
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

.animate-fade-in-up {
  opacity: 0;
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
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
</style>
