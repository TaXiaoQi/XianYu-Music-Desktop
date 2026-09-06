/**
 * 日推正反馈上报 —— 收藏 / 添加到歌单代表「喜欢这类歌」。
 *
 * POST /api/?action=report_daily_like  批量上报歌名+歌手（需登录），
 * 服务端去重写入 daily_like 并按权重并入日推画像，帮助调整每日推荐算法。
 * 上报失败静默（不打断收藏/加歌单主流程），未登录直接跳过。
 */
import { getStoredAuth } from '../auth/authService';
import { requestAction } from '../auth/authHttp';

export interface DailyLikeSignalSong {
  songName: string;
  singer: string;
}

export async function reportDailyLikeSignals(
  songs: DailyLikeSignalSong[],
  signalType: 'favorite' | 'playlist',
): Promise<void> {
  const payload = songs
    .map(s => ({ song_name: s.songName?.trim() ?? '', singer: s.singer?.trim() ?? '' }))
    .filter(s => s.song_name.length > 0);
  if (payload.length === 0) {
    return;
  }
  const auth = getStoredAuth();
  const ciyuanxiId = auth?.user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    return;
  }
  try {
    await requestAction('report_daily_like', {
      ciyuanxi_id: ciyuanxiId,
      signal_type: signalType,
      songs: payload,
    });
  } catch {
    // 上报失败不影响收藏/加歌单主流程
  }
}

/**
 * 日推负反馈上报：对当前日推歌曲点「不喜欢」。
 * 服务端写入 daily_dislike 并清除当日算法缓存，
 * 下次生成日推时该「歌名+歌手」并入 exclusions 排除项。
 */
export async function reportDailyDislikeSignal(song: DailyLikeSignalSong): Promise<void> {
  const songName = song.songName?.trim() ?? '';
  if (!songName) return;
  const auth = getStoredAuth();
  const ciyuanxiId = auth?.user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    return;
  }
  try {
    await requestAction('report_daily_dislike', {
      ciyuanxi_id: ciyuanxiId,
      song_name: songName,
      singer: song.singer?.trim() ?? '',
    });
  } catch {
    // 上报失败不影响跳过主流程
  }
}
