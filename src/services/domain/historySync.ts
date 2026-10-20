import type { HistoryItem } from '../../types';
import { signedRequest } from '../auth/authService';

const LOG = '[HistorySync]';
const RECENT_HISTORY_CAP = 200;

function logSyncError(msg: string, ...args: unknown[]) {
    console.error(`${LOG} ${msg}`, ...args);
}

interface HistorySyncEntry {
    songPath?: string;
    playedAt?: number;
}

/** 上传本地最近播放（{path, playedAt} 与移动端 payload 口径一致） */
export async function uploadHistory(
    ciyuanxiId: string,
    items: HistoryItem[],
): Promise<number> {
    const history = items
        .filter((item) => item.path)
        .map((item) => ({ songPath: item.path, playedAt: item.playedAt }));
    if (history.length === 0) {
        return 0;
    }
    try {
        const data = await signedRequest<{ history_count: number }>(
            'history_sync_upload',
            { user_id: ciyuanxiId, history },
            { fetchTimeoutMs: 30_000 },
        );
        return data?.history_count ?? 0;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`uploadHistory 失败: ${msg}`);
        throw e;
    }
}

/** 拉取云端播放历史（[{songPath, playedAt}]，旧服务端缺省为空） */
export async function downloadHistory(
    ciyuanxiId: string,
): Promise<HistoryItem[]> {
    try {
        const data = await signedRequest<{ history?: HistorySyncEntry[] }>(
            'history_sync_download',
            { user_id: ciyuanxiId },
            { fetchTimeoutMs: 15_000 },
        );
        return (data?.history ?? [])
            .map((entry) => ({
                path: entry.songPath ?? '',
                playedAt: entry.playedAt ?? 0,
            }))
            .filter((item) => item.path);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`downloadHistory 失败: ${msg}`);
        throw e;
    }
}

/** 云端历史并入本地最近播放：仅补本地缺失条目（本地 playedAt 更准），
 * 按 playedAt 倒序裁到 200 上限 */
export function mergeHistory(
    local: HistoryItem[],
    cloud: HistoryItem[],
): HistoryItem[] {
    if (cloud.length === 0) {
        return local;
    }
    const byPath = new Map(local.map((item) => [item.path, item]));
    for (const item of cloud) {
        if (!byPath.has(item.path)) {
            byPath.set(item.path, item);
        }
    }
    return [...byPath.values()]
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, RECENT_HISTORY_CAP);
}
