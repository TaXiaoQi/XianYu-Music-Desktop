/**
 * 听歌排行榜服务
 *
 * 调用后端 `api/index.php` 的 `get_leaderboard` 接口，
 * 获取听歌时长排行榜数据（Top N + 当前用户排名）。
 *
 * 在获取排行榜前，先将本地统计的听歌时长上报到后端（report_listen_stats），
 * 确保云端数据与本地一致。
 *
 * 上报时同时发送 daily/weekly/total 三个周期的时长，
 * 后端按 period 参数分别统计日榜、周榜、总榜。
 *
 * 复用 authService 的签名机制（MD5）。
 */

import { signedRequest } from './auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { statisticsApi } from './tauri/statisticsApi';

/** 日志前缀 */
const LOG = '[Leaderboard]';

/** localStorage 键名，存储最近一次服务端重置时间戳 */
const RESET_AT_KEY = 'listen_stats_last_reset_at';

/** 排行榜样条目 */
export interface LeaderboardEntry {
  rank: number;
  username: string;
  nickname: string;
  /** 弦予号：收藏/歌单同步的查询键 */
  ciyuanxi_id?: string;
  avatar?: string;
  /** 听歌时长（秒） */
  duration: number;
  /** 是否为当前登录用户 */
  isMe?: boolean;
}

/** 排行榜 API 响应 */
export interface LeaderboardData {
  /** Top N 排行列表 */
  leaderboard: LeaderboardEntry[];
  /** 当前用户的排名信息（可能不在 Top N 中） */
  me: LeaderboardEntry | null;
  /** 参与排行的总用户数 */
  totalUsers: number;
}

/** 三个周期的听歌时长（秒） */
export interface ListenDurations {
  daily: number;
  weekly: number;
  total: number;
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
async function reportAndHandleReset(
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

/** 排行榜时间周期 */
export type LeaderboardPeriod = 'daily' | 'weekly' | 'total';

/** 后端单个周期的原始响应结构（snake_case） */
interface LeaderboardPeriodPayload {
  leaderboard: Array<{
    rank: number;
    username: string;
    nickname: string;
    ciyuanxi_id?: string;
    avatar: string;
    duration: number;
    is_me: boolean;
  }>;
  me: {
    rank: number;
    username: string;
    nickname: string;
    ciyuanxi_id?: string;
    avatar: string;
    duration: number;
    is_me: boolean;
  } | null;
  total_users: number;
  period?: string;
}

/** 将后端 snake_case 响应映射为前端 camelCase 结构 */
function mapLeaderboardPayload(data: LeaderboardPeriodPayload, ciyuanxiId: string | null): LeaderboardData {
  const leaderboard: LeaderboardEntry[] = (data.leaderboard ?? []).map(item => ({
    rank: item.rank,
    username: item.username,
    nickname: item.nickname || item.username,
    ciyuanxi_id: item.ciyuanxi_id,
    avatar: item.avatar || undefined,
    duration: item.duration,
    isMe: Boolean(ciyuanxiId && item.is_me),
  }));

  let me: LeaderboardEntry | null = null;
  if (ciyuanxiId && data.me) {
    me = {
      rank: data.me.rank,
      username: data.me.username,
      nickname: data.me.nickname || data.me.username,
      ciyuanxi_id: data.me.ciyuanxi_id,
      avatar: data.me.avatar || undefined,
      duration: data.me.duration,
      isMe: true,
    };
  }

  return {
    leaderboard,
    me,
    totalUsers: data.total_users ?? leaderboard.length,
  };
}

/**
 * 批量获取日/周/总三榜（period=all）
 *
 * 后端一次返回三榜数据，将原来的 3 次网络往返合并为 1 次，
 * 显著减少远程服务器（RTT 较高）下的排行榜加载等待。
 * 后端不支持 period=all 时自动回退为三次并行请求。
 *
 * @param limit 每榜返回的排行数量，默认 15
 * @param durations 三个周期的听歌时长，上报到后端用于分周期排行榜
 */
export async function fetchAllLeaderboards(
  limit = 15,
  durations?: ListenDurations,
): Promise<{
  daily: LeaderboardData;
  weekly: LeaderboardData;
  total: LeaderboardData;
  resetApplied?: boolean;
  /** 本次上报是否把本地总时长抬高了（云端更长，需要刷新统计展示） */
  cloudMerged?: boolean;
}> {
  const ciyuanxiId = getCiyuanxiId();
  // 上报与拉榜并行：上报带 30s 节流、失败已在内部吞掉，串行等待只会把一次网络往返
  // （远程服务器 RTT 较高）叠加进排行榜首屏时间；服务端榜单本身也有 30s 缓存
  const reportPromise: Promise<{ resetApplied: boolean; cloudMerged: boolean }> = ciyuanxiId
    ? reportAndHandleReset(durations ?? { daily: 0, weekly: 0, total: 0 })
    : Promise.resolve({ resetApplied: false, cloudMerged: false });

  try {
    const data = await signedRequest<{
      leaderboards?: Record<LeaderboardPeriod, LeaderboardPeriodPayload>;
    }>('get_leaderboard', {
      ...(ciyuanxiId ? { ciyuanxi_id: ciyuanxiId } : {}),
      limit,
      period: 'all',
    }, {
      fetchTimeoutMs: 12_000,
      timeoutMs: 15_000,
    });

    // 旧后端不支持 period=all 时回退为三次并行请求（上报已被 30s 节流，不会重复）
    if (!data.leaderboards) {
      const [daily, weekly, total] = await Promise.all([
        fetchLeaderboard(limit, undefined, 'daily'),
        fetchLeaderboard(limit, undefined, 'weekly'),
        fetchLeaderboard(limit, undefined, 'total'),
      ]);
      const { resetApplied, cloudMerged } = await reportPromise;
      return { daily, weekly, total, resetApplied, cloudMerged };
    }

    const { resetApplied, cloudMerged } = await reportPromise;
    return {
      daily: mapLeaderboardPayload(data.leaderboards.daily, ciyuanxiId),
      weekly: mapLeaderboardPayload(data.leaderboards.weekly, ciyuanxiId),
      total: mapLeaderboardPayload(data.leaderboards.total, ciyuanxiId),
      resetApplied,
      cloudMerged,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 获取排行榜失败:`, msg);
    throw e;
  }
}

/**
 * 获取听歌排行榜
 *
 * 上报本地听歌时长（日/周/总）与拉取排行榜并行发起（上报带 30s 节流），
 * 避免把上报往返叠加进加载等待。
 *
 * @param limit 返回的排行数量，默认 50
 * @param durations 三个周期的听歌时长，上报到后端用于分周期排行榜
 * @param period 排行榜时间周期：daily（日榜）、weekly（周榜）、total（总榜），默认 total
 */
export async function fetchLeaderboard(
  limit = 50,
  durations?: ListenDurations,
  period: LeaderboardPeriod = 'total',
): Promise<LeaderboardData & { resetApplied?: boolean; cloudMerged?: boolean }> {
  const ciyuanxiId = getCiyuanxiId();

  // 记录本次调用是否实际触发了本地统计重置（供调用方刷新本地统计展示）
  // 上报与拉榜并行：只有登录用户才上报，且上报带 30s 节流、失败已在内部吞掉
  const reportPromise: Promise<{ resetApplied: boolean; cloudMerged: boolean }> = ciyuanxiId
    ? reportAndHandleReset(durations ?? { daily: 0, weekly: 0, total: 0 })
    : Promise.resolve({ resetApplied: false, cloudMerged: false });

  try {
    const data = await signedRequest<LeaderboardPeriodPayload>('get_leaderboard', {
      ...(ciyuanxiId ? { ciyuanxi_id: ciyuanxiId } : {}),
      limit,
      period,
    }, {
      fetchTimeoutMs: 12_000,
      timeoutMs: 15_000,
    });

    const { resetApplied, cloudMerged } = await reportPromise;
    return {
      ...mapLeaderboardPayload(data, ciyuanxiId),
      resetApplied,
      cloudMerged,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 获取排行榜失败:`, msg);
    throw e;
  }
}
