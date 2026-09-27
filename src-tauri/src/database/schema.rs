// 基线结构定义：负责连接参数调优与新库的初始化建表。
// 注意：本文件内所有 SQL 文本属于数据兼容性契约，必须逐字保留，禁止改写。

use rusqlite::Connection;

/// 连接建立后立即生效的 PRAGMA 清单，顺序即生效顺序，不可调换。
const CONNECTION_PRAGMAS: &[(&str, &str)] = &[
    ("foreign_keys", "ON"),
    ("journal_mode", "WAL"),
    ("synchronous", "NORMAL"),
    ("temp_store", "MEMORY"),
];

/// 一条基线 DDL 步骤；`tolerant` 为 true 表示执行失败允许静默跳过。
struct DdlStep {
    sql: &'static str,
    tolerant: bool,
}

/// 失败即中断初始化的关键语句。
const fn must_apply(sql: &'static str) -> DdlStep {
    DdlStep {
        sql,
        tolerant: false,
    }
}

/// 失败可容忍的语句（沿用旧版对个别表与索引的容错语义）。
const fn best_effort(sql: &'static str) -> DdlStep {
    DdlStep { sql, tolerant: true }
}

/// 基线 DDL 序列，条目顺序即历史建表顺序，保持不变。
const BASE_SCHEMA: &[DdlStep] = &[
    must_apply(
        "CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            title TEXT,
            artist TEXT,
            artist_names TEXT,
            effective_artist_names TEXT,
            album TEXT,
            album_artist TEXT,
            album_key TEXT,
            is_various_artists_album INTEGER DEFAULT 0,
            collapse_artist_credits INTEGER DEFAULT 0,
            duration INTEGER,
            cover_path TEXT,
            cover_thumb_path TEXT,
            bitrate INTEGER,
            sample_rate INTEGER,
            bit_depth INTEGER,
            format TEXT,
            container TEXT,
            codec TEXT,
            file_size INTEGER,
            track_number TEXT,
            disc_number TEXT,
            added_at INTEGER,
            file_modified_at INTEGER,
            source_type TEXT NOT NULL DEFAULT 'local',
            remote_source_id TEXT,
            remote_uri TEXT,
            remote_etag TEXT,
            cache_path TEXT,
            cue_source_path TEXT,
            cue_start_offset INTEGER,
            cue_end_offset INTEGER,
            comment TEXT
        )",
    ),
    must_apply(
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
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS song_backgrounds (
            song_path TEXT PRIMARY KEY,
            background_path TEXT NOT NULL
        )",
    ),
    must_apply(
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
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS artists (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            avatar_path TEXT
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS song_artists (
            song_id INTEGER NOT NULL,
            artist_id INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (song_id, artist_id),
            FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
            FOREIGN KEY(artist_id) REFERENCES artists(id) ON DELETE CASCADE
        )",
    ),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_song_artists_artist_id ON song_artists(artist_id)",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS library_folders (
            path TEXT PRIMARY KEY,
            added_at INTEGER
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS sidebar_folders (
            path TEXT PRIMARY KEY,
            added_at INTEGER
        )",
    ),
    best_effort(
        "CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY,
            song_path TEXT NOT NULL,
            played_at INTEGER NOT NULL,
            event TEXT DEFAULT 'play'
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS statistics_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS global_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_play_count INTEGER NOT NULL DEFAULT 0,
            total_play_time_ms INTEGER NOT NULL DEFAULT 0,
            first_played_at TEXT,
            last_played_at TEXT
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS song_stats (
            id INTEGER PRIMARY KEY,
            strict_identity_key TEXT NOT NULL UNIQUE,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            track_number INTEGER,
            play_count INTEGER NOT NULL DEFAULT 0,
            play_time_ms INTEGER NOT NULL DEFAULT 0,
            full_play_count INTEGER NOT NULL DEFAULT 0,
            skip_count INTEGER NOT NULL DEFAULT 0,
            first_played_at TEXT,
            last_played_at TEXT
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS daily_stats (
            date TEXT PRIMARY KEY,
            play_count INTEGER NOT NULL DEFAULT 0,
            play_time_ms INTEGER NOT NULL DEFAULT 0,
            unique_songs INTEGER NOT NULL DEFAULT 0,
            unique_artists INTEGER NOT NULL DEFAULT 0
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS hourly_stats (
            hour INTEGER PRIMARY KEY,
            play_count INTEGER NOT NULL DEFAULT 0,
            play_time_ms INTEGER NOT NULL DEFAULT 0
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS daily_unique_song_entries (
            date TEXT NOT NULL,
            song_identity_key TEXT NOT NULL,
            PRIMARY KEY (date, song_identity_key)
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS daily_unique_artist_entries (
            date TEXT NOT NULL,
            artist_key TEXT NOT NULL,
            PRIMARY KEY (date, artist_key)
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS recent_plays (
            id INTEGER PRIMARY KEY,
            recent_dedupe_key TEXT NOT NULL UNIQUE,
            played_at TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            listened_ms INTEGER NOT NULL DEFAULT 0,
            is_full_play INTEGER NOT NULL DEFAULT 0,
            is_skip INTEGER NOT NULL DEFAULT 0
        )",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS imported_exports_log (
            export_id TEXT PRIMARY KEY,
            imported_at TEXT NOT NULL
        )",
    ),
    best_effort("CREATE INDEX IF NOT EXISTS idx_songs_added_at ON songs(added_at)"),
    best_effort("CREATE INDEX IF NOT EXISTS idx_songs_album_key ON songs(album_key)"),
    best_effort("CREATE INDEX IF NOT EXISTS idx_songs_album_artist ON songs(album_artist)"),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at)",
    ),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_song_stats_play_count ON song_stats(play_count DESC)",
    ),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_song_stats_play_time_ms ON song_stats(play_time_ms DESC)",
    ),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_recent_plays_played_at ON recent_plays(played_at DESC)",
    ),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_songs_remote_source_id ON songs(remote_source_id)",
    ),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_songs_cue_source_path ON songs(cue_source_path)",
    ),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_remote_files_source_id ON remote_files(source_id)",
    ),
    must_apply(
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
    ),
    best_effort(
        "CREATE INDEX IF NOT EXISTS idx_song_loudness_song_id ON song_loudness(song_id)",
    ),
    must_apply(
        "CREATE TABLE IF NOT EXISTS playback_session (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    ),
];

/// 为连接逐项应用统一的 PRAGMA 配置。
pub(crate) fn tune_connection(conn: &Connection) -> Result<(), String> {
    for &(key, value) in CONNECTION_PRAGMAS {
        conn.pragma_update(None, key, value)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// 按既定顺序补齐基线表与索引；容错步骤失败时不阻断后续步骤。
pub(crate) fn ensure_base_schema(conn: &Connection) -> Result<(), String> {
    for step in BASE_SCHEMA {
        if let Err(err) = conn.execute(step.sql, []) {
            if !step.tolerant {
                return Err(err.to_string());
            }
        }
    }
    Ok(())
}
