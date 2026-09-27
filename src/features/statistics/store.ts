// 统计页的 Pinia store：负责媒体库总量、行为统计与音质 / 格式分布的拉取与缓存，
// 并在页面离开一段时间后释放占内存较大的数据。
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { statisticsApi } from '../../services/tauri/statisticsApi';

/** 后端返回的媒体库总量统计（字段名与 Rust 侧序列化输出一致，勿改） */
export type LibraryStats = {
  total_songs: number; total_duration: number; total_file_size: number;
  album_count: number; artist_count: number;
  lossless_count: number; hires_count: number; this_month_added: number;
};

/** 热门单曲条目：value 为折算后的热度值 */
export type TopSong = { song_path: string; play_count: number; value: number };

/** 热门歌手条目 */
export type TopArtist = { artist: string; play_count: number };

/** 热门专辑条目 */
export type TopAlbum = { album: string; play_count: number };

/** 按时间范围聚合的用户行为统计 */
export type BehaviorStats = {
  total_plays: number; total_duration: number;
  top_songs: TopSong[]; top_songs_by_duration: TopSong[];
  top_artists: TopArtist[]; top_albums: TopAlbum[];
  hour_distribution: number[]; recent_activity: number[];
};

/** 音质档次分布 */
export type QualityDistribution = { hires: number; super_quality: number; high_quality: number; other: number };

/** 音频格式分布 */
export type FormatDistribution = {
  flac: number; mp3: number; alac: number; wav: number;
  aiff: number; aac: number; ogg: number; other: number;
};

export type TimeRangeType =
  | 'All'
  | 'Days7'
  | 'Days30'
  | 'ThisYear';

// 大体积统计数据在离开页面后保留的时长（毫秒）
const HEAVY_DATA_RELEASE_DELAY_MS = 60 * 1000;

function setupStatisticsStore() {
  const currentBehaviorTimeRange = ref<TimeRangeType>('Days7'), stats = ref<LibraryStats | null>(null);
  const behaviorStats = ref<BehaviorStats | null>(null), loading = ref(false);
  const error = ref<string | null>(null), lastUpdated = ref<Date | null>(null), isRefreshing = ref(false);
  const qualityDistribution = ref<QualityDistribution | null>(null), formatDistribution = ref<FormatDistribution | null>(null);
  const hasLoaded = ref(false), isFirstEnter = ref(true);
  let heavyDataReleaseTimer: null | ReturnType<typeof setTimeout> = null;

  // —— 小工具：收敛重复出现的状态写法 ——

  const adoptRange = (range: TimeRangeType) => { currentBehaviorTimeRange.value = range; };
  const stampUpdated = () => { lastUpdated.value = new Date(); };
  const markLoaded = () => { hasLoaded.value = true; };
  const stopLoading = () => { loading.value = false; };
  const failWith = (e: unknown) => { error.value = String(e); };

  // —— 基础拉取 ——

  async function loadLibraryStats() {
    const fresh = await statisticsApi.getLibraryStats();
    stats.value = fresh;
  }

  async function refreshStats() {
    await loadLibraryStats();
    stampUpdated();
    markLoaded();
  }

  async function fetchBehaviorStats(range: TimeRangeType) {
    behaviorStats.value = await statisticsApi.getBehaviorStats({ type: range });
  }

  // —— 组合动作 ——

  /** 进入统计页时调用：数据缺失才补拉，避免重复请求 */
  async function ensureLoaded(range: TimeRangeType = currentBehaviorTimeRange.value) {
    adoptRange(range);
    cancelHeavyDataRelease();

    const pending: Promise<unknown>[] = [];
    if (!stats.value) pending.push(loadLibraryStats());
    if (!behaviorStats.value) pending.push(fetchBehaviorStats(range));
    if (pending.length === 0) return;

    loading.value = true; error.value = null;
    try {
      await Promise.all(pending);
      stampUpdated(); markLoaded();
    } catch (e) {
      failWith(e);
    } finally {
      stopLoading();
    }
  }

  /** 强制刷新全部数据；失败时把错误写入 state 并继续向上抛出 */
  async function refreshAll(range: TimeRangeType = currentBehaviorTimeRange.value) {
    if (isRefreshing.value) return;
    adoptRange(range); isRefreshing.value = true; error.value = null;
    try {
      const requests = [loadLibraryStats(), fetchBehaviorStats(range)];
      await Promise.all(requests);
      stampUpdated(); markLoaded();
    } catch (e) {
      failWith(e); throw e;
    } finally {
      isRefreshing.value = false; stopLoading();
    }
  }

  /** 仅刷新行为统计，失败时同样写入错误并上抛 */
  async function refreshBehaviorOnly(range: TimeRangeType) {
    adoptRange(range);
    try {
      await fetchBehaviorStats(range);
      stampUpdated();
    } catch (e) {
      failWith(e); throw e;
    }
  }

  /** 惰性获取音质分布（未加载过才请求），并顺带取消释放计划 */
  async function ensureQualityDistribution() {
    cancelHeavyDataRelease(); qualityDistribution.value ??= await statisticsApi.getQualityDistribution();
    const ensured = qualityDistribution.value;
    return ensured;
  }

  /** 惰性获取格式分布，逻辑同上 */
  async function ensureFormatDistribution() {
    cancelHeavyDataRelease(); formatDistribution.value ??= await statisticsApi.getFormatDistribution();
    const ensured = formatDistribution.value;
    return ensured;
  }

  // —— 大数据释放策略 ——

  function releaseHeavyData() {
    stats.value = behaviorStats.value = qualityDistribution.value = formatDistribution.value = null;
  }

  function cancelHeavyDataRelease() {
    if (heavyDataReleaseTimer !== null) { clearTimeout(heavyDataReleaseTimer); heavyDataReleaseTimer = null; }
  }

  function scheduleHeavyDataRelease(delayMs: number = HEAVY_DATA_RELEASE_DELAY_MS) {
    cancelHeavyDataRelease(); const flush = () => {
      heavyDataReleaseTimer = null; releaseHeavyData();
    };
    heavyDataReleaseTimer = setTimeout(flush, delayMs);
  }

  function markEntered() {
    isFirstEnter.value = false;
  }

  return {
    // 响应式状态
    currentBehaviorTimeRange, stats, behaviorStats, loading, error, lastUpdated,
    isRefreshing, qualityDistribution, formatDistribution, hasLoaded, isFirstEnter,
    // 动作
    ensureLoaded, refreshAll, refreshStats, refreshBehaviorOnly, fetchBehaviorStats,
    ensureQualityDistribution, ensureFormatDistribution, markEntered,
    releaseHeavyData, scheduleHeavyDataRelease, cancelHeavyDataRelease,
  };
}

export const useStatisticsStore = defineStore('statistics', setupStatisticsStore);
