
export interface LeaderboardEntry {
  rank: number;
  username: string;
  nickname: string;
  ciyuanxi_id?: string;
  avatar?: string;
  duration: number;
  isMe?: boolean;
}

export interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  me: LeaderboardEntry | null;
  totalUsers: number;
}

export interface ListenDurations {
  daily: number;
  weekly: number;
  total: number;
}

export type LeaderboardPeriod = 'daily' | 'weekly' | 'total';