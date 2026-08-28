/**
 * 听歌时长快照跨端同步 —— 累计听歌时长（累计听歌时长）跨设备保底同步。
 *
 * 方案：文件快照式同步，4 条规则。
 *  - Rule 1：服务端无快照 -> 上传本地快照（该设备成为基准）。
 *  - Rule 2：两端都有数据 -> 本地为空则用 'max'（避免加了空值），否则用 'add' 做累计相加；
 *            服务端已 merge 过则改 'max'，避免重复累加。
 *  - Rule 3：服务端有、本地为空 -> 将云端快照 'max' 落回本地，回填该新设备。
 *  - Rule 4：服务端后台清零（reset_at 更新于本机已应用的）-> 清空本地一次并回传，
 *            处分在多端生效；记录该时间点后用户可重新累计，不会被永久清零。
 */

import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import { statisticsApi } from '../tauri/statisticsApi';

/** 日志前缀 */
const LOG = '[ListenStatsSync]';
/** 本机最近一次已应用的清零时间点（localStorage） */
const RESET_TS_KEY = 'xianyumusic.lastListenResetAt';
/** 本地待展示清零通知（时间点 + 原因，供 StartupNotice 弹窗展示，关闭后清除） */
const PENDING_RESET_AT_KEY = 'xianyumusic.pendingListenResetAt';
const PENDING_RESET_REASON_KEY = 'xianyumusic.pendingListenResetReason';

/** 快照 global 段是否非零 / 是否有 daily 记录 */
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

/** 上传本地快照到服务端（携带后台清零时间点，供一次性下发） */
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

/**
 * 执行一次听歌时长快照同步。遵循上述 4 条规则。
 * 同步事件不应打断其它同步项，任何异常都只记录、绝不向上抛。
 */
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

    // Rule 4：服务端后台清零（reset_at 更新于本机已应用的）-> 清空本地一次并回传，
    // 同时把清零原因落到本地待展示记录，供 StartupNotice 弹窗告知用户。
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

    // Rule 1：服务端无快照 -> 以本地快照为该设备基准上传
    if (cloud?.listen_stats == null) {
      await uploadSnapshot(ciyuanxiId, JSON.parse(localJson), false, resetAt);
      console.info(`${LOG} 服务端无快照，已上传本地作为基准`);
      return;
    }

    const cloudStats = cloud.listen_stats;
    const cloudNonZero = statsNonZero(cloudStats);
    const localNonZero = statsNonZero(JSON.parse(localJson));

    // Rule 3：服务端有数据、本地为空（新设备）-> 云端 'max' 落回本地
    if (cloudNonZero && !localNonZero) {
      await statisticsApi.mergeListenSnapshot(JSON.stringify(cloudStats), 'max');
      const mergedJson = await statisticsApi.exportListenSnapshot();
      await uploadSnapshot(ciyuanxiId, JSON.parse(mergedJson), true, resetAt);
      console.info(`${LOG} 本地为空，已用云端快照回填（max）`);
      return;
    }

    // Rule 2：两端都有数据 -> 服务端未 merge 用 'add' 累计相加；已 merge 用 'max' 避免重复累加
    if (cloudNonZero && localNonZero) {
      const mode = cloud?.merged ? 'max' : 'add';
      await statisticsApi.mergeListenSnapshot(JSON.stringify(cloudStats), mode);
      const mergedJson = await statisticsApi.exportListenSnapshot();
      await uploadSnapshot(ciyuanxiId, JSON.parse(mergedJson), true, resetAt);
      console.info(`${LOG} 两端都有数据，已按 ${mode} 合并并回传`);
      return;
    }

    // 兜底：服务端仅存零值占位 -> 以本地快照更新
    await uploadSnapshot(ciyuanxiId, JSON.parse(localJson), false, resetAt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} 听歌时长快照同步失败: ${msg}`);
  }
}