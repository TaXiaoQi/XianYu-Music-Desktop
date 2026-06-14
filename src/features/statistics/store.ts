import { ref } from 'vue';
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';

export interface LibraryStats {
  total_songs: number;
  total_duration: number;
  total_file_size: number;
  album_count: number;
  artist_count: number;
  lossless_count: number;
  hires_count: number;
  this_month_added: number;
}

export interface TopSong {
  song_path: string;
  play_count: number;
  value: number;
}

export interface TopArtist {
  artist: string;
  play_count: number;
}

export interface TopAlbum {
  album: string;
  play_count: number;
}

export interface BehaviorStats {
  total_plays: number;
  total_duration: number;
  top_songs: TopSong[];
  top_songs_by_duration: TopSong[];
  top_artists: TopArtist[];
  top_albums: TopAlbum[];
  hour_distribution: number[];
  recent_activity: number[];
}

export interface QualityDistribution {
  hires: number;
  super_quality: number;
  high_quality: number;
  other: number;
}

export interface FormatDistribution {
  flac: number;
  mp3: number;
  alac: number;
  wav: number;
  aiff: number;
  aac: number;
  ogg: number;
  other: number;
}

export type TimeRangeType = 'All' | 'Days7' | 'Days30' | 'ThisYear';
type TimeRange = { type: TimeRangeType };
const HEAVY_DATA_RELEASE_DELAY_MS = 60_000;

export const useStatisticsStore = defineStore('statistics', () => {
  const currentBehaviorTimeRange = ref<TimeRangeType>('Days7');
  const stats = ref<LibraryStats | null>(null);
  const behaviorStats = ref<BehaviorStats | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);
  const isRefreshing = ref(false);
  const qualityDistribution = ref<QualityDistribution | null>(null);
  const formatDistribution = ref<FormatDistribution | null>(null);
  const hasLoaded = ref(false);
  const isFirstEnter = ref(true);
  let heavyDataReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  const fetchStats = async () => {
    stats.value = await invoke<LibraryStats>('get_library_stats');
  };

  const fetchBehaviorStats = async (range: TimeRangeType) => {
    const timeRange: TimeRange = { type: range };
    behaviorStats.value = await invoke<BehaviorStats>('get_behavior_stats', { timeRange });
  };

  const ensureLoaded = async (range: TimeRangeType = currentBehaviorTimeRange.value) => {
    currentBehaviorTimeRange.value = range;
    cancelHeavyDataRelease();

    const tasks: Promise<unknown>[] = [];
    if (!stats.value) {
      tasks.push(fetchStats());
    }
    if (!behaviorStats.value) {
      tasks.push(fetchBehaviorStats(range));
    }

    if (tasks.length === 0) {
      return;
    }

    loading.value = true;
    error.value = null;
    try {
      await Promise.all(tasks);
      lastUpdated.value = new Date();
      hasLoaded.value = true;
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  };

  const refreshAll = async (range: TimeRangeType = currentBehaviorTimeRange.value) => {
    if (isRefreshing.value) {
      return;
    }

    currentBehaviorTimeRange.value = range;
    isRefreshing.value = true;
    error.value = null;
    try {
      await Promise.all([fetchStats(), fetchBehaviorStats(range)]);
      lastUpdated.value = new Date();
      hasLoaded.value = true;
    } catch (e) {
      error.value = String(e);
      throw e;
    } finally {
      isRefreshing.value = false;
      loading.value = false;
    }
  };

  const refreshBehaviorOnly = async (range: TimeRangeType) => {
    currentBehaviorTimeRange.value = range;
    try {
      await fetchBehaviorStats(range);
      lastUpdated.value = new Date();
    } catch (e) {
      error.value = String(e);
      throw e;
    }
  };

  const ensureQualityDistribution = async () => {
    cancelHeavyDataRelease();
    if (!qualityDistribution.value) {
      qualityDistribution.value = await invoke<QualityDistribution>('get_quality_distribution');
    }
    return qualityDistribution.value;
  };

  const ensureFormatDistribution = async () => {
    cancelHeavyDataRelease();
    if (!formatDistribution.value) {
      formatDistribution.value = await invoke<FormatDistribution>('get_format_distribution');
    }
    return formatDistribution.value;
  };

  const releaseHeavyData = () => {
    stats.value = null;
    behaviorStats.value = null;
    qualityDistribution.value = null;
    formatDistribution.value = null;
  };

  const cancelHeavyDataRelease = () => {
    if (heavyDataReleaseTimer) {
      clearTimeout(heavyDataReleaseTimer);
      heavyDataReleaseTimer = null;
    }
  };

  const scheduleHeavyDataRelease = (delayMs = HEAVY_DATA_RELEASE_DELAY_MS) => {
    cancelHeavyDataRelease();
    heavyDataReleaseTimer = setTimeout(() => {
      heavyDataReleaseTimer = null;
      releaseHeavyData();
    }, delayMs);
  };

  const markEntered = () => {
    isFirstEnter.value = false;
  };

  return {
    currentBehaviorTimeRange,
    stats,
    behaviorStats,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    qualityDistribution,
    formatDistribution,
    hasLoaded,
    isFirstEnter,
    ensureLoaded,
    refreshAll,
    refreshBehaviorOnly,
    fetchBehaviorStats,
    ensureQualityDistribution,
    ensureFormatDistribution,
    markEntered,
    releaseHeavyData,
    scheduleHeavyDataRelease,
    cancelHeavyDataRelease,
  };
});
