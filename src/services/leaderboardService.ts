/**
 * 听歌排行榜服务
 *
 * 调用后端 `api/index.php` 的 `get_leaderboard` 接口，
 * 获取听歌时长排行榜数据（Top N + 当前用户排名）。
 *
 * 复用 authService 的签名机制（MD5）。
 */

import { signedRequest } from './auth/authService';
import { getCiyuanxiId } from './playlistSync';

/** 日志前缀 */
const LOG = '[Leaderboard]';

/** 排行榜样条目 */
export interface LeaderboardEntry {
  rank: number;
  username: string;
  nickname: string;
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

/**
 * 获取听歌排行榜
 * @param limit 返回的排行数量，默认 50
 */
export async function fetchLeaderboard(limit = 50): Promise<LeaderboardData> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    console.warn(`${LOG} 未登录，无法获取排行榜`);
    return { leaderboard: [], me: null, totalUsers: 0 };
  }

  try {
    const data = await signedRequest<{
      leaderboard: Array<{
        rank: number;
        username: string;
        nickname: string;
        avatar: string;
        duration: number;
        is_me: boolean;
      }>;
      me: {
        rank: number;
        username: string;
        nickname: string;
        avatar: string;
        duration: number;
        is_me: boolean;
      } | null;
      total_users: number;
    }>('get_leaderboard', {
      ciyuanxi_id: ciyuanxiId,
      limit,
    });

    // 映射后端 snake_case → 前端 camelCase
    const leaderboard: LeaderboardEntry[] = (data.leaderboard ?? []).map(item => ({
      rank: item.rank,
      username: item.username,
      nickname: item.nickname || item.username,
      avatar: item.avatar || undefined,
      duration: item.duration,
      isMe: item.is_me,
    }));

    let me: LeaderboardEntry | null = null;
    if (data.me) {
      me = {
        rank: data.me.rank,
        username: data.me.username,
        nickname: data.me.nickname || data.me.username,
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 获取排行榜失败:`, msg);
    throw e;
  }
}
