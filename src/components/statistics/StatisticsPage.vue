<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useStatisticsStore } from '../../features/statistics/store';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { useI18n } from '../../features/i18n';
import { getListenStatsDisplay } from '../../services/domain/leaderboardService';
import { normalizePath } from '../../utils/path';
import { formatFileSize } from '../../utils/format';

const { isEnglish } = useI18n();

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

let statsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let statsFirstActivation = true;

const startStatsTimer = () => {
  if (statsRefreshTimer) return;
  statsRefreshTimer = setInterval(async () => {
    try {
      await statisticsStore.refreshBehaviorOnly('All');
      await refreshListenDisplay();
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
      await statisticsStore.refreshBehaviorOnly('All');
      await refreshListenDisplay();
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
        <p class="text-red-600 dark:text-red-400 text-xl">{{ TEXT.loadFailed }}{{ error }}</p>
        <button @click="handleRefresh" class="mt-4 px-6 py-3 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors text-base font-medium">
          {{ TEXT.retry }}
        </button>
      </div>

      <div v-else-if="stats && behaviorStats" class="space-y-[clamp(0.5rem,1vw,0.875rem)]">
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
