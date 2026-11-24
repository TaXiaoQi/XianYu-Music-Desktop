// 歌单导入域 shim：平台实现（wy/tx/kw/kg/mg/qishui）与分发编排统一在共享 core
// （xianyu_core::music::playlist_fetcher），端侧仅保留 Tauri 命令包装
// （#[tauri::command] 宏要求命令定义在端侧）。
pub(crate) use xianyu_core::music::playlist_fetcher::PlaylistImportResult;
pub use xianyu_core::music::playlist_fetcher::qishui;

mod orchestrator;

pub use orchestrator::fetch_playlist_from_source;
