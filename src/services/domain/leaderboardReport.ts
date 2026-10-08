
import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { statisticsApi } from '../tauri/statisticsApi';
import type { ListenDurations } from './leaderboardTypes';

/**
 * 听歌时长 v2：事件流水 + 服务端唯一账本。
 *
 * 旧协议（本地 baseline + delta 上报 + 快照合并显示）已整体废弃：三个状态
 * 各自维护，任何一环断（弱网超时/快照未写入/回执缺字段）显示就与排行榜脱节。
 *
 * v2 原则：
 * 1. 客户端零账本——只产「听歌事件」流水（幂等 id + 秒数 + 发生时刻），
 *    服务端 INSERT IGNORE 去重入账；重发/多端并发/断网重试都不会算错账。
 * 2. 显示只读云端——统计页时长一律 = 服务端现算快照，与排行榜同源，
 *    结构上不可能再出现两处数字对不上。
 * 3. 队列是唯一需要持久化的状态——上报失败原样保留，幂等键保证不重不漏。
 */

const LOG = '[ListenEvents]';

const QUEUE_KEY = 'listen_events_queue_v2';
const SNAPSHOT_KEY = 'listen_stats_server_snapshot_v2';
const RESET_AT_KEY = 'listen_stats_last_reset_at';
const PENDING_RESET_AT_KEY = 'xianyumusic.pendingListenResetAt';
const PENDING_RESET_REASON_KEY = 'xianyumusic.pendingListenResetReason';
// 旧协议遗留键：一次性清理
const LEGACY_KEYS = [
  'listen_stats_report_baseline',
  'listen_stats_server_snapshot',
  'listen_stats_last_reset_at_legacy',
] as const;

export interface ListenServerSnapshot {
  total: number;
  daily: number;
  weekly: number;
  /** 快照归属账号：防止切换账号后读到别人的账 */
  uid: string;
}

interface ListenEvent {
  id: string;
  secs: number;
  ended_at: number;
}

// 单事件秒数上限：采样周期 60s，即使挂起恢复一次差值也不该超过 10 分钟，
// 超过视为本地表跳变（被清库/损坏），丢弃这笔宁少报
const MAX_EVENT_SECS = 600;
// 单批条数上限（与服务端一致）
const MAX_BATCH = 200;
// 队列上限：超过丢最老（防 localStorage 膨胀，宁可少报）
const MAX_QUEUE = 2000;
// 快照拉取网络节流
const SUMMARY_THROTTLE_MS = 30_000;
// reportAndHandleReset 对外节流（排行榜每次刷新都会调）
const REPORT_THROTTLE_MS = 30_000;
// 播放差值采样周期
const SAMPLE_INTERVAL_MS = 60_000;

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch { /* 老内核降级 */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function loadQueue(): ListenEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as ListenEvent[];
      if (Array.isArray(j)) {
        return j.filter(e => e && typeof e.id === 'string' && typeof e.secs === 'number' && e.secs > 0);
      }
    }
  } catch { /* 损坏时重建 */ }
  return [];
}

function saveQueue(q: ListenEvent[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch { /* 存储失败不影响主流程 */ }
}

function loadServerSnapshot(): ListenServerSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (raw) {
      const j = JSON.parse(raw) as ListenServerSnapshot;
      if (typeof j.total === 'number') return j;
    }
  } catch { /* 损坏时视为无快照 */ }
  return null;
}

function saveServerSnapshot(s: ListenServerSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s));
  } catch { /* 存储失败不影响主流程 */ }
}

function snapshotForMe(): ListenServerSnapshot | null {
  const uid = getCiyuanxiId();
  if (!uid) return null;
  const snap = loadServerSnapshot();
  return snap && snap.uid === uid ? snap : null;
}

export async function getLocalListenDurations(): Promise<ListenDurations> {
  try {
    return await statisticsApi.getListenDurations();
  } catch {
    return { daily: 0, weekly: 0, total: 0 };
  }
}

// ==================== 事件采样：本地听歌时长表差值 → 事件 ====================
// 本地表（Rust 侧累计，已处理播放/暂停/seek 边界）是采样源；TS 只做
// 「读数 → 差值 → 事件」。基点只需存内存：重启后首次读数差为 0，
// 未上报的余额已在持久化队列里，不重不漏。

let lastSampledTotal: number | null = null;
let samplerStarted = false;

function enqueueEvent(secs: number): void {
  if (secs <= 0) return;
  const queue = loadQueue();
  queue.push({ id: genId(), secs: Math.min(secs, MAX_EVENT_SECS), ended_at: Math.floor(Date.now() / 1000) });
  if (queue.length > MAX_QUEUE) {
    queue.splice(0, queue.length - MAX_QUEUE);
    console.warn(`${LOG} 事件队列超限，丢弃最老事件`);
  }
  saveQueue(queue);
  // 有新事件时立刻尝试上报（flush 内部有并发闸，弱网下原样保留队列）
  void flushListenEvents();
}

async function sampleOnce(): Promise<void> {
  const durations = await getLocalListenDurations();
  if (lastSampledTotal !== null) {
    const diff = Math.floor(durations.total - lastSampledTotal);
    if (diff > 0 && diff <= MAX_EVENT_SECS) {
      enqueueEvent(diff);
    } else if (diff > MAX_EVENT_SECS) {
      // 本地表跳变（清库/异常）：丢弃差值，重建基点，绝不重报历史
      console.warn(`${LOG} 本地听歌时长跳变 ${lastSampledTotal} -> ${durations.total}，差值丢弃`);
    }
  }
  lastSampledTotal = durations.total;
}

function ensureSamplerStarted(): void {
  if (samplerStarted) return;
  samplerStarted = true;
  for (const k of LEGACY_KEYS) {
    try { localStorage.removeItem(k); } catch { /* 忽略 */ }
  }
  void sampleOnce().catch(() => undefined);
  setInterval(() => {
    void sampleOnce().catch(() => undefined);
  }, SAMPLE_INTERVAL_MS);
}

// ==================== 上报：批量事件 → 服务端幂等入账 ====================

let flushBusy = false;

export async function flushListenEvents(): Promise<{ resetApplied: boolean; snapshotFresh: boolean }> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId || flushBusy) return { resetApplied: false, snapshotFresh: false };
  flushBusy = true;
  try {
    const queue = loadQueue();
    if (queue.length === 0) {
      return { resetApplied: false, snapshotFresh: false };
    }
    const batch = queue.slice(0, MAX_BATCH);
    const data = await signedRequest<{
      reset_at?: string;
      reason?: string;
      server_total_duration?: number;
      server_daily_duration?: number;
      server_weekly_duration?: number;
    }>(
      'report_listen_events',
      {
        ciyuanxi_id: ciyuanxiId,
        batch_id: genId(),
        events: batch,
      },
      {
        // 弱网下 8s 频繁超时会让队列积压、显示滞后；放宽到 15s 与移动端对齐
        fetchTimeoutMs: 15_000,
        timeoutMs: 17_000,
      },
    );

    if (data?.reset_at) {
      await handleResetSignal(data.reset_at, data.reason ?? '');
      return { resetApplied: true, snapshotFresh: false };
    }

    // 成功回执：删掉已发送的最老 batch.length 条（期间新采样入队的事件
    // 追加在尾部，不受影响；服务端已全部幂等处理，无需逐条确认）
    const latest = loadQueue();
    saveQueue(latest.slice(batch.length));
    saveServerSnapshot({
      total: Math.max(0, Math.floor(data?.server_total_duration ?? 0)),
      daily: Math.max(0, Math.floor(data?.server_daily_duration ?? 0)),
      weekly: Math.max(0, Math.floor(data?.server_weekly_duration ?? 0)),
      uid: ciyuanxiId,
    });
    summaryFetchedAt = Date.now();
    return { resetApplied: false, snapshotFresh: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG} 事件上报失败（队列保留，稍后重试）: ${msg}`);
    return { resetApplied: false, snapshotFresh: false };
  } finally {
    flushBusy = false;
  }
}

async function handleResetSignal(resetAt: string, reason: string): Promise<void> {
  try {
    await statisticsApi.resetLocalStatistics();
    localStorage.setItem(RESET_AT_KEY, resetAt);
    // 重置通知：useListenResetNotification 按 epoch 秒消费，且 reason 非空才弹出
    const atMs = new Date(resetAt).getTime();
    const atSec = Number.isFinite(atMs) && atMs > 0 ? Math.floor(atMs / 1000) : Math.floor(Date.now() / 1000);
    localStorage.setItem(PENDING_RESET_AT_KEY, String(atSec));
    localStorage.setItem(PENDING_RESET_REASON_KEY, reason);
    saveQueue([]);
    lastSampledTotal = null; // 本地表刚被清空，重采基点
    saveServerSnapshot({ total: 0, daily: 0, weekly: 0, uid: getCiyuanxiId() ?? '' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 重置本地统计数据失败: ${msg}`);
  }
}

// ==================== 显示：一律读云端快照 ====================

let summaryFetchedAt = 0;

async function pullSummary(): Promise<void> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return;
  const now = Date.now();
  if (now - summaryFetchedAt < SUMMARY_THROTTLE_MS) return;
  summaryFetchedAt = now;
  const data = await signedRequest<{
    server_total_duration?: number;
    server_daily_duration?: number;
    server_weekly_duration?: number;
  }>('get_listen_stats_summary', { ciyuanxi_id: ciyuanxiId });
  saveServerSnapshot({
    total: Math.max(0, Math.floor(data?.server_total_duration ?? 0)),
    daily: Math.max(0, Math.floor(data?.server_daily_duration ?? 0)),
    weekly: Math.max(0, Math.floor(data?.server_weekly_duration ?? 0)),
    uid: ciyuanxiId,
  });
}

function snapshotToDurations(snap: ListenServerSnapshot): ListenDurations {
  // 显示 = 云端快照 + 队列未入账余额：离线/弱网期间数字照常反映真实播放；
  // 联网回执成功那一刻余额被新快照覆盖归零，数值连续且与排行榜最终一致
  let pendingTotal = 0;
  let pendingDaily = 0;
  const todayUtc8 = utc8DayKey(Date.now());
  for (const e of loadQueue()) {
    const secs = Math.floor(e.secs);
    if (secs <= 0) continue;
    pendingTotal += secs;
    if (utc8DayKey(e.ended_at * 1000) === todayUtc8) pendingDaily += secs;
  }
  return {
    total: snap.total + pendingTotal,
    daily: snap.daily + pendingDaily,
    weekly: snap.weekly,
  };
}

// 东八区日期键（ YYYY-MM-DD ）：余额的 daily 部分只计入今天的事件
function utc8DayKey(ms: number): string {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getListenStatsDisplay(): Promise<ListenDurations> {
  ensureSamplerStarted();
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return getLocalListenDurations();
  const cached = snapshotForMe();
  if (cached && Date.now() - summaryFetchedAt < SUMMARY_THROTTLE_MS) {
    return snapshotToDurations(cached);
  }
  try {
    await pullSummary();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG} 拉取云端听歌统计失败，回退上次快照/本地口径: ${msg}`);
  }
  const snap = snapshotForMe();
  // 云端快照从来没拿到过（首次登录且断网）才退回本地口径，仅作兜底
  return snap ? snapshotToDurations(snap) : getLocalListenDurations();
}

// 登录/自动同步后主动上报积压事件并拉一次云端现算值写显示快照。
// flush 成功时回执自带最新快照，无需再发 summary 请求。
export async function fetchServerListenSummary(): Promise<void> {
  ensureSamplerStarted();
  const r = await flushListenEvents();
  if (!r.snapshotFresh) {
    await pullSummary().catch(() => undefined);
  }
}

// 兼容旧心跳调用方（autoSync.ts）：[skipIfFresh] = 30s 内刚刷新过快照则跳过。
export async function pullListenServerSnapshot(skipIfFresh = false): Promise<void> {
  if (skipIfFresh && Date.now() - summaryFetchedAt < SUMMARY_THROTTLE_MS) return;
  await fetchServerListenSummary();
}

let lastReportAt = 0;

export async function reportAndHandleReset(): Promise<{ resetApplied: boolean }> {
  const now = Date.now();
  if (now - lastReportAt < REPORT_THROTTLE_MS) {
    return { resetApplied: false };
  }
  lastReportAt = now;
  ensureSamplerStarted();
  return flushListenEvents();
}

export async function checkForResetSignal(_localDuration = 0): Promise<boolean> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return false;
  return (await reportAndHandleReset()).resetApplied;
}
