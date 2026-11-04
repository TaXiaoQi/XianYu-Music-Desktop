import type { HistoryItem } from '../../types';
import { signedRequest } from '../auth/authService';

const LOG = '[HistorySync]';
const RECENT_HISTORY_CAP = 200;
/** 本机已删/已清的播放历史路径墓碑：自动同步「先下载」阶段不把云端仍存的条目补回本地 */
const HISTORY_SKIP_KEY = 'xianyu_history_download_skip_paths';

function logSyncError(msg: string, ...args: unknown[]) {
    console.error(`${LOG} ${msg}`, ...args);
}

function loadSkipSet(): Set<string> {
    try {
        const raw = localStorage.getItem(HISTORY_SKIP_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
        return new Set();
    }
}

function persistSkipSet(paths: Set<string>) {
    try {
        localStorage.setItem(HISTORY_SKIP_KEY, JSON.stringify(Array.from(paths)));
    } catch { /* 存储不可用时静默降级：仅影响墓碑持久化 */ }
}

/** 记录本机删除/清空的播放历史路径，防止下一轮下载合并复活 */
export function addHistorySkipPaths(paths: string[]) {
    const valid = paths.filter(p => p);
    if (valid.length === 0) return;
    const s = loadSkipSet();
    const before = s.size;
    valid.forEach(p => s.add(p));
    if (s.size !== before) persistSkipSet(s);
}

/** 解除墓碑（本机重新播放该歌曲 / 云端条目已收敛时调用） */
export function removeHistorySkipPaths(paths: Iterable<string>) {
    const s = loadSkipSet();
    let changed = false;
    for (const p of paths) {
        if (p && s.delete(p)) changed = true;
    }
    if (changed) persistSkipSet(s);
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
 * 按 playedAt 倒序裁到 200 上限。墓碑中的路径不补回（本机已删/已清）；
 * 云端仍存在且本机也存在的条目视为已收敛，解除其墓碑 */
export function mergeHistory(
    local: HistoryItem[],
    cloud: HistoryItem[],
): HistoryItem[] {
    if (cloud.length === 0) {
        return local;
    }
    const byPath = new Map(local.map((item) => [item.path, item]));
    const skip = loadSkipSet();
    let skipChanged = false;
    for (const item of cloud) {
        if (byPath.has(item.path)) {
            if (skip.delete(item.path)) skipChanged = true;
            continue;
        }
        if (skip.has(item.path)) continue;
        byPath.set(item.path, item);
    }
    if (skipChanged) persistSkipSet(skip);
    return [...byPath.values()]
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, RECENT_HISTORY_CAP);
}
