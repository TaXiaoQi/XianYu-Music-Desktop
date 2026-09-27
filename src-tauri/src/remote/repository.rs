// 远程音源持久化：remote_sources / remote_files 表读写 + 系统凭据管理器（keyring）。
// 所有 SQL 语句为冻结契约，逐字保留，仅外围 Rust 逻辑重写。
use rusqlite::params;
use rusqlite::OptionalExtension;
use super::now_seconds;
use super::types::{RemoteFileEntry, RemoteSource, RemoteSourceCredentials};
use super::types::RemoteSourceInput;
use uuid::Uuid as IdGenerator;

/// 当前使用的凭据服务名。
const CREDENTIAL_SERVICE: &str = "XianYu Music WebDAV";
/// 旧版服务名：读取时兜底，保证历史保存的密码不丢失。
const CREDENTIAL_SERVICE_LEGACY: &str = "XY-Music WebDAV";

// ---------------------------------------------------------------------------
// 系统凭据管理器
// ---------------------------------------------------------------------------

fn credential_entry(service: &str, source_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, source_id).map_err(|e| e.to_string())
}

/// 从指定服务名读取非空密码。
fn read_secret(service: &str, source_id: &str) -> Option<String> {
    let password = credential_entry(service, source_id).ok()?.get_password().ok()?;
    (!password.is_empty()).then_some(password)
}

/// 读取密码：先查现用服务名，未命中再翻旧服务名并就地搬迁。
fn stored_password(source_id: &str) -> Option<String> {
    if let Some(password) = read_secret(CREDENTIAL_SERVICE, source_id) {
        return Some(password);
    }
    let legacy = read_secret(CREDENTIAL_SERVICE_LEGACY, source_id)?;
    if save_password(source_id, &legacy).is_ok() {
        if let Ok(entry) = credential_entry(CREDENTIAL_SERVICE_LEGACY, source_id) {
            entry.delete_credential().ok();
        }
    }
    Some(legacy)
}

/// 写入密码；空密码视为无操作。
fn save_password(source_id: &str, password: &str) -> Result<(), String> {
    if password.is_empty() { return Ok(()); }
    credential_entry(CREDENTIAL_SERVICE, source_id)?.set_password(password).map_err(|e| e.to_string())
}

/// 写入并回读校验，确认凭据管理器真正落盘。
fn password_persisted_correctly(source_id: &str, password: &str) -> bool {
    save_password(source_id, password).is_ok()
        && stored_password(source_id).as_deref() == Some(password)
}

/// 新旧服务名一并清除，避免残留条目被兜底逻辑读到。
fn purge_passwords(source_id: &str) {
    for service in [CREDENTIAL_SERVICE, CREDENTIAL_SERVICE_LEGACY] {
        if let Ok(entry) = credential_entry(service, source_id) {
            entry.delete_credential().ok();
        }
    }
}

/// 数据库中密码为空时，用凭据管理器补齐。
fn with_keyring_password(mut source: RemoteSourceCredentials) -> RemoteSourceCredentials {
    if source.password.as_ref().map_or(true, |p| p.is_empty()) {
        source.password = stored_password(&source.id);
    }
    source
}

/// 把仍明文存于数据库的密码搬进凭据管理器；成功后清空库内字段。
fn relocate_plaintext_password(conn: &rusqlite::Connection, source: &RemoteSourceCredentials) {
    let password = match source.password.as_deref().filter(|p| !p.is_empty()) {
        Some(password) => password,
        None => return,
    };
    if password_persisted_correctly(&source.id, password) {
        let _ = conn.execute("UPDATE remote_sources SET password = '' WHERE id = ?1", params![&source.id]);
    } else {
        eprintln!(
            "远程音乐库 {} 的密码仍以明文存于数据库，迁移到系统凭据管理器失败，将继续使用旧值",
            source.id
        );
    }
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/// 规整用户输入的根路径：统一斜杠、补前导斜杠；空值回落为 "/"。
fn canonical_root_path(value: Option<String>) -> String {
    let unified = value.unwrap_or_else(|| "/".to_string()).trim().replace('\\', "/");
    if unified.is_empty() { return "/".to_string(); }
    if unified.starts_with('/') { unified } else { format!("/{unified}") }
}

/// 拆解 `remote://<source_id>/<path>`，路径部分保证以 "/" 开头。
pub(crate) fn remote_path_from_uri(
    uri: &str,
) -> Option<(String, String)> {
    let remainder = uri.strip_prefix("remote://")?;
    let (source_id, tail) = remainder.split_once('/')?;
    Some((source_id.to_string(), format!("/{tail}")))
}

/// 行到凭据结构的统一映射（列序与 SELECT 严格对应）。
fn credentials_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteSourceCredentials> {
    let credentials = RemoteSourceCredentials {
        id: row.get(0)?, name: row.get(1)?, provider: row.get(2)?, base_url: row.get(3)?,
        username: row.get(4)?, password: row.get(5)?, root_path: row.get(6)?,
        enabled: row.get::<_, i64>(7)? != 0, last_sync_at: row.get(8)?,
        last_sync_error: row.get(9)?, created_at: row.get(10)?, updated_at: row.get(11)?,
    };
    Ok(credentials)
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

pub(crate) fn list_sources(
    conn: &rusqlite::Connection,
) -> Result<Vec<RemoteSource>, String> {
    let sql = "SELECT id, name, provider, base_url, username, password, root_path, enabled,
                    last_sync_at, last_sync_error, created_at, updated_at
             FROM remote_sources
             ORDER BY created_at DESC";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], credentials_from_row).map_err(|e| e.to_string())?;

    Ok(rows
        .filter_map(Result::ok)
        .map(RemoteSourceCredentials::into_public)
        .collect())
}

pub(crate) fn get_source(
    conn: &rusqlite::Connection, source_id: &str,
) -> Result<RemoteSourceCredentials, String> {
    let sql = "SELECT id, name, provider, base_url, username, password, root_path, enabled,
                last_sync_at, last_sync_error, created_at, updated_at
         FROM remote_sources
         WHERE id = ?1";
    let lookup = conn.query_row(sql, [source_id], credentials_from_row);
    let found = lookup.optional().map_err(|e| e.to_string())?;
    let source = match found {
        Some(source) => source,
        None => return Err("远程音乐库不存在".to_string()),
    };

    relocate_plaintext_password(conn, &source);
    Ok(with_keyring_password(source))
}

/// 按 remote URI 定位音源；同时返回 remote_files 表里登记的 etag 与规范 URI。
pub(crate) fn get_source_for_remote_uri(
    conn: &rusqlite::Connection, uri: &str,
) -> Result<(RemoteSourceCredentials, String, Option<String>, Option<String>), String> {
    let Some((source_id, remote_path)) = remote_path_from_uri(uri) else {
        return Err("无效的远程音乐路径".to_string());
    };
    let credentials = get_source(conn, &source_id)?;

    let lookup = conn.query_row(
            "SELECT etag, remote_uri FROM remote_files WHERE source_id = ?1 AND remote_path = ?2",
            [&source_id, &remote_path],
            |row| { Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)) },
        );
    let registered = lookup.optional().map_err(|e| e.to_string())?;
    let (etag, remote_uri) = match registered {
        Some(pair) => pair,
        None => (None, uri.to_string()),
    };
    Ok((credentials, remote_path, etag, Some(remote_uri)))
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

pub(crate) fn save_source(
    conn: &rusqlite::Connection, input: RemoteSourceInput,
) -> Result<RemoteSource, String> {
    if input.provider.ne("webdav") {
        return Err(String::from("第一版仅支持 WebDAV"));
    }

    let stamp = now_seconds();
    let id = match input.id {
        Some(existing) => existing,
        None => IdGenerator::new_v4().to_string(),
    };
    let (name, base_url) = (input.name.trim(), input.base_url.trim().trim_end_matches('/'));
    if base_url.is_empty() || name.is_empty() {
        return Err(String::from("名称和服务器地址不能为空"));
    }
    let root_path = canonical_root_path(input.root_path);

    // 编辑场景：保留原有 created_at，并沿用户未重新输入的密码。
    let previous = get_source(conn, &id).ok();
    let password = input.password.or_else(|| previous.as_ref().and_then(|s| s.password.clone()));
    let created_at = previous.map_or(stamp, |source| source.created_at);

    // 密码只进凭据管理器；落盘失败则拒绝保存，避免明文回退。
    let db_password: Option<String> = match password.as_deref() {
        Some(pw) if password_persisted_correctly(&id, pw) => None,
        Some(_) => return Err(String::from("系统凭据管理器不可用，无法安全保存密码")),
        None => None,
    };

    let insert_sql = "INSERT INTO remote_sources (
            id, name, provider, base_url, username, password, root_path, enabled,
            created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            provider = excluded.provider,
            base_url = excluded.base_url,
            username = excluded.username,
            password = excluded.password,
            root_path = excluded.root_path,
            updated_at = excluded.updated_at";
    conn.execute(insert_sql, params![
            &id, name, "webdav", base_url, &input.username, &db_password, &root_path,
            created_at, stamp
        ])
        .map_err(|e| e.to_string())?;

    Ok(get_source(conn, &id)?.into_public())
}

/// 删除音源及其关联歌曲、索引行与凭据。
pub(crate) fn remove_source(
    conn: &mut rusqlite::Connection, source_id: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM songs WHERE remote_source_id = ?1", [source_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM remote_sources WHERE id = ?1", [source_id])
        .map_err(|e| e.to_string())?;
    purge_passwords(source_id);
    // 清理失去歌曲引用的孤儿歌手。
    let cleanup = tx.execute("DELETE FROM artists
         WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)", []);
    let _ = cleanup.ok();
    tx.commit().map_err(|e| e.to_string())
}

/// 用最新扫描结果整体替换某音源的 remote_files 索引。
pub(crate) fn replace_remote_files(
    conn: &mut rusqlite::Connection, source_id: &str, files: &[RemoteFileEntry],
) -> Result<(), String> {
    let indexed_at = now_seconds();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM remote_files WHERE source_id = ?1", [source_id])
        .map_err(|e| e.to_string())?;

    {
        let insert_sql = "INSERT INTO remote_files (
                    source_id, remote_path, remote_uri, name, size, etag, modified_at, is_audio, indexed_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)";
        let mut stmt = tx.prepare(insert_sql).map_err(|e| e.to_string())?;
        for item in files {
            stmt.execute(params![
                source_id, &item.remote_path, item.remote_uri(source_id), &item.name,
                item.size.min(i64::MAX as u64) as i64, &item.etag, &item.modified_at,
                if item.is_dir { 0 } else { 1 }, indexed_at
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())
}

/// 记录同步完成时间（或失败原因）。
pub(crate) fn update_sync_status(
    conn: &rusqlite::Connection, source_id: &str, error: Option<&str>,
) -> Result<(), String> {
    let moment = now_seconds();
    let sql = "UPDATE remote_sources
         SET last_sync_at = ?1, last_sync_error = ?2, updated_at = ?1
         WHERE id = ?3";
    conn.execute(sql, params![moment, error, source_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 回写歌曲的本地缓存路径。
pub(crate) fn update_song_cache_path(
    conn: &rusqlite::Connection, remote_uri: &str, cache_path: &str,
) -> Result<(), String> {
    let sql = "UPDATE songs SET cache_path = ?1 WHERE path = ?2";
    conn.execute(sql, params![cache_path, remote_uri])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 查询歌曲已登记的本地缓存路径（可能为 NULL 或行不存在）。
pub(crate) fn get_song_cache_path(
    conn: &rusqlite::Connection, remote_uri: &str,
) -> Result<Option<String>, String> {
    let lookup: Result<Option<String>, _> = conn.query_row(
            "SELECT cache_path FROM songs WHERE path = ?1",
            [remote_uri],
            |row| row.get(0),
        );
    lookup
        .optional()
        .map_err(|e| e.to_string())
        .map(|value| value.flatten())
}
