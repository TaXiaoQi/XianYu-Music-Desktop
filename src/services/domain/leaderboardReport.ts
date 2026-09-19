
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
