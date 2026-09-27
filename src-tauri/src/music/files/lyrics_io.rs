// 歌词读写链路：伴生 LRC 文件发现/写入、内嵌歌词覆写、歌词编辑命令。

use super::super::lyrics::{build_structured_lyrics_payload, StructuredLyricsPayload};
use super::super::tags::{
    extract_embedded_lyrics, extract_embedded_lyrics_match, read_tagged_file_from_path,
};
use super::super::types::{LyricsStorageSource, SongLyricsForEdit};
use super::super::utils::normalize_path;
use crate::database::DbState;
use crate::remote::{cache::is_remote_uri, repository::{get_song_cache_path, get_source_for_remote_uri}, webdav};
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

/// 歌词文件允许的最大体积（防止误选超大文本拖垮 UI）。
const MAX_LYRICS_FILE_SIZE: u64 = 2 * 1024 * 1024;
const SIDECAR_SUFFIXES: [&str; 6] = ["lrc", "ttml", "qrc", "yrc", "lys", "txt"];

// ---- 伴生歌词文件的发现 ----

fn locate_sidecar_lyrics_file(path_obj: &Path) -> Option<(String, PathBuf)> {
    let stem = path_obj.file_stem()?.to_string_lossy().to_string();
    let parent = path_obj.parent()?;

    // 先按 <同名>.<扩展名> 精确探测，再忽略大小写扫描目录。
    for ext in SIDECAR_SUFFIXES {
        let exact_path = parent.join(format!("{}.{}", stem, ext));
        if let Ok(bytes) = fs::read(&exact_path) {
            return Some((super::lyrics_codec::decode_lyrics_file_bytes(&bytes), exact_path));
        }
    }

    for entry in fs::read_dir(parent).ok()?.flatten() {
        let candidate = entry.path();
        if !candidate.is_file() {
            continue;
        }

        let matches_suffix = candidate
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| SIDECAR_SUFFIXES.iter().any(|&valid| ext.eq_ignore_ascii_case(valid)))
            .unwrap_or(false);
        if !matches_suffix {
            continue;
        }

        let candidate_stem = candidate.file_stem()?.to_string_lossy().to_string();
        if !candidate_stem.eq_ignore_ascii_case(&stem) {
            continue;
        }

        if let Ok(bytes) = fs::read(&candidate) {
            return Some((super::lyrics_codec::decode_lyrics_file_bytes(&bytes), candidate));
        }
    }

    None
}

fn sidecar_lyrics_content(path_obj: &Path) -> Option<String> {
    locate_sidecar_lyrics_file(path_obj).map(|(content, _)| content)
}

/// 歌词写入的默认落点：同名 .lrc。
fn default_sidecar_path(path_obj: &Path) -> Result<PathBuf, String> {
    let stem = path_obj
        .file_stem()
        .ok_or_else(|| "Invalid song path".to_string())?
        .to_string_lossy()
        .to_string();
    let parent = path_obj
        .parent()
        .ok_or_else(|| "Song parent folder does not exist".to_string())?;

    Ok(parent.join(format!("{}.lrc", stem)))
}

/// 远程歌曲的伴生歌词路径（正斜杠目录风格）。
fn remote_sidecar_candidate(remote_path: &str) -> Option<String> {
    let normalized = remote_path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    let (parent, file_name) = trimmed.rsplit_once('/')?;
    let stem = file_name.rsplit_once('.').map(|(stem, _)| stem)?;
    let parent = if parent.is_empty() { "/" } else { parent };
    Some(format!("{}/{}.lrc", parent.trim_end_matches('/'), stem))
}

// ---- 歌词写入 ----

fn store_sidecar_lyrics(
    path_obj: &Path,
    source_path: Option<String>,
    lyrics: String,
) -> Result<String, String> {
    let lrc_path = source_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| default_sidecar_path(path_obj))?;

    fs::write(&lrc_path, lyrics).map_err(|e| e.to_string())?;

    Ok(normalize_path(&lrc_path.to_string_lossy()))
}

/// 按描述匹配移除旧条目后写回；空文本等价于删除。
fn replace_or_remove_tag_item(tag: &mut Tag, key: ItemKey, description: String, lyrics: String) {
    let _ = tag
        .take_filter(&key, |item| item.description() == description)
        .count();

    if lyrics.trim().is_empty() {
        return;
    }

    let mut item = TagItem::new(key.clone(), ItemValue::Text(lyrics));
    if !description.is_empty() {
        item.set_description(description);
    }

    if matches!(key, ItemKey::Unknown(_)) {
        tag.push_unchecked(item);
    } else {
        let _ = tag.push(item);
    }
}

fn embed_lyrics_into_file(path_obj: &Path, lyrics: String) -> Result<String, String> {
    let mut tagged_file = read_tagged_file_from_path(path_obj).map_err(|e| e.to_string())?;
    let current_lyrics = extract_embedded_lyrics_match(&tagged_file);
    // 沿用已有歌词条目所在的标签容器，否则落到主标签。
    let tag_type = current_lyrics
        .as_ref()
        .map(|lyrics_match| lyrics_match.tag_type)
        .unwrap_or_else(|| tagged_file.primary_tag_type());

    if tagged_file.tag_mut(tag_type).is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }

    let tag = tagged_file
        .tag_mut(tag_type)
        .ok_or_else(|| "Song file does not support writable lyrics tags".to_string())?;

    if let Some(lyrics_match) = current_lyrics {
        replace_or_remove_tag_item(tag, lyrics_match.item_key, lyrics_match.description, lyrics);
    } else if lyrics.trim().is_empty() {
        tag.remove_key(&ItemKey::Lyrics);
    } else {
        let _ = tag.insert_text(ItemKey::Lyrics, lyrics);
    }

    tagged_file
        .save_to_path(path_obj, WriteOptions::default())
        .map_err(|e| e.to_string())?;

    Ok(normalize_path(&path_obj.to_string_lossy()))
}

// ---- 歌词内容的读取（本地与远程） ----

pub(super) fn raw_lyrics_local(path: &str) -> String {
    if let Ok(tagged_file) = read_tagged_file_from_path(Path::new(path)) {
        if let Some(lyrics) = extract_embedded_lyrics(&tagged_file) {
            return lyrics;
        }
    }

    if let Some(content) = sidecar_lyrics_content(Path::new(path)) {
        return content;
    }

    String::new()
}

async fn raw_lyrics_remote(path: &str, db_state: &DbState) -> String {
    // 先在锁内完成远程源与本地缓存路径的查询，避免跨 await 持锁。
    let lookup_and_cache = {
        let conn = match db_state.conn.lock() {
            Ok(conn) => conn,
            Err(_) => return String::new(),
        };
        let lookup = get_source_for_remote_uri(&conn, path).ok();
        let cache_path = lookup
            .as_ref()
            .and_then(|(_, _, _, stored_remote_uri)| {
                get_song_cache_path(&conn, stored_remote_uri.as_deref().unwrap_or(path)).ok()
            })
            .flatten();
        (lookup, cache_path)
    };
    let (lookup, cache_path) = lookup_and_cache;
    // 优先读缓存文件里的内嵌/伴生歌词。
    if let Some(cache_path) = cache_path.filter(|path| Path::new(path).is_file()) {
        let lyrics = raw_lyrics_local(&cache_path);
        if !lyrics.trim().is_empty() {
            return lyrics;
        }
    }

    let Some((source, remote_path, _etag, _stored_remote_uri)) = lookup else {
        return String::new();
    };
    let Some(lrc_path) = remote_sidecar_candidate(&remote_path) else {
        return String::new();
    };

    webdav::read_text_file(&source, &lrc_path)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

async fn raw_lyrics_any(path: &str, db_state: &DbState) -> String {
    if is_remote_uri(path) {
        raw_lyrics_remote(path, db_state).await
    } else {
        raw_lyrics_local(path)
    }
}

// ---- 命令 ----

#[tauri::command]
pub fn read_lyrics_file(path: String) -> Result<String, String> {
    let path_obj = crate::security::path_validator::validate_path(&path, None)?;
    let is_lrc = path_obj
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("lrc"));
    if !is_lrc {
        return Err("请选择 .lrc 歌词文件".to_string());
    }

    let metadata = fs::metadata(&path_obj).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("所选路径不是文件".to_string());
    }
    if metadata.len() > MAX_LYRICS_FILE_SIZE {
        return Err("LRC 文件不能超过 2 MB".to_string());
    }

    let bytes = fs::read(path_obj).map_err(|error| error.to_string())?;
    Ok(super::lyrics_codec::decode_lyrics_file_bytes(&bytes))
}

#[tauri::command]
pub async fn parse_lyrics_text(text: String) -> Result<StructuredLyricsPayload, String> {
    Ok(build_structured_lyrics_payload(text))
}

#[tauri::command]
pub async fn get_song_lyrics_payload(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<StructuredLyricsPayload, String> {
    if !is_remote_uri(&path) {
        crate::security::path_validator::validate_path(&path, None)?;
    }
    Ok(build_structured_lyrics_payload(
        raw_lyrics_any(&path, &db_state).await,
    ))
}

#[tauri::command]
pub async fn get_song_lyrics_for_edit(path: String) -> Result<SongLyricsForEdit, String> {
    if !is_remote_uri(&path) {
        crate::security::path_validator::validate_path(&path, None)?;
    }
    // 来源优先级：内嵌 → 伴生文件 → 空。
    if let Ok(tagged_file) = read_tagged_file_from_path(Path::new(&path)) {
        if let Some(lyrics) = extract_embedded_lyrics(&tagged_file) {
            return Ok(SongLyricsForEdit {
                lyrics,
                source: LyricsStorageSource::Embedded,
                source_path: None,
            });
        }
    }

    let path_obj = Path::new(&path);
    if let Some((content, lrc_path)) = locate_sidecar_lyrics_file(path_obj) {
        return Ok(SongLyricsForEdit {
            lyrics: content,
            source: LyricsStorageSource::Sidecar,
            source_path: Some(normalize_path(&lrc_path.to_string_lossy())),
        });
    }

    Ok(SongLyricsForEdit {
        lyrics: String::new(),
        source: LyricsStorageSource::Empty,
        source_path: None,
    })
}

#[tauri::command]
pub async fn save_song_lyrics(
    path: String,
    lyrics: String,
    source: LyricsStorageSource,
    source_path: Option<String>,
) -> Result<SongLyricsForEdit, String> {
    let path_obj = crate::security::path_validator::validate_path(&path, None)?;
    if !path_obj.exists() {
        return Err("Song file does not exist".to_string());
    }

    match source {
        LyricsStorageSource::Embedded => {
            let saved_path = embed_lyrics_into_file(&path_obj, lyrics.clone())?;
            Ok(SongLyricsForEdit {
                lyrics,
                source: LyricsStorageSource::Embedded,
                source_path: Some(saved_path),
            })
        }
        LyricsStorageSource::Sidecar | LyricsStorageSource::Empty => {
            let saved_path = store_sidecar_lyrics(&path_obj, source_path, lyrics.clone())?;
            Ok(SongLyricsForEdit {
                lyrics,
                source: LyricsStorageSource::Sidecar,
                source_path: Some(saved_path),
            })
        }
    }
}

#[cfg(test)]
mod lyrics_io_tests {
    use super::remote_sidecar_candidate;
    use crate::database::DbState;
    use crate::music::files::lyrics_codec::decode_lyrics_file_bytes;
    use rusqlite::{params, Connection};
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn remote_sidecar_path_uses_parent_dir_and_stem() {
        assert_eq!(
            remote_sidecar_candidate("/Artist/Album/Demo.flac").as_deref(),
            Some("/Artist/Album/Demo.lrc")
        );
    }

    #[tokio::test]
    async fn remote_lyrics_prefer_cached_sidecar_over_remote_lrc() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("xyq_remote_lyrics_{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let cached_audio = dir.join("Demo.flac");
        let cached_lrc = dir.join("Demo.lrc");
        fs::write(&cached_audio, b"not real audio").unwrap();
        fs::write(&cached_lrc, "[00:01.00]cached lyric").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE remote_sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                base_url TEXT NOT NULL,
                username TEXT,
                password TEXT,
                root_path TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                last_sync_at INTEGER,
                last_sync_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE remote_files (
                source_id TEXT NOT NULL,
                remote_path TEXT NOT NULL,
                remote_uri TEXT NOT NULL,
                etag TEXT
            );
            CREATE TABLE songs (
                path TEXT PRIMARY KEY,
                cache_path TEXT
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO remote_sources (
                id, name, provider, base_url, root_path, enabled, created_at, updated_at
             ) VALUES ('source', 'Source', 'webdav', 'https://dav.invalid', '/', 1, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO remote_files (source_id, remote_path, remote_uri)
             VALUES ('source', '/Artist/Album/Demo.flac', 'remote://source/Artist/Album/Demo.flac')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO songs (path, cache_path) VALUES (?1, ?2)",
            params![
                "remote://source/Artist/Album/Demo.flac",
                cached_audio.to_string_lossy()
            ],
        )
        .unwrap();
        let db_state = DbState {
            conn: Arc::new(Mutex::new(conn)),
        };

        let lyrics =
            super::raw_lyrics_remote("remote://source/Artist/Album/Demo.flac", &db_state).await;

        assert_eq!(lyrics, "[00:01.00]cached lyric");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn codec_entry_point_still_decodes_gbk() {
        let (gbk, _, _) = encoding_rs::GBK.encode("[00:01.00]中文歌词");
        assert_eq!(decode_lyrics_file_bytes(gbk.as_ref()), "[00:01.00]中文歌词");
    }
}
