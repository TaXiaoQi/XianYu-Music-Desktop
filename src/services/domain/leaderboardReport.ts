/**
 * 听歌排行榜 · 本地时长获取与增量上报/重置。
 *
 * 统一 delta 协议（stats_mode="delta"）：客户端只上报自上次成功上报后的
 * 增量，服务端做合计并回传账号累计/今日/本周三个真源值。多端显示统一以
 * 「服务端值 + 本端未上报增量」为准，天然一致，不再使用 GREATEST 合并。
 */

import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { statisticsApi } from '../tauri/statisticsApi';
import type { ListenDurations } from './leaderboardTypes';

/** 日志前缀 */
const LOG = '[Leaderboard]';

/** localStorage 键名，存储最近一次服务端重置时间戳 */
const RESET_AT_KEY = 'listen_stats_last_reset_at';
/** delta 上报基线：上次成功上报时的本地累计快照 */
const BASELINE_KEY = 'listen_stats_report_baseline';
/** 服务端回显快照：账号累计/今日/本周真源值（显示用） */
const SERVER_SNAPSHOT_KEY = 'listen_stats_server_snapshot';

/** 本地累计基线（含日期标记：跨天时 daily/weekly 基线清零） */
interface ReportBaseline extends ListenDurations {
  date: string;
}

/** 服务端回显的账号三周期真源值（秒） */
export interface ListenServerSnapshot {
  total: number;
  daily: number;
  weekly: number;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadBaseline(): ReportBaseline {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as ReportBaseline;
      if (typeof j.date === 'string' && typeof j.total === 'number') {
        return { total: j.total, daily: j.daily ?? 0, weekly: j.weekly ?? 0, date: j.date };
      }
    }
  } catch { /* 损坏时重建 */ }
  return { total: 0, daily: 0, weekly: 0, date: todayStr() };
}

function saveBaseline(b: ReportBaseline): void {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(b));
  } catch { /* 存储失败不影响主流程 */ }
}

function loadServerSnapshot(): ListenServerSnapshot | null {
  try {
    const raw = localStorage.getItem(SERVER_SNAPSHOT_KEY);
    if (raw) {
      const j = JSON.parse(raw) as ListenServerSnapshot;
      if (typeof j.total === 'number') return j;
    }
  } catch { /* 损坏时视为无快照 */ }
  return null;
}

function saveServerSnapshot(s: ListenServerSnapshot): void {
  try {
    localStorage.setItem(SERVER_SNAPSHOT_KEY, JSON.stringify(s));
  } catch { /* 存储失败不影响主流程 */ }
}

/** 待处理增量（本地累计 - 已上报基线，跨天时 daily/weekly 基线已清零） */
function pendingDelta(durations: ListenDurations, baseline: ReportBaseline): ListenDurations {
  return {
    total: Math.max(0, durations.total - baseline.total),
    daily: Math.max(0, durations.daily - baseline.daily),
    weekly: Math.max(0, durations.weekly - baseline.weekly),
  };
}

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
 * 多端一致的显示值：服务端真源 + 本端未上报增量。
 * 未登录/从未同步过时回退本地累计。
 */
export async function getListenStatsDisplay(): Promise<ListenDurations> {
  const durations = await getLocalListenDurations();
  if (!getCiyuanxiId()) return durations;
  const baseline = loadBaseline();
  if (baseline.date !== todayStr()) {
    baseline.daily = 0;
    baseline.weekly = 0;
  }
  if (baseline.total <= 0 && baseline.daily <= 0 && baseline.weekly <= 0) return durations;
  const snap = loadServerSnapshot();
  if (!snap) return durations;
  const pending = pendingDelta(durations, baseline);
  return {
    total: snap.total + Math.floor(pending.total),
    daily: snap.daily + Math.floor(pending.daily),
    weekly: snap.weekly + Math.floor(pending.weekly),
  };
}

/**
 * 增量上报本地听歌时长到后端（report_listen_stats，stats_mode=delta）
 *
 * 只发送自上次成功上报后的增量；服务端合计后回传
 * server_total_duration / server_daily_duration / server_weekly_duration。
 * 服务端存在待处理重置信号时返回 reset_at（客户端清本地统计与基线）。
 *
 * @returns 重置信号时间戳
 */
async function reportListenDelta(
  uniqueSongsCount = 0,
): Promise<{ reset_at?: string } | null> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return null;

  try {
    const durations = await getLocalListenDurations();
    const baseline = loadBaseline();
    const today = todayStr();
    // 跨天：daily/weekly 基线清零（本地累计本身也按日重计）
    if (baseline.date !== today) {
      baseline.date = today;
      baseline.daily = 0;
      baseline.weekly = 0;
    }
    const delta = pendingDelta(durations, baseline);

    const data = await signedRequest<{
      reset_at?: string;
      server_total_duration?: number;
      server_daily_duration?: number;
      server_weekly_duration?: number;
    }>(
      'report_listen_stats',
      {
        ciyuanxi_id: ciyuanxiId,
        stats_mode: 'delta',
        delta_duration: Math.floor(delta.total),
        delta_daily_duration: Math.floor(delta.daily),
        delta_songs: uniqueSongsCount,
        // 兼容字段：旧后端在无 stats_mode 时使用；新后端忽略
        duration: Math.floor(durations.total),
      },
      {
        fetchTimeoutMs: 8_000,
        timeoutMs: 10_000,
      },
    );

    if (data?.reset_at) {
      return { reset_at: data.reset_at };
    }

    // 成功：基线推进到当前本地累计，保存服务端回显快照
    baseline.total = durations.total;
    baseline.daily = durations.daily;
    baseline.weekly = durations.weekly;
    saveBaseline(baseline);
    saveServerSnapshot({
      total: Math.max(0, Math.floor(data?.server_total_duration ?? 0)),
      daily: Math.max(0, Math.floor(data?.server_daily_duration ?? 0)),
      weekly: Math.max(0, Math.floor(data?.server_weekly_duration ?? 0)),
    });
    return {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG} 上报听歌时长失败（不影响排行榜获取）: ${msg}`);
    return null;
  }
}

/**
 * 检查服务端是否下发了重置信号，如果是则清空本地统计数据与基线
 */
async function handleResetSignal(resetAt: string): Promise<void> {
  try {
    await statisticsApi.resetLocalStatistics();
    localStorage.setItem(RESET_AT_KEY, resetAt);
    saveBaseline({ total: 0, daily: 0, weekly: 0, date: todayStr() });
    saveServerSnapshot({ total: 0, daily: 0, weekly: 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 重置本地统计数据失败: ${msg}`);
  }
}

/** 上报听歌时长的节流间隔：频繁切换排行榜周期时避免每次都重复上报 */
const REPORT_THROTTLE_MS = 30_000;
let lastReportAt = 0;

/**
 * 增量上报本地听歌时长，并处理服务端下发的重置信号。
 * 若检测到新的重置信号，会清空本地统计并重新上报同步服务端。
 *
 * 上报带 30s 节流：排行榜周期切换/首页轮询都会触发上报，
 * 短时间内重复上报对排名更新无意义，跳过可显著减少切换等待。
 *
 * @returns 是否实际触发了本地统计重置
 */
export async function reportAndHandleReset(): Promise<{ resetApplied: boolean }> {
  const now = Date.now();
  if (now - lastReportAt < REPORT_THROTTLE_MS) {
    return { resetApplied: false };
  }
  lastReportAt = now;
  const result = await reportListenDelta();
  // 检查是否有服务端下发的重置信号
  if (result?.reset_at) {
    const lastResetAt = localStorage.getItem(RESET_AT_KEY);
    if (!lastResetAt || result.reset_at > lastResetAt) {
      await handleResetSignal(result.reset_at);
      // 重置后立即上报一次（本地与基线已清零，delta=0，拉取服务端新快照）
      await reportListenDelta();
      return { resetApplied: true };
    }
  }
  return { resetApplied: false };
}

/**
 * 主动检查服务端是否有待处理的重置信号（用于首页定时轮询）。
 *
 * @param _localDuration 兼容旧签名（已不使用，delta 由基线计算）
 * @returns 是否实际触发了本地统计重置
 */
export async function checkForResetSignal(_localDuration = 0): Promise<boolean> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return false;
  return (await reportAndHandleReset()).resetApplied;
}
