// 曲库根目录维护：登记、移除与根目录清单查询。

use std::path::PathBuf;
use std::time::SystemTime;

use tauri::State;

use crate::database::{DbState};
use crate::music::types::LibraryFolder;
use crate::music::utils::{ // 实现
  descendant_like_patterns, legacy_unc_path, normalize_path,
};
use crate::security::path_validator;

use super::common::{db_err, prepare, run_with_db, string_column};

// 登记目录时目录不可达的对外错误文案（契约，逐字保留）。
const FOLDER_ACCESS_DENIED_TEXT: &str = "无法访问音乐文件夹，请检查局域网连接、共享路径和访问权限";

// song_path 是 folder_path 本身或其后代（两种分隔符都认）。
fn path_within_root(candidate: &str, root: &str) -> bool {
  if candidate == root {
    return true;
  }
  for separator in ['\\', '/'] {
    let mut prefix = String::from(root);
    prefix.push(separator);
    if candidate.starts_with(&prefix) {
      return true;
    }
  }
  false
}

// ---------- 根目录移除（事务内完成） ----------

// 删除文件夹记录并清掉不属于其余根目录后代的曲目，最后清理孤儿歌手。
pub(super) fn delete_folder_subtree(
  conn: &mut rusqlite::Connection,
  folder_path: &str,
) -> Result<Vec<String>, String> { // 实现
  let tx = conn.transaction().map_err(db_err)?;

  // 旧版写入的 UNC 别名一并删除。
  let legacy_alias = legacy_unc_path(folder_path).unwrap_or_else(|| folder_path.to_string());
  tx.execute(
    "DELETE FROM library_folders WHERE path = ?1 OR path = ?2",
    rusqlite::params![folder_path, legacy_alias],
  )
  .map_err(db_err)?;

  // 剩余根目录（归一化后参与归属判断）。
  let mut surviving_roots: Vec<String> = Vec::new();
  {
    let mut stmt = tx
      .prepare("SELECT path FROM library_folders")
      .map_err(db_err)?;
    let mut rows = stmt.query([]).map_err(db_err)?;
    while let Some(row) = rows.next().map_err(db_err)? {
      if let Ok(raw) = row.get::<_, String>(0) {
        surviving_roots.push(normalize_path(&raw));
      }
    }
  }

  let (forward_like, backward_like) = descendant_like_patterns(folder_path);
  let mut doomed_paths: Vec<String> = Vec::new();
  {
    let mut stmt = tx
      .prepare(
        "SELECT path
                 FROM songs
                 WHERE path = ?1 
                    OR path LIKE ?2 ESCAPE '^' 
                    OR path LIKE ?3 ESCAPE '^'", 
      )
      .map_err(db_err)?;
    let mut rows = stmt
      .query(rusqlite::params![folder_path, forward_like, backward_like])
      .map_err(db_err)?;
    while let Some(row) = rows.next().map_err(db_err)? {
      if let Ok(raw) = row.get::<_, String>(0) {
        doomed_paths.push(raw);
      }
    }
  }

  // 其余根目录还罩得住的曲目留下，罩不住的删除。
  let mut removed: Vec<String> = Vec::new();
  for path in doomed_paths {
    let still_covered = surviving_roots
      .iter()
      .any(|root| path_within_root(&path, root));
    if !still_covered {
      removed.push(path);
    }
  }

  {
    let mut stmt = tx
      .prepare("DELETE FROM songs WHERE path = ?1")
      .map_err(db_err)?;
    for path in &removed {
      stmt
        .execute([path])
        .map_err(|e| format!("delete failed for '{}': {}", path, e))?;
    }
  }

  // 孤儿歌手清理；失败不阻断流程。
  let _ = tx.execute(
    "DELETE FROM artists
         WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)",
    [],
  );

  tx.commit().map_err(db_err)?;
  Ok(removed)
}

/// 曲库根目录清单（按加入时间倒序），附带各自名下的曲目数。
#[tauri::command] // 实现
pub async fn get_library_folders( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<LibraryFolder>, String> { // 实现
  run_with_db(&db_state, |conn| {
    let mut folder_stmt = prepare(
      conn,
      "SELECT path FROM library_folders ORDER BY added_at DESC",
    )?;
    let root_paths: Vec<String> = string_column(&mut folder_stmt, [])?
      .into_iter()
      .map(|raw| normalize_path(&raw))
      .collect();

    let mut song_stmt = prepare(conn, "SELECT path FROM songs")?;
    let song_paths = string_column(&mut song_stmt, [])?;

    let mut folders = Vec::with_capacity(root_paths.len());
    for root in root_paths {
      let mut owned_count = 0usize;
      for song in &song_paths {
        if path_within_root(song, &root) {
          owned_count += 1;
        }
      }
      folders.push(LibraryFolder {
        path: root,
        song_count: owned_count,
      });
    }
    Ok(folders)
  })
  .await
}

/// 登记曲库根目录；目录必须真实可访问，旧式 UNC 别名一并清除。
#[tauri::command] // 实现
pub async fn add_library_folder(path: String, db_state: State<'_, DbState>) -> Result<(), String> { // 实现
  let validated = path_validator::validate_path(&path, None)?;
  let normalized = normalize_path(&validated.to_string_lossy());
  let pooled = db_state.conn.clone();

  let outcome = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
    let root = PathBuf::from(&normalized);
    if !root.is_dir() || std::fs::read_dir(&root).is_err() {
      return Err(FOLDER_ACCESS_DENIED_TEXT.to_string());
    }

    let guard = pooled.lock().map_err(|e| e.to_string())?;
    if let Some(alias) = legacy_unc_path(&normalized) {
      guard
        .execute("DELETE FROM library_folders WHERE path = ?1", [alias])
        .map_err(|e| e.to_string())?;
    }

    let added_at_stamp = SystemTime::now()
      .duration_since(SystemTime::UNIX_EPOCH)
      .unwrap_or_default()
      .as_secs()
      .to_string();
    guard
      .execute(
        "INSERT OR REPLACE INTO library_folders (path, added_at) VALUES (?1, ?2)",
        [&normalized, &added_at_stamp],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  })
  .await;

  outcome.map_err(|e| e.to_string())??;
  Ok(())
}

/// 移除曲库根目录；其独占的曲目与孤儿歌手一并清理。
#[tauri::command] // 实现
pub async fn remove_library_folder( // 实现
  path: String,
  db_state: State<'_, DbState>,
) -> Result<(), String> { // 实现
  let validated = path_validator::validate_path(&path, None)?;
  let normalized = normalize_path(&validated.to_string_lossy());

  run_with_db(&db_state, move |conn| {
    delete_folder_subtree(conn, &normalized)?;
    Ok(())
  })
  .await
}
