// 全库扫描触发：逐根目录调用扫描链后返回缓存曲目全量。

use tauri::{AppHandle, State};

use crate::database::{DbState};
use crate::music::scanner::{scan_single_directory_internal, ScanOptions};
use crate::music::types::LibrarySong;

use super::common::{db_err, read_song_cache};

/// 触发全库扫描：逐根目录扫描后返回缓存曲目全量。
#[tauri::command] // 实现
pub async fn scan_library( // 实现
  minimum_duration_seconds: Option<u32>,
  app: AppHandle,
  db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySong>, String> { // 实现
  let pooled = db_state.conn.clone();
  let scan_opts = ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds);

  let outcome = tauri::async_runtime::spawn_blocking(move || {
    // 先取全部根目录，随后逐个触发扫描（扫描器自行处理增量与错误）。
    let root_paths: Vec<String> = {
      let guard = pooled.lock().map_err(|e| e.to_string())?;
      let mut stmt = guard
        .prepare("SELECT path FROM library_folders")
        .map_err(db_err)?;
      let mut rows = stmt.query([]).map_err(db_err)?;
      let mut found = Vec::new();
      while let Some(row) = rows.next().map_err(db_err)? {
        if let Ok(raw) = row.get::<_, String>(0) {
          found.push(raw);
        }
      }
      found
    };

    let grand_total = root_paths.len();
    for (index, root) in root_paths.into_iter().enumerate() {
      // 扫描错误不阻断后续根目录，与旧实现一致。
      let _ = scan_single_directory_internal(
        root,
        pooled.clone(),
        Some(app.clone()),
        index + 1,
        grand_total.max(1),
        scan_opts,
      );
    }

    let guard = pooled.lock().map_err(|e| e.to_string())?;
    read_song_cache(&guard)
  })
  .await
  .map_err(|e| e.to_string())??;

  Ok(outcome)
}
