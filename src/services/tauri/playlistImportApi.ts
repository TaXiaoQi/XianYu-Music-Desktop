import { tauriInvoke } from './invoke';

// 歌单导入内置实现已下沉 Rust（src-tauri/src/music/playlist_fetcher/），
// 前端仅保留此薄壳；返回形状与热修 JS 模块（playlist_import）逐字段一致。
export const playlistImportApi = {
  fetchPlaylistFromSource: (source: string, rawId: string) =>
    tauriInvoke('fetch_playlist_from_source', { source, rawId }),
};
