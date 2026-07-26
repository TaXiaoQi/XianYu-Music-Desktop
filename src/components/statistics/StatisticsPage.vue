<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useStatisticsStore } from '../../features/statistics/store';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';

const TEXT = {
  totalListenDuration: '总听歌时长',
  songTotalDuration: '歌曲总时长',
  librarySize: '库大小',
  losslessRatio: '无损占比',
  totalSongs: '总歌曲',
  playCount: '播放次数',
  longestPlayed: '最长播放',
  hourlyDistribution: '24小时播放分布',
  loadFailed: '加载失败：',
  retry: '重试',
  noData: '暂无数据',
  noLibraryHint: '先去设置中添加音乐库文件夹吧',
  unknownSong: '未知歌曲',
  unknownArtist: '未知艺术家',
  deletedSong: '已删除歌曲',
  hourUnit: '小时',
  minuteUnit: '分钟',
  secondUnit: '秒',
};

const statisticsStore = useStatisticsStore();
const {
  stats,
  behaviorStats,
  loading,
  error,
} = storeToRefs(statisticsStore);

const { canonicalSongs } = useLibraryBrowse();

onMounted(async () => {
  statisticsStore.cancelHeavyDataRelease();
  await statisticsStore.ensureLoaded('All');
});

onUnmounted(() => {
  statisticsStore.scheduleHeavyDataRelease();
});

async function handleRefresh() {
  try {
    await statisticsStore.refreshAll('All');
  } catch {
    // Store state already carries the error.
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
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

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

const longestPlayed = computed(() => {
  const top = behaviorStats.value?.top_songs_by_duration?.[0];
  if (!top) {
    return null;
  }

  const normalizedPath = normalizePath(top.song_path);
  const song = canonicalSongs.value.find(item => normalizePath(item.path) === normalizedPath);

  if (song) {
    return {
      title: song.title || song.name || TEXT.unknownSong,
      artist: song.artist || TEXT.unknownArtist,
      duration: top.value,
    };
  }

  const fileName = top.song_path.split(/[/\\]/).pop() || TEXT.deletedSong;
  return {
    title: fileName,
    artist: TEXT.unknownArtist,
    duration: top.value,
  };
});

const hourDistribution = computed(() => behaviorStats.value?.hour_distribution ?? []);
const maxHourCount = computed(() => Math.max(...hourDistribution.value, 1));

const losslessRatio = computed(() => {
  if (!stats.value || stats.value.total_songs === 0) return 0;
  return Math.round((stats.value.lossless_count / stats.value.total_songs) * 100);
});

const hourLabels = computed(() => {
  const labels: string[] = [];
  for (let i = 0; i <= 24; i += 6) {
    const hour = String(i).padStart(2, '0');
    labels.push(`${hour}:00`);
  }
  return labels;
});
</script>

<template>
  <div class="statistics-page h-full overflow-y-auto custom-scrollbar w-full select-none">
    <div class="px-4 py-10 md:px-6 md:py-12 max-w-6xl mx-auto">
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

      <!-- Empty state -->
      <div v-else-if="stats && stats.total_songs === 0" class="text-center py-24">
        <p class="text-gray-800 dark:text-gray-200 text-3xl font-light">{{ TEXT.noData }}</p>
        <p class="text-gray-600 dark:text-gray-300 text-base mt-3">{{ TEXT.noLibraryHint }}</p>
      </div>

      <!-- Main content -->
      <div v-else-if="stats && behaviorStats" class="space-y-6 md:space-y-8">
        <!-- 总听歌时长 + 右侧三个小分支 -->
        <section class="px-8 py-8 md:px-12 md:py-10 animate-fade-in-up">
          <div class="flex items-end justify-between gap-6 md:gap-10 flex-wrap">
            <!-- 左：总听歌时长 -->
            <div class="shrink-0">
              <p class="text-black dark:text-white text-base md:text-lg font-light tracking-wider mb-2">{{ TEXT.totalListenDuration }}</p>
              <p class="text-black dark:text-white text-3xl md:text-4xl font-black tracking-tight leading-none">{{ formatDuration(behaviorStats.total_duration) }}</p>
            </div>
            <!-- 右：三个小分支，均匀分布 -->
            <div class="flex-1 grid grid-cols-3 gap-4 md:gap-8 min-w-0">
              <div>
                <p class="text-black/70 dark:text-white/70 text-xs md:text-sm font-light tracking-wider mb-1">{{ TEXT.songTotalDuration }}</p>
                <p class="text-black dark:text-white text-lg md:text-xl font-black tracking-tight leading-none">{{ formatDuration(stats.total_duration) }}</p>
              </div>
              <div>
                <p class="text-black/70 dark:text-white/70 text-xs md:text-sm font-light tracking-wider mb-1">{{ TEXT.librarySize }}</p>
                <p class="text-black dark:text-white text-lg md:text-xl font-black tracking-tight leading-none">{{ formatFileSize(stats.total_file_size) }}</p>
              </div>
              <div>
                <p class="text-black/70 dark:text-white/70 text-xs md:text-sm font-light tracking-wider mb-1">{{ TEXT.losslessRatio }}</p>
                <p class="text-black dark:text-white text-lg md:text-xl font-black tracking-tight leading-none">{{ losslessRatio }}%</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 总歌曲 + 播放次数 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section class="px-8 py-6 md:px-10 md:py-8 animate-fade-in-up" style="animation-delay: 100ms;">
            <p class="text-black dark:text-white text-sm md:text-base font-light tracking-wider mb-2">{{ TEXT.totalSongs }}</p>
            <p class="text-black dark:text-white text-2xl md:text-3xl font-black tracking-tight leading-none">{{ stats.total_songs }}</p>
          </section>

          <section class="px-8 py-6 md:px-10 md:py-8 animate-fade-in-up" style="animation-delay: 200ms;">
            <p class="text-black dark:text-white text-sm md:text-base font-light tracking-wider mb-2">{{ TEXT.playCount }}</p>
            <p class="text-black dark:text-white text-2xl md:text-3xl font-black tracking-tight leading-none">{{ behaviorStats.total_plays }}</p>
          </section>
        </div>

        <!-- 最长播放 -->
        <section v-if="longestPlayed" class="px-8 py-6 md:px-12 md:py-8 animate-fade-in-up" style="animation-delay: 300ms;">
          <p class="text-black dark:text-white text-sm md:text-base font-light tracking-wider mb-2">{{ TEXT.longestPlayed }}</p>
          <p class="text-black dark:text-white text-lg md:text-xl font-black tracking-tight leading-tight mb-1 truncate">{{ longestPlayed.title }}</p>
          <p class="text-black/70 dark:text-white/70 text-sm md:text-base font-medium">{{ longestPlayed.artist }} · {{ formatDuration(longestPlayed.duration) }}</p>
        </section>

        <!-- 24小时播放分布 -->
        <section class="px-8 py-6 md:px-12 md:py-8 animate-fade-in-up" style="animation-delay: 400ms;">
          <p class="text-black dark:text-white text-sm md:text-base font-light tracking-wider mb-6">{{ TEXT.hourlyDistribution }}</p>
          <div class="flex items-end gap-1 md:gap-2 h-28 md:h-32">
            <div
              v-for="(count, hour) in hourDistribution"
              :key="hour"
              class="flex-1 rounded-t-md md:rounded-t-lg transition-all duration-300 bg-black dark:bg-white"
              :style="{ height: `${Math.max((count / maxHourCount) * 100, 3)}%`, opacity: count > 0 ? 1 : 0.15 }"
            ></div>
          </div>
          <div class="flex justify-between mt-3 text-black/60 dark:text-white/60 text-xs md:text-sm font-medium">
            <span v-for="label in hourLabels" :key="label">{{ label }}</span>
          </div>
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
