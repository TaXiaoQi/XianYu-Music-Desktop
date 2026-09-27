// 远程曲库同步：目录遍历结果到歌曲库的解析、增量判定与落库。
use super::{cache, webdav};
use super::repository::{update_song_cache_path, update_sync_status, replace_remote_files};
use super::types::{RemoteFileEntry, RemoteSourceCredentials, RemoteSyncProgress, RemoteSyncResult};
use rusqlite::{params};
use std::path::{Path};
use tauri::AppHandle;
use tauri::Emitter;
use crate::music::scanner::{parse_song_from_file, apply_scan_changes};
use crate::music::types::{Song};
use crate::music::utils::i64_to_bool;
use crate::music::utils::{i64_to_u64_opt, i64_to_u8_opt};
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::Mutex;

/// 同步进度事件名（前端契约，冻结）。
const PROGRESS_EVENT: &str = "remote-sync-progress";

/// 上游占位文案，用于识别“尚未填入真实元数据”的字段。
const UNKNOWN_ARTIST: &str = "未知歌手";
const UNKNOWN_ALBUM: &str = "未知专辑";

/// 同步前从库内读出的单文件快照，用于跳过未变化的文件。
#[derive(Clone)] struct IndexedRemoteSong {
    etag: Option<String>, size: u64,
    modified_at: Option<String>, song: Option<Song>,
}

// ---------------------------------------------------------------------------
// 文件名 / 路径启发式
// ---------------------------------------------------------------------------

/// 取小写扩展名；无扩展名时返回空串。
fn extension_of(path: &str) -> String {
    path.rsplit('.').next().map(|value| value.to_ascii_lowercase()).unwrap_or_default()
}

/// 去掉扩展名后的标题候选。
fn title_stem(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, _)) => stem.to_string(),
        None => name.to_string(),
    }
}

/// 专辑名回退：取路径倒数第二段（最后一段是文件名）；不足两段时用占位文案。
fn album_guess(path: &str) -> String {
    let segments: Vec<&str> = path
        .split('/')
        .map(|segment| segment.trim())
        .filter(|segment| !segment.is_empty())
        .collect();
    match segments.len() {
        len if len >= 2 => segments[len - 2].to_string(),
        _ => UNKNOWN_ALBUM.to_string(),
    }
}

/// 空串或占位文案都视为“未填写”。
fn unfilled(value: &str, placeholder: &str) -> bool {
    let stripped = value.trim();
    stripped.is_empty() || stripped == placeholder
}

/// “标题 - 歌手”类文件名的分隔符候选，按优先级排列。
const FILENAME_SEPARATORS: [&str; 6] = [" - ", "-", " – ", "–", " — ", "—"];

/// 尝试把文件名拆成 (标题, 歌手)。
fn split_stem_title_artist(name: &str) -> Option<(String, String)> {
    let stem = title_stem(name);
    FILENAME_SEPARATORS.iter().find_map(|separator| {
        match stem.rsplit_once(separator) {
            Some((title, artist))
                if !title.trim().is_empty() && !artist.trim().is_empty() =>
            {
                Some((title.trim().to_string(), artist.trim().to_string()))
            }
            _ => None,
        }
    })
}

/// 用确定的歌手值覆写歌曲的全部歌手相关字段，并重算专辑键。
fn overwrite_artist_block(song: &mut Song, artist: String) {
    song.artist = artist.clone(); song.artist_names = vec![artist.clone()];
    song.effective_artist_names = vec![artist.clone()]; song.album_artist = artist;
    song.album_key = format!("{}::{}", song.album.to_lowercase(), song.album_artist.to_lowercase());
}

/// 解析结果缺失标题/歌手时，用文件名启发式补齐。
fn apply_name_heuristics(song: &mut Song, file: &RemoteFileEntry) {
    let artist_missing = unfilled(&song.artist, UNKNOWN_ARTIST);
    let title_missing = song.title.trim().is_empty() || song.title == title_stem(&file.name);
    if !(artist_missing || title_missing) { return; }
    let Some((title, artist)) = split_stem_title_artist(&file.name) else { return };
    if title_missing { song.title = title; }
    if artist_missing { overwrite_artist_block(song, artist); }
}

// ---------------------------------------------------------------------------
// 歌曲构造
// ---------------------------------------------------------------------------

/// 不下载音频、仅凭目录条目构造的占位歌曲（首扫索引用）。
fn stub_song_for_remote_entry(source: &RemoteSourceCredentials, file: &RemoteFileEntry) -> Song {
    let uri = file.remote_uri(&source.id);
    let artist = UNKNOWN_ARTIST.to_string();
    let album = album_guess(&file.remote_path);

    let mut indexed = Song {
        id: None, artist_avatar_bytes: None,
        name: file.name.clone(), title: title_stem(&file.name), path: uri,
        artist: artist.clone(), artist_names: vec![artist.clone()], effective_artist_names: vec![artist.clone()],
        album: album.clone(), album_artist: artist.clone(),
        album_key: [album.to_lowercase(), artist.to_lowercase()].join("::"),
        is_various_artists_album: false, collapse_artist_credits: false,
        duration: 0, cover_thumb_path: None, bitrate: 0, sample_rate: 0, bit_depth: None,
        format: extension_of(&file.remote_path), container: None, codec: None,
        file_size: file.size, track_number: None, disc_number: None,
        added_at: None, file_modified_at: None,
        cue_source_path: None, cue_start_offset: None, cue_end_offset: None,
        comment: None, artist_avatar_path: None,
    };
    apply_name_heuristics(&mut indexed, file);
    indexed
}

/// 缓存文件已存在时，用其内嵌标签 enrich 出索引歌曲；解析失败返回 None。
pub(crate) fn song_from_cached_remote_file(
    source: &RemoteSourceCredentials, file: &RemoteFileEntry, cache_path: &Path,
) -> Option<Song> {
    let uri = file.remote_uri(&source.id);
    let format = extension_of(&file.remote_path);
    let mut merged = parse_song_from_file(cache_path, &uri, &format)?;
    let fallback = stub_song_for_remote_entry(source, file);

    merged.name = file.name.clone();
    if merged.format.trim().is_empty() {
        merged.format = fallback.format;
    }
    // 文件大小以目录条目为准（>0 时），时间字段由库统一管理。
    if file.size > 0 {
        merged.file_size = file.size;
    }
    merged.added_at = None;
    merged.file_modified_at = None;

    // 缓存文件名是哈希，解析出的同名标题不可信，回退到目录条目的标题。
    let cache_stem = cache_path.file_stem().map(|value| value.to_string_lossy().into_owned()).unwrap_or_default();
    if merged.title.trim().is_empty() || (!cache_stem.is_empty() && merged.title == cache_stem) {
        merged.title = fallback.title;
    }
    if unfilled(&merged.artist, UNKNOWN_ARTIST) {
        merged.artist = fallback.artist;
    }
    if merged.artist_names.is_empty() {
        merged.artist_names = fallback.artist_names;
    }
    if merged.effective_artist_names.is_empty() {
        merged.effective_artist_names = merged.artist_names.clone();
    }
    if unfilled(&merged.album, UNKNOWN_ALBUM) {
        merged.album = fallback.album;
    }
    if merged.album_artist.trim().is_empty() {
        merged.album_artist = merged.artist.clone();
    }
    if merged.album_key.trim().is_empty() {
        merged.album_key = format!("{0}::{1}", merged.album.to_lowercase(), merged.album_artist.to_lowercase());
    }
    apply_name_heuristics(&mut merged, file);

    Some(merged)
}

/// 下载进缓存并解析；缓存失败时退回占位歌曲，保证文件仍可入索引。
async fn fetch_and_parse(app: &AppHandle, source: &RemoteSourceCredentials, file: &RemoteFileEntry) -> (Song, Option<String>) {
    let uri = file.remote_uri(&source.id);
    let cached = cache::cache_remote_file(app, source, &file.remote_path, &uri, file.etag.as_deref()).await;

    match cached {
        Ok(cache_path) => {
            let target = Path::new(&cache_path);
            let enriched = song_from_cached_remote_file(source, file, target)
                .unwrap_or_else(|| stub_song_for_remote_entry(source, file));
            (enriched, Some(cache_path))
        }
        Err(_) => (stub_song_for_remote_entry(source, file), None),
    }
}

// ---------------------------------------------------------------------------
// 增量判定
// ---------------------------------------------------------------------------

/// 双方修改时间都存在时比较，否则视为未变化。
fn modified_differs(before: Option<&str>, after: Option<&str>) -> bool {
    let (Some(left), Some(right)) = (before, after) else { return false };
    left != right
}

/// 判断目录条目相对库内快照是否需要重新下载解析：
/// 无快照 / 无歌曲 / 媒体字段缺失 → 刷新；etag 双方齐全时比较 etag，否则比较大小与修改时间。
fn entry_outdated(snapshot: Option<&IndexedRemoteSong>, file: &RemoteFileEntry) -> bool {
    let Some(snap) = snapshot else { return true };
    let Some(song) = snap.song.as_ref() else { return true };
    if song.duration == 0 || song.bitrate == 0 || song.sample_rate == 0 { return true; }

    match (snap.etag.as_deref(), file.etag.as_deref()) {
        (Some(old), Some(new)) if !old.is_empty() && !new.is_empty() => old != new,
        _ => snap.size != file.size
            || modified_differs(snap.modified_at.as_deref(), file.modified_at.as_deref()),
    }
}

/// JSON 字符串列反序列化；坏数据按空列表处理。
fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str(&value).ok()).unwrap_or_default()
}

/// i64 列转 u32，负数与空值回落 0。
fn i64_to_u32(value: Option<i64>) -> u32 {
    let raw = value.unwrap_or(0);
    raw.clamp(0, u32::MAX as i64) as u32
}

/// 从 JOIN 行读取已入库歌曲（songs 侧无行时返回 None）。列序与快照 SQL 一一对应。
fn read_joined_song(row: &rusqlite::Row<'_>) -> rusqlite::Result<Option<Song>> {
    let stored_path: Option<String> = row.get(5)?;
    let Some(path) = stored_path else {
        return Ok(None);
    };

    let display_name = Path::new(&path).file_name().map(|value| value.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
    let artists = deserialize_string_list(row.get::<_, Option<String>>(8)?);
    let credits = deserialize_string_list(row.get::<_, Option<String>>(9)?);

    Ok(Some(Song {
        id: row.get::<_, Option<i64>>(4)?, artist_avatar_bytes: None, name: display_name, path,
        title: row.get::<_, Option<String>>(6)?.unwrap_or_default(), artist: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        artist_names: artists, effective_artist_names: credits,
        album: row.get::<_, Option<String>>(10)?.unwrap_or_default(), album_artist: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
        album_key: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
        is_various_artists_album: i64_to_bool(row.get::<_, Option<i64>>(13)?),
        collapse_artist_credits: i64_to_bool(row.get::<_, Option<i64>>(14)?),
        duration: i64_to_u32(row.get::<_, Option<i64>>(15)?), cover_thumb_path: row.get::<_, Option<String>>(16)?,
        bitrate: i64_to_u32(row.get::<_, Option<i64>>(17)?), sample_rate: i64_to_u32(row.get::<_, Option<i64>>(18)?),
        bit_depth: i64_to_u8_opt(row.get::<_, Option<i64>>(19)?), format: row.get::<_, Option<String>>(20)?.unwrap_or_default(),
        container: row.get::<_, Option<String>>(21)?, codec: row.get::<_, Option<String>>(22)?,
        file_size: row.get::<_, Option<i64>>(23)?.unwrap_or(0).max(0) as u64, track_number: row.get::<_, Option<String>>(24)?,
        disc_number: row.get::<_, Option<String>>(25)?, added_at: i64_to_u64_opt(row.get::<_, Option<i64>>(26)?),
        file_modified_at: i64_to_u64_opt(row.get::<_, Option<i64>>(27)?),
        cue_source_path: None, cue_start_offset: None, cue_end_offset: None,
        comment: row.get::<_, Option<String>>(28)?, artist_avatar_path: None,
    }))
}

/// 读取该音源全部音频条目的快照，按 remote_uri 索引。
fn load_snapshots(conn: &rusqlite::Connection, source_id: &str) -> Result<HashMap<String, IndexedRemoteSong>, String> {
    let mut stmt = conn.prepare(
            "SELECT
                rf.remote_uri,
                rf.etag,
                rf.size,
                rf.modified_at,
                s.id,
                s.path,
                s.title,
                s.artist,
                s.artist_names,
                s.effective_artist_names,
                s.album,
                s.album_artist,
                s.album_key,
                s.is_various_artists_album,
                s.collapse_artist_credits,
                s.duration,
                s.cover_thumb_path,
                s.bitrate,
                s.sample_rate,
                s.bit_depth,
                s.format,
                s.container,
                s.codec,
                s.file_size,
                s.track_number,
                s.disc_number,
                s.added_at,
                s.file_modified_at,
                s.comment
             FROM remote_files rf
             LEFT JOIN songs s ON s.path = rf.remote_uri
             WHERE rf.source_id = ?1 AND rf.is_audio = 1",
        )
        .map_err(|e| e.to_string())?;

    let mapped = stmt.query_map([source_id], |row| {
        let uri: String = row.get(0)?;
        let snapshot = IndexedRemoteSong {
            etag: row.get::<_, Option<String>>(1)?, size: row.get::<_, i64>(2)?.max(0) as u64,
            modified_at: row.get::<_, Option<String>>(3)?, song: read_joined_song(row)?,
        };
        Ok((uri, snapshot))
    })
    .map_err(|e| e.to_string())?;

    let mut indexed: HashMap<String, IndexedRemoteSong> = HashMap::new();
    for pair in mapped {
        let (uri, snapshot) = pair.map_err(|e| e.to_string())?;
        indexed.insert(uri, snapshot);
    }
    Ok(indexed)
}

// ---------------------------------------------------------------------------
// 同步主流程
// ---------------------------------------------------------------------------

/// 广播同步进度（事件名与负载结构冻结）。
fn publish_sync_progress(
    app: &AppHandle, source_id: &str, phase: &str, current: usize, total: usize,
    message: impl Into<String>, done: bool, failed: bool,
) {
    let payload = RemoteSyncProgress {
        source_id: source_id.to_string(), phase: phase.to_string(),
        current, total, message: message.into(), done, failed,
    };
    let _ = app.emit(PROGRESS_EVENT, payload);
}

/// 列出该音源当前在歌曲库中的全部路径。
fn song_paths_of_source(conn: &rusqlite::Connection, source_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT path FROM songs WHERE remote_source_id = ?1").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([source_id], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

/// 为全部条目打上远程归属标记（source_type / remote_source_id / remote_uri / remote_etag）。
fn stamp_remote_ownership(
    conn: &rusqlite::Connection, source: &RemoteSourceCredentials, files: &[RemoteFileEntry],
) -> Result<(), String> {
    let mut stmt = conn.prepare(
            "UPDATE songs
             SET source_type = 'remote',
                 remote_source_id = ?1,
                 remote_uri = ?2,
                 remote_etag = ?3
             WHERE path = ?2",
        )
        .map_err(|e| e.to_string())?;

    for item in files {
        let uri = item.remote_uri(&source.id);
        stmt.execute(params![&source.id, uri, &item.etag]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 单个事务内完成索引替换、歌曲增删改、远程标记与缓存路径回写。
fn persist_sync_results(
    db_conn: &Arc<Mutex<rusqlite::Connection>>, source: &RemoteSourceCredentials,
    files: &[RemoteFileEntry], songs: &[Song], cache_updates: &[(String, String)],
) -> Result<(), String> {
    let mut conn = db_conn.lock().map_err(|e| e.to_string())?;

    // 本次扫描未再出现的旧歌曲需要清理。
    let kept: HashSet<&str> = songs.iter().map(|song| song.path.as_str()).collect();
    let stale: Vec<String> = song_paths_of_source(&conn, &source.id)?.into_iter().filter(|path| !kept.contains(path.as_str())).collect();

    replace_remote_files(&mut conn, &source.id, files)?;
    apply_scan_changes(&mut conn, songs, &[], &stale, None)?;
    stamp_remote_ownership(&conn, source, files)?;
    for (uri, artifact) in cache_updates {
        update_song_cache_path(&conn, uri, artifact)?;
    }
    update_sync_status(&conn, &source.id, None)
}

/// 同步一个远程音源：遍历目录 → 逐文件增量解析 → 事务落库。
pub(crate) async fn sync_source(
    app: AppHandle, db_conn: Arc<Mutex<rusqlite::Connection>>, source: RemoteSourceCredentials,
) -> Result<RemoteSyncResult, String> {
    publish_sync_progress(&app, &source.id, "scanning", 0, 0, "正在读取远程目录", false, false);

    let gathered = webdav::collect_audio_files(&source).await;
    let files = match gathered {
        Ok(list) => list,
        Err(e) => {
            if let Ok(guard) = db_conn.lock() {
                let _ = update_sync_status(&guard, &source.id, Some(&e));
            }
            publish_sync_progress(&app, &source.id, "error", 0, 0, e.clone(), true, true);
            return Err(e);
        }
    };

    let snapshots = {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let loaded = load_snapshots(&conn, &source.id);
        match loaded {
            Ok(found) => found,
            Err(e) => {
                let _ = update_sync_status(&conn, &source.id, Some(&e));
                publish_sync_progress(&app, &source.id, "error", 0, 0, e.clone(), true, true);
                return Err(e);
            }
        }
    };

    // 逐文件处理：未变化的直接复用快照歌曲，其余下载缓存后解析。
    let total_count = files.len();
    let mut parsed_songs: Vec<Song> = Vec::with_capacity(files.len());
    let mut cache_updates: Vec<(String, String)> = Vec::new();
    for (position, file) in files.iter().enumerate() {
        publish_sync_progress(&app, &source.id, "parsing", position + 1, total_count, format!("正在解析 {}", file.name), false, false);

        let uri = file.remote_uri(&source.id);
        let reusable = snapshots
            .get(&uri)
            .and_then(|snapshot| {
                (!entry_outdated(Some(snapshot), file))
                    .then(|| snapshot.song.clone())
                    .flatten()
            });
        if let Some(song) = reusable {
            parsed_songs.push(song);
            continue;
        }

        let (song, artifact) = fetch_and_parse(&app, &source, file).await;
        if let Some(artifact) = artifact {
            cache_updates.push((uri, artifact));
        }
        parsed_songs.push(song);
    }

    publish_sync_progress(&app, &source.id, "writing", total_count, total_count, "正在写入音乐库", false, false);

    if let Err(e) = persist_sync_results(&db_conn, &source, &files, &parsed_songs, &cache_updates) {
        if let Ok(guard) = db_conn.lock() {
            let _ = update_sync_status(&guard, &source.id, Some(&e));
        }
        publish_sync_progress(&app, &source.id, "error", total_count, total_count, e.clone(), true, true);
        return Err(e);
    }

    publish_sync_progress(&app, &source.id, "complete", total_count, total_count, "同步完成", true, false);
    Ok(RemoteSyncResult { source_id: source.id, indexed_files: files.len(), audio_files: files.len(), parsed_songs: parsed_songs.len() })
}

#[cfg(test)] mod tests {
    use super::{
        apply_name_heuristics, entry_outdated, song_from_cached_remote_file,
        stub_song_for_remote_entry, IndexedRemoteSong, RemoteFileEntry, RemoteSourceCredentials, Song,
    };
    use id3::{Tag, TagLike, Version};
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn entry(etag: Option<&str>, size: u64, modified_at: Option<&str>) -> RemoteFileEntry {
        let sample = RemoteFileEntry {
            remote_path: "/demo.flac".into(), name: "demo.flac".into(), size,
            etag: etag.map(ToOwned::to_owned), modified_at: modified_at.map(ToOwned::to_owned), is_dir: false,
        };
        sample
    }

    fn source() -> RemoteSourceCredentials {
        let credentials = RemoteSourceCredentials {
            id: "source".into(), name: "Source".into(), provider: "webdav".into(),
            base_url: "https://example.com".into(), username: None, password: None,
            root_path: "/".into(), enabled: true,
            last_sync_at: None, last_sync_error: None, created_at: 0, updated_at: 0,
        };
        credentials
    }

    const FIXED_MODIFIED: &str = "Mon, 04 May 2026 10:00:00 GMT";

    /// 媒体字段齐全的快照歌曲（视为已完整解析）。
    fn complete_song() -> Song {
        let mut song = stub_song_for_remote_entry(&source(), &entry(Some("etag-a"), 1024, Some(FIXED_MODIFIED)));
        song.duration = 180; song.bitrate = 320; song.sample_rate = 44_100; song
    }

    fn unique_temp_path(ext: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        std::env::temp_dir().join(format!("xianyu_remote_scan_{nanos}.{ext}"))
    }

    /// 生成带 ID3v2.3 标签的最小 MP3 文件。
    fn make_tagged_mp3(path: &std::path::Path) {
        let mut tag = Tag::new();
        tag.set_title("Remote Title"); tag.set_artist("Remote Artist");
        tag.set_album("Remote Album"); tag.set_album_artist("Remote Album Artist");

        let mut bytes: Vec<u8> = Vec::new();
        tag.write_to(&mut bytes, Version::Id3v23).expect("id3 tag should serialize");
        bytes.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x64]);
        bytes.extend(std::iter::repeat(0).take(413));

        fs::write(path, bytes).expect("failed writing temp mp3");
    }

    #[test]
    fn untouched_entry_with_complete_song_skips_refresh() {
        let snapshot = IndexedRemoteSong {
            etag: Some("etag-a".into()), size: 1024, modified_at: Some(FIXED_MODIFIED.into()),
            song: Some(complete_song()),
        };
        // etag 相同即可跳过，size / 修改时间差异不影响判定。
        assert!(!entry_outdated(Some(&snapshot), &entry(Some("etag-a"), 2048, Some("changed"))));
    }

    #[test]
    fn index_stub_carries_uri_and_zero_media_fields() {
        let song = stub_song_for_remote_entry(&source(), &entry(Some("etag-a"), 12_345, Some(FIXED_MODIFIED)));

        assert_eq!((song.path.as_str(), song.title.as_str(), song.file_size), ("remote://source/demo.flac", "demo", 12_345));
        assert_eq!((song.duration, song.bitrate, song.sample_rate), (0, 0, 0));
    }

    #[test]
    fn index_stub_infers_album_from_parent_directory() {
        let mut file = entry(Some("etag-a"), 12_345, None);
        file.remote_path = "/Artist/Album/demo.flac".into();

        let song = stub_song_for_remote_entry(&source(), &file);

        assert_eq!((song.album.as_str(), song.album_key.as_str()), ("Album", "album::未知歌手"));
    }

    #[test]
    fn filename_heuristic_extracts_title_and_artist() {
        let mut file = entry(Some("etag-a"), 12_345, None);
        file.remote_path = "/Album/爱琴海-周杰伦.mp3".into();
        file.name = "爱琴海-周杰伦.mp3".into();
        let mut song = stub_song_for_remote_entry(&source(), &file);

        apply_name_heuristics(&mut song, &file);

        assert_eq!(
            (song.title.as_str(), song.album_key.as_str(), song.artist_names),
            ("爱琴海", "album::周杰伦", vec!["周杰伦".to_string()])
        );
    }

    #[test]
    fn cached_parse_prefers_embedded_tags() {
        let mut file = entry(Some("etag-a"), 12_345, None);
        file.remote_path = "/remote/demo.mp3".into();
        file.name = "demo.mp3".into();
        let temp_path = unique_temp_path("mp3");
        make_tagged_mp3(&temp_path);

        let song = song_from_cached_remote_file(&source(), &file, &temp_path)
            .expect("cached parse should succeed");

        assert_eq!(
            (song.path.as_str(), song.artist_names, song.album_key.as_str()),
            ("remote://source/remote/demo.mp3", vec!["Remote Artist".to_string()], "remote album::remote album artist")
        );
        assert_eq!(
            (song.title.as_str(), song.artist.as_str(), song.album.as_str()),
            ("Remote Title", "Remote Artist", "Remote Album")
        );
        assert_eq!(song.album_artist, "Remote Album Artist"); assert_eq!(song.format, "mp3"); assert!(song.file_size > 0);

        let _ = fs::remove_file(&temp_path);
    }

    #[test]
    fn stub_media_fields_force_refresh_despite_matching_etag() {
        let snapshot = IndexedRemoteSong {
            etag: Some("etag-a".into()), size: 1024, modified_at: Some(FIXED_MODIFIED.into()),
            song: Some(stub_song_for_remote_entry(&source(), &entry(Some("etag-a"), 1024, Some(FIXED_MODIFIED)))),
        };

        assert!(entry_outdated(Some(&snapshot), &entry(Some("etag-a"), 1024, Some(FIXED_MODIFIED))));
    }

    #[test]
    fn etag_change_triggers_refresh() {
        let snapshot = IndexedRemoteSong {
            etag: Some("etag-a".into()), size: 1024, modified_at: Some(FIXED_MODIFIED.into()), song: None,
        };

        assert!(entry_outdated(Some(&snapshot), &entry(Some("etag-b"), 1024, Some(FIXED_MODIFIED))));
    }

    #[test]
    fn missing_song_triggers_refresh() {
        let snapshot = IndexedRemoteSong {
            etag: Some("etag-a".into()), size: 1024, modified_at: Some(FIXED_MODIFIED.into()), song: None,
        };

        assert!(entry_outdated(Some(&snapshot), &entry(Some("etag-a"), 1024, Some(FIXED_MODIFIED))));
    }
}
