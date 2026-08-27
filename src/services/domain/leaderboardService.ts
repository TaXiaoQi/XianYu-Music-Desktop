/**
 * 听歌排行榜服务 —— 门面（Facade）。
 *
 * 调用后端 `api/index.php` 的 `get_leaderboard` 接口，获取听歌时长排行榜数据
 * （Top N + 当前用户排名）。在获取排行榜前，先将本地统计的听歌时长上报到后端
 * （report_listen_stats），确保云端数据与本地一致。复用 authService 的签名机制。
 *
 * 汇聚 re-export 拆分后的子模块，保持既有消费者（StatisticsPage /
 * leaderboardService.test.ts）的入口路径不变。已拆分的子模块：
 *   - leaderboardTypes  类型（叶子）
 *   - leaderboardReport 本地时长获取 + 上报/重置信号
 *   - leaderboardQuery  拉取 + snake_case→camelCase 响应映射
 */

export type {
  LeaderboardEntry,
  LeaderboardData,
  ListenDurations,
  LeaderboardPeriod,
} from './leaderboardTypes';

export {
  getLocalListenDurations,
  checkForResetSignal,
} from './leaderboardReport';

export {
  fetchAllLeaderboards,
  fetchLeaderboard,
} from './leaderboardQuery';