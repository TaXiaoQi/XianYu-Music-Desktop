
import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { reportAndHandleReset } from './leaderboardReport';
import type { LeaderboardData, LeaderboardEntry, LeaderboardPeriod } from './leaderboardTypes';

const LOG = '[Leaderboard]';

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

export async function fetchAllLeaderboards(
  limit = 15,
): Promise<{
  daily: LeaderboardData;
  weekly: LeaderboardData;
  total: LeaderboardData;
  resetApplied?: boolean;
}> {
  const ciyuanxiId = getCiyuanxiId();
  const reportPromise: Promise<{ resetApplied: boolean }> = ciyuanxiId
    ? reportAndHandleReset()
    : Promise.resolve({ resetApplied: false });

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

    if (!data.leaderboards) {
      const [daily, weekly, total] = await Promise.all([
        fetchLeaderboard(limit, 'daily'),
        fetchLeaderboard(limit, 'weekly'),
        fetchLeaderboard(limit, 'total'),
      ]);
      const { resetApplied } = await reportPromise;
      return { daily, weekly, total, resetApplied };
    }

    const { resetApplied } = await reportPromise;
    return {
      daily: mapLeaderboardPayload(data.leaderboards.daily, ciyuanxiId),
      weekly: mapLeaderboardPayload(data.leaderboards.weekly, ciyuanxiId),
      total: mapLeaderboardPayload(data.leaderboards.total, ciyuanxiId),
      resetApplied,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 获取排行榜失败:`, msg);
    throw e;
  }
}

export async function fetchLeaderboard(
  limit = 50,
  period: LeaderboardPeriod = 'total',
): Promise<LeaderboardData & { resetApplied?: boolean }> {
  const ciyuanxiId = getCiyuanxiId();

  const reportPromise: Promise<{ resetApplied: boolean }> = ciyuanxiId
    ? reportAndHandleReset()
    : Promise.resolve({ resetApplied: false });

  try {
    const data = await signedRequest<LeaderboardPeriodPayload>('get_leaderboard', {
      ...(ciyuanxiId ? { ciyuanxi_id: ciyuanxiId } : {}),
      limit,
      period,
    }, {
      fetchTimeoutMs: 12_000,
      timeoutMs: 15_000,
    });

    const { resetApplied } = await reportPromise;
    return {
      ...mapLeaderboardPayload(data, ciyuanxiId),
      resetApplied,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 获取排行榜失败:`, msg);
    throw e;
  }
}