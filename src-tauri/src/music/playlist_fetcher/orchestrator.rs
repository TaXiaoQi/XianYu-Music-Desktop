// 编排入口 shim：音源分发逻辑统一在共享 core（xianyu_core::music::playlist_fetcher），
// 端侧仅暴露 Tauri 命令包装。

use super::PlaylistImportResult;

// ==================== Tauri Command ====================

#[tauri::command]
pub async fn fetch_playlist_from_source(
    source: String,
    raw_id: String,
) -> Result<PlaylistImportResult, String> {
    xianyu_core::music::playlist_fetcher::fetch_playlist_from_source(source, raw_id).await
}
