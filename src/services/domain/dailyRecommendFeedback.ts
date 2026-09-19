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
