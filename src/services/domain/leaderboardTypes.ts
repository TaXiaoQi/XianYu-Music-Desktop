/**
 * 听歌排行榜 · 类型（叶子）。
 */

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

/** 排行榜时间周期 */
export type LeaderboardPeriod = 'daily' | 'weekly' | 'total';