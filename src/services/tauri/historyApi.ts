// 近期播放历史相关的后端接口封装。
// 命令名与载荷键名须与 src-tauri 侧的命令定义保持一致，改动前先核对 Rust 端。
import { tauriInvoke as callTauri } from "./invoke";

import type {
    RecentHistoryRecord,
    RecentHistoryImportRecord,
} from "./contracts";

export const historyApi = { // 实现
    /** 追加一条播放记录。 */
    addToHistory(songPath: string) {
        return callTauri("add_to_history", { songPath });
    },

    /** 从近期播放列表中移除若干歌曲。 */
    removeFromRecentHistory(songPaths: string[]) {
        return callTauri("remove_from_recent_history", { songPaths });
    },

    /** 从播放历史与统计数据中一并移除若干歌曲。 */
    removeSongsFromHistoryAndStatistics(songPaths: string[]) {
        return callTauri("remove_songs_from_history_and_statistics", {
            songPaths,
        });
    },

    /** 清空全部近期播放。 */
    clearRecentHistory() {
        return callTauri("clear_recent_history");
    },

    /** 按上限条数读取近期播放列表。 */
    getRecentHistory(limit: number): Promise<RecentHistoryRecord[]> {
        return callTauri("get_recent_history", { limit });
    },

    /** 批量导入带时间戳的播放记录。 */
    importRecentHistory(entries: RecentHistoryImportRecord[]) {
        return callTauri("import_recent_history", { entries });
    },
};
