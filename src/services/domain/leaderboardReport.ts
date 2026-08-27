/**
 * 听歌排行榜 · 本地时长获取与上报/重置。
 */

import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { statisticsApi } from '../tauri/statisticsApi';
import type { ListenDurations } from './leaderboardTypes';

/** 日志前缀 */
const LOG = '[Leaderboard]';

/** localStorage 键名，存储最近一次服务端重置时间戳 */
const RESET_AT_KEY = 'listen_stats_last_reset_at';

/**
 * 从本地统计获取日/周/总三个周期的听歌时长
 */
export async function getLocalListenDurations(): Promise<ListenDurations> {
  try {
    return await statisticsApi.getListenDurations();
  } catch {
    return { daily: 0, weekly: 0, total: 0 };
  }
}

/**
 * 上报本地听歌时长到后端（report_listen_stats）
 *
 * 同时发送 daily/weekly/total 三个周期的时长，后端分别存储用于不同周期的排行榜。
 * `duration` 字段保持为 total 值以兼容旧后端（最大值覆盖策略）。
 * 服务端用 GREATEST 对累计总时长做最大值合并，并在响应中返回合并后的
 * server_total_duration；这里把它并回本地（取较大值），实现「云端长覆盖本地」，
 * 「本地长覆盖云端」由服务端 GREATEST 完成，达成多端总播放时长双向对齐。
 * 如果服务端存在待处理的重置信号，会返回 reset_at 时间戳。
 *
 * @param durations 三个周期的听歌时长
 * @param uniqueSongsCount 本地累计聆听新歌数（可选）
 * @returns 重置信号时间戳 + 本次上报是否把本地总时长抬高了（云端更长）
 */
async function reportListenDuration(
  durations: ListenDurations,
  uniqueSongsCount = 0,
): Promise<{ reset_at?: string; cloudMerged: boolean } | null> {
  const ciyuanxiId = getCiyuanxiId();
  // 允许上报 0：即使本地时长为 0，也需要上报以获取服务端待处理的重置信号。
  if (!ciyuanxiId) return null;

  try {
    const data = await signedRequest<{ reset_at?: string; server_total_duration?: number }>(
      'report_listen_stats',
      {
        ciyuanxi_id: ciyuanxiId,
        // 兼容字段：旧后端使用 duration（总时长，最大值覆盖）
        duration: Math.floor(durations.total),
        // 新字段：分周期时长，后端分别存储
        daily_duration: Math.floor(durations.daily),
        weekly_duration: Math.floor(durations.weekly),
        total_duration: Math.floor(durations.total),
        unique_songs_count: uniqueSongsCount,
      },
      {
        fetchTimeoutMs: 8_000,
        timeoutMs: 10_000,
      },
    );

    // 用服务端（GREATEST 合并后）的总时长抬高本地：云端更长则以云端覆盖本地
    let cloudMerged = false;
    const cloudTotal = data && typeof data.server_total_duration === 'number'
      ? Math.floor(data.server_total_duration)
      : 0;
    if (cloudTotal > 0) {
      try {
        const merged = await statisticsApi.mergeCloudListenDuration(cloudTotal);
        cloudMerged = merged.merged;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`${LOG} 合并云端总时长到本地失败（忽略）: ${msg}`);
      }
    }

    return {
      ...(data?.reset_at ? { reset_at: data.reset_at } : {}),
      cloudMerged,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG} 上报听歌时长失败（不影响排行榜获取）: ${msg}`);
    return null;
  }
}

/**
 * 检查服务端是否下发了重置信号，如果是则清空本地统计数据
 */
async function handleResetSignal(resetAt: string): Promise<void> {
  try {
    await statisticsApi.resetLocalStatistics();
    localStorage.setItem(RESET_AT_KEY, resetAt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 重置本地统计数据失败: ${msg}`);
  }
}

/** 上报听歌时长的节流间隔：频繁切换排行榜周期时避免每次都重复上报 */
const REPORT_THROTTLE_MS = 30_000;
let lastReportAt = 0;

/**
 * 上报本地听歌时长，并处理服务端下发的重置信号。
 * 若检测到更新重置信号，会清空本地统计并重新上报 0 同步服务端，返回 true。
 *
 * 上报带 30s 节流：排行榜周期切换/首页轮询都会触发上报，
 * 短时间内重复上报对排名更新无意义，跳过可显著减少切换等待。
 *
 * @param durations 三个周期的听歌时长
 * @returns 是否实际触发了本地统计重置 + 本次上报是否把本地总时长抬高（云端更长）
 */
export async function reportAndHandleReset(
  durations: ListenDurations,
): Promise<{ resetApplied: boolean; cloudMerged: boolean }> {
  const now = Date.now();
  if (now - lastReportAt < REPORT_THROTTLE_MS) {
    return { resetApplied: false, cloudMerged: false };
  }
  lastReportAt = now;
  const result = await reportListenDuration(durations);
  let cloudMerged = result?.cloudMerged ?? false;
  // 检查是否有服务端下发的重置信号
  if (result?.reset_at) {
    const lastResetAt = localStorage.getItem(RESET_AT_KEY);
    if (!lastResetAt || result.reset_at > lastResetAt) {
      await handleResetSignal(result.reset_at);
      // 重置后重新上报（此时本地数据已清零，上报 0 确保服务端同步）
      await reportListenDuration({ daily: 0, weekly: 0, total: 0 }, 0);
      return { resetApplied: true, cloudMerged };
    }
  }
  return { resetApplied: false, cloudMerged };
}

/**
 * 主动检查服务端是否有待处理的重置信号（用于首页定时轮询）。
 * 会将当前本地时长上报给服务端，若检测到重置信号则清空本地统计并返回 true。
 *
 * @param localDuration 本地累计听歌时长（秒），向后兼容
 * @returns 是否实际触发了本地统计重置
 */
export async function checkForResetSignal(localDuration: number): Promise<boolean> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return false;
  // 向后兼容：localDuration 作为 total，daily/weekly 由本地统计补全
  const durations = await getLocalListenDurations();
  return (await reportAndHandleReset({ ...durations, total: localDuration || durations.total })).resetApplied;
}