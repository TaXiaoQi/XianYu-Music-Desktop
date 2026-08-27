/**
 * 听歌排行榜 · 拉取与响应映射。
 */

import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { reportAndHandleReset } from './leaderboardReport';
import type { LeaderboardData, LeaderboardEntry, LeaderboardPeriod, ListenDurations } from './leaderboardTypes';

/** 日志前缀 */
const LOG = '[Leaderboard]';

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