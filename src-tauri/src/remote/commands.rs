// 远程曲库 Tauri 命令层：命令名、参数名与返回类型为前端契约，冻结不改。
use crate::remote::cache;
use super::now_seconds;
use super::repository::{get_source, list_sources, remove_source, save_source};
use crate::remote::scanner;
use super::types::{RemoteCacheUsage, RemoteConnectionResult, RemoteFileEntry, RemoteSource};
use super::types::{RemoteSourceCredentials, RemoteSourceInput, RemoteSyncResult};
use crate::remote::webdav;
use crate::database::{DbState};
use rusqlite::Connection;
use std::sync::MutexGuard;
use tauri::{State, AppHandle};

/// 把前端表单转成临时凭据（仅用于连接测试；id 缺省为 "test"）。
fn credentials_for_probe(input: RemoteSourceInput) -> Result<RemoteSourceCredentials, String> {
  if input.provider != "webdav" {
    return Err("第一版仅支持 WebDAV".to_string());
  }
  let stamp = now_seconds();
  Ok(RemoteSourceCredentials {
    id: input.id.unwrap_or_else(|| "test".into()),
    name: input.name,
    provider: input.provider,
    base_url: input.base_url.trim().trim_end_matches('/').into(),
    username: input.username,
    password: input.password,
    root_path: input.root_path.unwrap_or_else(|| "/".into()),
    enabled: true,
    last_sync_at: None,
    last_sync_error: None,
    created_at: stamp,
    updated_at: stamp,
  })
}

/// 加锁取出数据库连接的统一入口。
fn lock_db<'a>(db_state: &'a State<'a, DbState>) -> Result<MutexGuard<'a, Connection>, String> {
  db_state.conn.lock().map_err(|e| e.to_string())
}

#[tauri::command] // 实现
pub(crate) async fn get_remote_sources(
  db_state: State<'_, DbState>,
) -> Result<Vec<RemoteSource>, String> {
  let conn = lock_db(&db_state)?;
  list_sources(&conn)
}

#[tauri::command] // 实现
pub(crate) async fn test_remote_source(
  source: RemoteSourceInput,
) -> Result<RemoteConnectionResult, String> {
  let credentials = credentials_for_probe(source)?;
  let blocked = crate::security::ssrf::validate_outbound_url(&credentials.base_url)
    .await
    .err();
  if let Some(message) = blocked {
    return Ok(RemoteConnectionResult { ok: false, message });
  }
  let outcome = webdav::test_connection(&credentials).await;
  Ok(match outcome {
    Ok(()) => RemoteConnectionResult {
      ok: true,
      message: "连接成功".to_string(),
    },
    Err(message) => RemoteConnectionResult { ok: false, message },
  })
}

#[tauri::command] // 实现
pub(crate) async fn add_remote_source( // 实现
  source: RemoteSourceInput,
  db_state: State<'_, DbState>,
) -> Result<RemoteSource, String> { // 实现
  crate::security::ssrf::validate_outbound_url(source.base_url.trim().trim_end_matches('/'))
    .await?;
  let conn = lock_db(&db_state)?;
  save_source(&conn, source)
}

#[tauri::command] // 实现
pub(crate) async fn update_remote_source( // 实现
  source: RemoteSourceInput,
  db_state: State<'_, DbState>,
) -> Result<RemoteSource, String> { // 实现
  crate::security::ssrf::validate_outbound_url(source.base_url.trim().trim_end_matches('/'))
    .await?;
  let conn = lock_db(&db_state)?;
  save_source(&conn, source)
}

#[tauri::command] // 实现
pub(crate) async fn remove_remote_source(
  source_id: String,
  db_state: State<'_, DbState>,
) -> Result<(), String> { // 实现
  let mut conn = lock_db(&db_state)?;
  remove_source(&mut conn, &source_id)
}

#[tauri::command] // 实现
pub(crate) async fn sync_remote_source( // 实现
  app: AppHandle,
  source_id: String,
  db_state: State<'_, DbState>,
) -> Result<RemoteSyncResult, String> { // 实现
  let source = {
    let conn = lock_db(&db_state)?;
    get_source(&conn, &source_id)?
  };
  crate::security::ssrf::validate_outbound_url(&source.base_url).await?;
  scanner::sync_source(app, db_state.conn.clone(), source).await
}

#[tauri::command] // 实现
pub(crate) async fn precache_remote_song( // 实现
  app: AppHandle,
  remote_uri: String,
  db_state: State<'_, DbState>,
) -> Result<(), String> { // 实现
  // 非远程路径无需预缓存，直接成功。
  if !cache::is_remote_uri(&remote_uri) {
    return Ok(());
  }
  cache::ensure_cached_path(&app, &db_state, &remote_uri)
    .await
    .map(|_| ())
}

#[tauri::command] // 实现
pub(crate) async fn get_remote_cache_usage(app: AppHandle) -> Result<RemoteCacheUsage, String> { // 实现
  cache::cache_usage(&app)
}

#[tauri::command] // 实现
pub(crate) async fn clear_remote_cache(app: AppHandle) -> Result<RemoteCacheUsage, String> { // 实现
  cache::clear_cache(&app)
}

#[tauri::command] // 实现
pub(crate) async fn list_remote_directory( // 实现
  source_id: String,
  path: String,
  db_state: State<'_, DbState>,
) -> Result<Vec<RemoteFileEntry>, String> { // 实现
  let source = {
    let conn = lock_db(&db_state)?;
    get_source(&conn, &source_id)?
  };
  crate::security::ssrf::validate_outbound_url(&source.base_url).await?;
  let client = webdav::shared_client();
  webdav::list_directory(client, &source, &path).await
}
