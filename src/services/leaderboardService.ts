/**
 * 听歌排行榜服务
 *
 * 调用后端 `api/index.php` 的 `get_leaderboard` 接口，
 * 获取听歌时长排行榜数据（Top N + 当前用户排名）。
 *
 * 在获取排行榜前，先将本地统计的听歌时长上报到后端（report_listen_stats），
 * 确保云端数据与本地一致。
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
 * 上报本地听歌时长到后端（report_listen_stats）
 * 后端采用「最大值覆盖」策略，只增不减。
 *
 * @param listenDuration 本地累计听歌时长（秒）
 * @param uniqueSongsCount 本地累计聆听新歌数（可选）
 */
async function reportListenDuration(
  listenDuration: number,
  uniqueSongsCount = 0,
): Promise<void> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId || listenDuration <= 0) return;

  try {
    await signedRequest('report_listen_stats', {
      ciyuanxi_id: ciyuanxiId,
      listen_duration: Math.floor(listenDuration),
      unique_songs_count: uniqueSongsCount,
    }, {
      fetchTimeoutMs: 8_000,
      timeoutMs: 10_000,
    });
    console.log(`${LOG} 上报听歌时长成功: ${Math.floor(listenDuration)}秒`);
  } catch (e) {
    // 上报失败不阻断排行榜获取
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG} 上报听歌时长失败（不影响排行榜获取）: ${msg}`);
  }
}

/**
 * 获取听歌排行榜
 *
 * 会先上报本地听歌时长到后端，再获取排行榜数据。
 *
 * @param limit 返回的排行数量，默认 50
 * @param localDuration 本地统计的听歌时长（秒），上报到后端用于排行榜
 */
export async function fetchLeaderboard(
  limit = 50,
  localDuration?: number,
): Promise<LeaderboardData> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    console.warn(`${LOG} 未登录，无法获取排行榜`);
    return { leaderboard: [], me: null, totalUsers: 0 };
  }

  // 先上报本地听歌时长（非阻断，失败不影响后续获取）
  if (localDuration && localDuration > 0) {
    await reportListenDuration(localDuration);
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
    }, {
      fetchTimeoutMs: 12_000,
      timeoutMs: 15_000,
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
