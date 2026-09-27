// 增量迁移：为历史版本库补列、补表并回填缺失数据。
// 注意：本文件内所有 SQL 文本属于数据兼容性契约，必须逐字保留，禁止改写。

use rusqlite::Connection;
use std::fs;
use std::time::UNIX_EPOCH;

/// songs 表历代版本陆续引入的列：`（列名, 对应的补列语句）`，顺序不可调换。
const SONG_COLUMN_UPGRADES: &[(&str, &str)] = &[
    ("bitrate", "ALTER TABLE songs ADD COLUMN bitrate INTEGER"),
    (
        "cover_thumb_path",
        "ALTER TABLE songs ADD COLUMN cover_thumb_path TEXT",
    ),
    (
        "artist_names",
        "ALTER TABLE songs ADD COLUMN artist_names TEXT",
    ),
    (
        "effective_artist_names",
        "ALTER TABLE songs ADD COLUMN effective_artist_names TEXT",
    ),
    (
        "album_artist",
        "ALTER TABLE songs ADD COLUMN album_artist TEXT",
    ),
    ("album_key", "ALTER TABLE songs ADD COLUMN album_key TEXT"),
    (
        "is_various_artists_album",
        "ALTER TABLE songs ADD COLUMN is_various_artists_album INTEGER DEFAULT 0",
    ),
    (
        "collapse_artist_credits",
        "ALTER TABLE songs ADD COLUMN collapse_artist_credits INTEGER DEFAULT 0",
    ),
    (
        "sample_rate",
        "ALTER TABLE songs ADD COLUMN sample_rate INTEGER",
    ),
    ("bit_depth", "ALTER TABLE songs ADD COLUMN bit_depth INTEGER"),
    ("format", "ALTER TABLE songs ADD COLUMN format TEXT"),
    ("container", "ALTER TABLE songs ADD COLUMN container TEXT"),
    ("codec", "ALTER TABLE songs ADD COLUMN codec TEXT"),
    ("file_size", "ALTER TABLE songs ADD COLUMN file_size INTEGER"),
    (
        "track_number",
        "ALTER TABLE songs ADD COLUMN track_number TEXT",
    ),
    (
        "disc_number",
        "ALTER TABLE songs ADD COLUMN disc_number TEXT",
    ),
    ("added_at", "ALTER TABLE songs ADD COLUMN added_at INTEGER"),
    (
        "file_modified_at",
        "ALTER TABLE songs ADD COLUMN file_modified_at INTEGER",
    ),
    (
        "source_type",
        "ALTER TABLE songs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'local'",
    ),
    (
        "remote_source_id",
        "ALTER TABLE songs ADD COLUMN remote_source_id TEXT",
    ),
    ("remote_uri", "ALTER TABLE songs ADD COLUMN remote_uri TEXT"),
    ("remote_etag", "ALTER TABLE songs ADD COLUMN remote_etag TEXT"),
    ("cache_path", "ALTER TABLE songs ADD COLUMN cache_path TEXT"),
    (
        "cue_source_path",
        "ALTER TABLE songs ADD COLUMN cue_source_path TEXT",
    ),
    (
        "cue_start_offset",
        "ALTER TABLE songs ADD COLUMN cue_start_offset INTEGER",
    ),
    (
        "cue_end_offset",
        "ALTER TABLE songs ADD COLUMN cue_end_offset INTEGER",
    ),
    ("comment", "ALTER TABLE songs ADD COLUMN comment TEXT"),
];

/// 尚未记录入库时间的曲目筛选条件。
const SELECT_PATHS_WITHOUT_ADDED_AT: &str =
    "SELECT path FROM songs WHERE added_at IS NULL OR TRIM(CAST(added_at AS TEXT)) = ''";

/// 仅在入库时间仍为空时写入文件时间戳。
const STAMP_SINGLE_ADDED_AT: &str = "UPDATE songs
             SET added_at = ?1
             WHERE path = ?2 AND (added_at IS NULL OR TRIM(CAST(added_at AS TEXT)) = '')";

/// 读取指定表的全部列名；表不存在时返回错误。
fn load_column_names(conn: &Connection, table_name: &str) -> Result<Vec<String>, String> {
    let sql = format!("PRAGMA table_info({table_name})");
    let mut stmt = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get(1))
        .map_err(|err| err.to_string())?
        .flatten()
        .collect();
    Ok(names)
}

/// 通用补列流程：仅对当前缺失的列执行对应 ALTER 语句。
fn add_missing_columns(
    conn: &Connection,
    table: &str,
    upgrades: &[(&str, &str)],
) -> Result<(), String> {
    let present = load_column_names(conn, table)?;
    for &(column, ddl) in upgrades {
        if !present.iter().any(|name| name == column) {
            conn.execute(ddl, []).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

/// 早期版本若因列结构异常无法识别 library_folders，则整表重建。
fn rebuild_library_folders_if_legacy(conn: &Connection) -> Result<(), String> {
    let present = load_column_names(conn, "library_folders")?;
    if present.iter().any(|name| name == "path") {
        return Ok(());
    }
    conn.execute("DROP TABLE IF EXISTS library_folders", [])
        .map_err(|err| err.to_string())?;
    conn.execute(
        "CREATE TABLE library_folders (
                path TEXT PRIMARY KEY,
                added_at INTEGER
            )",
        [],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 旧版曲库根目录存放于 sidebar_folders，此处并入 library_folders。
fn absorb_legacy_sidebar_folders(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO library_folders (path, added_at)
         SELECT path, added_at FROM sidebar_folders",
        [],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 补齐 songs 表缺失列。
fn widen_songs_table(conn: &Connection) -> Result<(), String> {
    add_missing_columns(conn, "songs", SONG_COLUMN_UPGRADES)
}

/// 确保远程音源相关的表与索引就绪。
fn ensure_remote_sync_objects(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS remote_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            base_url TEXT NOT NULL,
            username TEXT,
            password TEXT,
            root_path TEXT NOT NULL DEFAULT '/',
            enabled INTEGER NOT NULL DEFAULT 1,
            last_sync_at INTEGER,
            last_sync_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|err| err.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS remote_files (
            source_id TEXT NOT NULL,
            remote_path TEXT NOT NULL,
            remote_uri TEXT NOT NULL,
            name TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            etag TEXT,
            modified_at TEXT,
            is_audio INTEGER NOT NULL DEFAULT 0,
            indexed_at INTEGER NOT NULL,
            PRIMARY KEY (source_id, remote_path),
            FOREIGN KEY(source_id) REFERENCES remote_sources(id) ON DELETE CASCADE
        )",
        [],
    )
    .map_err(|err| err.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_songs_remote_source_id ON songs(remote_source_id)",
        [],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_remote_files_source_id ON remote_files(source_id)",
        [],
    )
    .map_err(|err| err.to_string())?;

    Ok(())
}

/// 从文件系统探询时间戳：优先取创建时间，缺省时退回修改时间。
fn probe_file_timestamp(path: &str) -> Option<i64> {
    let to_unix_secs = |time: std::time::SystemTime| {
        time.duration_since(UNIX_EPOCH)
            .ok()
            .map(|span| span.as_secs() as i64)
    };
    let meta = fs::metadata(path).ok()?;
    meta.created()
        .ok()
        .and_then(to_unix_secs)
        .or_else(|| meta.modified().ok().and_then(to_unix_secs))
}

/// 为入库时间缺失的旧曲目回填文件时间戳。
fn backfill_missing_added_at(conn: &Connection) -> Result<(), String> {
    let pending_paths: Vec<String> = {
        let mut reader = conn
            .prepare(SELECT_PATHS_WITHOUT_ADDED_AT)
            .map_err(|err| err.to_string())?;
        let rows = reader
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|err| err.to_string())?;
        let collected: Vec<String> = rows.flatten().collect();
        collected
    };

    let mut writer = conn
        .prepare(STAMP_SINGLE_ADDED_AT)
        .map_err(|err| err.to_string())?;
    for path in pending_paths {
        let Some(unix_secs) = probe_file_timestamp(&path) else {
            continue;
        };
        writer
            .execute(rusqlite::params![unix_secs, path])
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// 补齐 play_history 表缺失列及其辅助索引。
fn widen_play_history_table(conn: &Connection) -> Result<(), String> {
    let present = load_column_names(conn, "play_history")?;

    if !present.iter().any(|name| name == "played_seconds") {
        conn.execute(
            "ALTER TABLE play_history ADD COLUMN played_seconds INTEGER DEFAULT 0",
            [],
        )
        .map_err(|err| err.to_string())?;
    }

    if present.iter().any(|name| name == "song_id") {
        return Ok(());
    }
    conn.execute("ALTER TABLE play_history ADD COLUMN song_id INTEGER", [])
        .map_err(|err| err.to_string())?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_play_history_song_id ON play_history(song_id)",
        [],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 确保响度数据表与索引就绪。
fn ensure_loudness_objects(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS song_loudness (
            song_id INTEGER PRIMARY KEY,
            song_path TEXT NOT NULL,
            loudness_lufs REAL,
            estimated_loudness_lufs REAL,
            sample_peak REAL,
            true_peak REAL,
            tag_track_gain_db REAL,
            tag_track_peak REAL,
            tag_album_gain_db REAL,
            tag_album_peak REAL,
            tag_r128_track_gain_db REAL,
            tag_r128_album_gain_db REAL,
            file_size INTEGER NOT NULL,
            file_modified_at INTEGER NOT NULL,
            file_hash TEXT,
            scan_source TEXT NOT NULL DEFAULT 'none',
            analyzer_name TEXT,
            analyzer_version INTEGER NOT NULL DEFAULT 1,
            scan_status TEXT NOT NULL DEFAULT 'pending',
            scanned_at INTEGER,
            error_message TEXT,
            FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
            CONSTRAINT check_scan_source CHECK (scan_source IN ('none', 'tag_replaygain', 'tag_r128', 'file_analysis')),
            CONSTRAINT check_scan_status CHECK (scan_status IN ('pending', 'scanning', 'scanned', 'failed'))
        )",
        [],
    )
    .map_err(|err| err.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_song_loudness_song_id ON song_loudness(song_id)",
        [],
    )
    .map_err(|err| err.to_string())?;

    Ok(())
}

/// 为 artists 表补充头像路径列。
fn widen_artists_table(conn: &Connection) -> Result<(), String> {
    let present = load_column_names(conn, "artists")?;
    if present.iter().any(|name| name == "avatar_path") {
        return Ok(());
    }
    conn.execute("ALTER TABLE artists ADD COLUMN avatar_path TEXT", [])
        .map_err(|err| format!("Failed to add avatar_path to artists: {}", err))?;
    Ok(())
}

/// 确保播放会话恢复表就绪。
fn ensure_playback_session_store(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS playback_session (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 确保歌曲背景图关联表就绪。
fn ensure_song_backgrounds_store(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS song_backgrounds (
            song_path TEXT PRIMARY KEY,
            background_path TEXT NOT NULL
        )",
        [],
    )
    .map_err(|err| format!("Failed to create song_backgrounds table: {}", err))?;
    Ok(())
}

/// 按固定顺序编排全部迁移步骤，整体包裹在单个事务中执行。
pub(crate) fn apply_all_migrations(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    rebuild_library_folders_if_legacy(&tx)?;
    absorb_legacy_sidebar_folders(&tx)?;
    widen_songs_table(&tx)?;
    ensure_remote_sync_objects(&tx)?;
    backfill_missing_added_at(&tx)?;
    widen_play_history_table(&tx)?;
    ensure_loudness_objects(&tx)?;
    widen_artists_table(&tx)?;
    ensure_playback_session_store(&tx)?;
    ensure_song_backgrounds_store(&tx)?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// 构造已通过基线建表的内存库。
    fn in_memory_library() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::schema::ensure_base_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn migration_on_fresh_schema_adds_avatar_path() {
        let conn = in_memory_library();
        apply_all_migrations(&conn).unwrap();

        let columns = load_column_names(&conn, "artists").unwrap();
        assert!(columns.iter().any(|name| name == "avatar_path"));
    }

    #[test]
    fn migration_upgrades_legacy_artists_without_losing_rows() {
        let conn = in_memory_library();

        // 还原旧版 artists 表结构并写入一行存量数据。
        conn.execute("DROP TABLE artists", []).unwrap();
        conn.execute(
            "CREATE TABLE artists (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE
            )",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO artists (name) VALUES ('测试歌手')", [])
            .unwrap();

        apply_all_migrations(&conn).unwrap();

        let columns = load_column_names(&conn, "artists").unwrap();
        assert!(columns.iter().any(|name| name == "avatar_path"));

        let kept_name: String = conn
            .query_row("SELECT name FROM artists WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(kept_name, "测试歌手");

        let avatar_path: Option<String> = conn
            .query_row("SELECT avatar_path FROM artists WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(avatar_path.is_none());
    }
}
