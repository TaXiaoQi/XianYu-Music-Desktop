
import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { statisticsApi } from '../tauri/statisticsApi';
import type { ListenDurations } from './leaderboardTypes';

const LOG = '[Leaderboard]';

const RESET_AT_KEY = 'listen_stats_last_reset_at';
const BASELINE_KEY = 'listen_stats_report_baseline';
const SERVER_SNAPSHOT_KEY = 'listen_stats_server_snapshot';

interface ReportBaseline extends ListenDurations {
  date: string;
  reported_at: number;
}

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
        return {
          total: j.total,
          daily: j.daily ?? 0,
          weekly: j.weekly ?? 0,
          date: j.date,
          reported_at: typeof j.reported_at === 'number' ? j.reported_at : 0,
        };
      }
    }
  } catch { /* 损坏时重建 */ }
  return { total: 0, daily: 0, weekly: 0, date: todayStr(), reported_at: 0 };
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

function pendingDelta(durations: ListenDurations, baseline: ReportBaseline): ListenDurations {
  return {
    total: Math.max(0, durations.total - baseline.total),
    daily: Math.max(0, durations.daily - baseline.daily),
    weekly: Math.max(0, durations.weekly - baseline.weekly),
  };
}

export async function getLocalListenDurations(): Promise<ListenDurations> {
  try {
    return await statisticsApi.getListenDurations();
  } catch {
    return { daily: 0, weekly: 0, total: 0 };
  }
}

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

async function reportListenDelta(
  uniqueSongsCount = 0,
): Promise<{ reset_at?: string } | null> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return null;

  try {
    const durations = await getLocalListenDurations();
    const baseline = loadBaseline();
    const today = todayStr();
    if (baseline.date !== today) {
      baseline.date = today;
      baseline.daily = 0;
      baseline.weekly = 0;
    }
    let delta = pendingDelta(durations, baseline);

    // 防全量重报护栏：baseline 丢失/重置时 delta 会等于本地全部历史累计。
    // 单次上报物理上限 = 自上次成功上报以来的墙钟时间 × 3 + 10 分钟（倍速与
    // 时钟误差余量；首次无时间戳给 10 分钟兜底，与服务端首报上限一致），
    // 超限截断——宁可少报，绝不重报。
    const elapsedSecs = baseline.reported_at > 0
      ? Math.max(0, Math.floor((Date.now() - baseline.reported_at) / 1000))
      : -1;
    const maxDelta = elapsedSecs >= 0 ? elapsedSecs * 3 + 600 : 600;
    if (delta.total > maxDelta) {
      delta = {
        total: maxDelta,
        daily: Math.min(delta.daily, maxDelta),
        weekly: Math.min(delta.weekly, maxDelta),
      };
    }

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
        duration: Math.floor(durations.total),
        elapsed_secs: elapsedSecs,
      },
      {
        fetchTimeoutMs: 8_000,
        timeoutMs: 10_000,
      },
    );

    if (data?.reset_at) {
      return { reset_at: data.reset_at };
    }

    // 响应回执对账：服务端确认量 = 回执总量 − 上次快照总量，两方对上账才推进
    // baseline；服务端截断/异常时只推进确认部分，剩余留本地追报
    const prevTotal = loadServerSnapshot()?.total ?? 0;
    const respTotal = Math.max(0, Math.floor(data?.server_total_duration ?? 0));
    const serverDelta = respTotal - prevTotal;
    const confirmedTotal = serverDelta >= 0 && serverDelta < Math.floor(delta.total)
      ? serverDelta
      : Math.floor(delta.total);
    const confirmedDaily = Math.min(Math.floor(delta.daily), confirmedTotal);
    const confirmedWeekly = Math.min(Math.floor(delta.weekly), confirmedTotal);
    baseline.total = baseline.total + confirmedTotal;
    baseline.daily = baseline.daily + confirmedDaily;
    baseline.weekly = baseline.weekly + confirmedWeekly;
    baseline.reported_at = Date.now();
    saveBaseline(baseline);
    saveServerSnapshot({
      total: respTotal,
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

async function handleResetSignal(resetAt: string): Promise<void> {
  try {
    await statisticsApi.resetLocalStatistics();
    localStorage.setItem(RESET_AT_KEY, resetAt);
    saveBaseline({ total: 0, daily: 0, weekly: 0, date: todayStr(), reported_at: 0 });
    saveServerSnapshot({ total: 0, daily: 0, weekly: 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 重置本地统计数据失败: ${msg}`);
  }
}

const REPORT_THROTTLE_MS = 30_000;
let lastReportAt = 0;

export async function reportAndHandleReset(): Promise<{ resetApplied: boolean }> {
  const now = Date.now();
  if (now - lastReportAt < REPORT_THROTTLE_MS) {
    return { resetApplied: false };
  }
  lastReportAt = now;
  const result = await reportListenDelta();
  if (result?.reset_at) {
    const lastResetAt = localStorage.getItem(RESET_AT_KEY);
    if (!lastResetAt || result.reset_at > lastResetAt) {
      await handleResetSignal(result.reset_at);
      await reportListenDelta();
      return { resetApplied: true };
    }
  }
  return { resetApplied: false };
}

export async function checkForResetSignal(_localDuration = 0): Promise<boolean> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return false;
  return (await reportAndHandleReset()).resetApplied;
}
