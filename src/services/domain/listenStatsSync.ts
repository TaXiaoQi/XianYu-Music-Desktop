
import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { statisticsApi } from '../tauri/statisticsApi';

const LOG = '[ListenStatsSync]';
const RESET_TS_KEY = 'xianyumusic.lastListenResetAt';
const PENDING_RESET_AT_KEY = 'xianyumusic.pendingListenResetAt';
const PENDING_RESET_REASON_KEY = 'xianyumusic.pendingListenResetReason';

function statsNonZero(stats: any): boolean {
  const global = stats?.global ?? {};
  const totalMs = Number(global.total_play_time_ms ?? 0);
  const totalCount = Number(global.total_play_count ?? 0);
  const daily = Array.isArray(stats?.daily) ? stats.daily : [];
  return totalMs > 0 || totalCount > 0 || daily.length > 0;
}

function getLastListenResetAt(): number {
  const raw = localStorage.getItem(RESET_TS_KEY);
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function setLastListenResetAt(ts: number): void {
  localStorage.setItem(RESET_TS_KEY, String(ts));
}

async function uploadSnapshot(
  ciyuanxiId: string,
  listenStats: any,
  merged: boolean,
  resetAt: number,
): Promise<void> {
  await signedRequest('listen_stats_sync_upload', {
    user_id: ciyuanxiId,
    listen_stats: listenStats,
    merged,
    reset_at: resetAt,
  });
}

export async function syncListenStats(): Promise<void> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) return;

  let localJson: string;
  try {
    localJson = await statisticsApi.exportListenSnapshot();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG} 读取本地快照失败（跳过本次同步）: ${msg}`);
    return;
  }

  try {
    const cloud = await signedRequest<{ merged?: boolean; reset_at?: number; reason?: string; listen_stats?: any }>(
      'listen_stats_sync_download',
      { user_id: ciyuanxiId },
    );

    const resetAt = Number(cloud?.reset_at ?? 0);

    if (resetAt > getLastListenResetAt()) {
      await statisticsApi.clearListenStats();
      setLastListenResetAt(resetAt);
      localStorage.setItem(PENDING_RESET_AT_KEY, String(resetAt));
      localStorage.setItem(PENDING_RESET_REASON_KEY, cloud?.reason ?? '');
      const zeroJson = await statisticsApi.exportListenSnapshot();
      await uploadSnapshot(ciyuanxiId, JSON.parse(zeroJson), true, resetAt);
      console.info(`${LOG} 服务端已清零，本地已按最新清零时间点清空并回传`);
      return;
    }

    if (cloud?.listen_stats == null) {
      await uploadSnapshot(ciyuanxiId, JSON.parse(localJson), false, resetAt);
      console.info(`${LOG} 服务端无快照，已上传本地作为基准`);
      return;
    }

    const cloudStats = cloud.listen_stats;
    const cloudNonZero = statsNonZero(cloudStats);
    const localNonZero = statsNonZero(JSON.parse(localJson));

    if (cloudNonZero && !localNonZero) {
      await statisticsApi.mergeListenSnapshot(JSON.stringify(cloudStats), 'max');
      const mergedJson = await statisticsApi.exportListenSnapshot();
      await uploadSnapshot(ciyuanxiId, JSON.parse(mergedJson), true, resetAt);
      console.info(`${LOG} 本地为空，已用云端快照回填（max）`);
      return;
    }

    if (cloudNonZero && localNonZero) {
      const mode = cloud?.merged ? 'max' : 'add';
      await statisticsApi.mergeListenSnapshot(JSON.stringify(cloudStats), mode);
      const mergedJson = await statisticsApi.exportListenSnapshot();
      await uploadSnapshot(ciyuanxiId, JSON.parse(mergedJson), true, resetAt);
      console.info(`${LOG} 两端都有数据，已按 ${mode} 合并并回传`);
      return;
    }

    await uploadSnapshot(ciyuanxiId, JSON.parse(localJson), false, resetAt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 听歌时长快照同步失败: ${msg}`);
  }
}