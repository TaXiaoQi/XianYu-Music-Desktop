// 歌曲信息编辑：把编辑结果写回音频标签，并重建 / 查询歌曲详情。

use super::super::scanner::{apply_scan_changes, parse_song_from_file};
use super::super::tags::{extract_detail_metadata, read_tagged_file_from_path};
use super::super::types::{SaveSongInfoResponse, SongDetail, SongInfoEditPayload};
use super::super::utils::normalize_path;
use crate::database::DbState;
use crate::remote::cache::is_remote_uri;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{ItemKey, Tag};
use rusqlite::{params, OptionalExtension};
use std::fs;
use std::path::Path;
use tauri::State;

/// 去除首尾空白后仍非空才视为有效输入。
fn trimmed_non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

// 有效值写入文本键；空值则把该键从标签中整体移除。
fn set_or_clear_text(tag: &mut Tag, key: ItemKey, value: Option<String>) {
    if let Some(text) = trimmed_non_empty(value) {
        let _ = tag.insert_text(key, text);
    } else {
        tag.remove_key(&key);
    }
}

// 按扩展名推断封面图的 MimeType。
fn image_mime_for_extension(path: &Path) -> MimeType {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => MimeType::Jpeg,
        Some("png") => MimeType::Png,
        Some("gif") => MimeType::Gif,
        Some("bmp") => MimeType::Bmp,
        Some("tif") | Some("tiff") => MimeType::Tiff,
        Some("webp") => MimeType::Unknown("image/webp".to_string()),
        _ => MimeType::Unknown("application/octet-stream".to_string()),
    }
}

// 把编辑载荷写回文件标签：标题必填，艺术家/专辑/碟号等空值即清除，封面可选覆盖。
fn apply_info_edit_to_tags(path_obj: &Path, payload: &SongInfoEditPayload) -> Result<(), String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("歌名不能为空".to_string());
    }

    let mut tagged_file = read_tagged_file_from_path(path_obj).map_err(|e| e.to_string())?;
    let tag_type = tagged_file.primary_tag_type();

    if tagged_file.tag_mut(tag_type).is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }

    let tag = tagged_file
        .tag_mut(tag_type)
        .ok_or_else(|| "当前歌曲格式不支持写入标签".to_string())?;

    let _ = tag.insert_text(ItemKey::TrackTitle, title.to_string());
    set_or_clear_text(tag, ItemKey::TrackArtist, Some(payload.artist.clone()));
    set_or_clear_text(tag, ItemKey::AlbumTitle, Some(payload.album.clone()));
    set_or_clear_text(tag, ItemKey::AlbumArtist, Some(payload.artist.clone()));
    set_or_clear_text(tag, ItemKey::TrackNumber, payload.track_number.clone());
    set_or_clear_text(tag, ItemKey::DiscNumber, payload.disc_number.clone());
    set_or_clear_text(tag, ItemKey::RecordingDate, payload.year.clone());
    if trimmed_non_empty(payload.year.clone()).is_none() {
        tag.remove_key(&ItemKey::Year);
    }

    if let Some(cover_path) = trimmed_non_empty(payload.cover_path.clone()) {
        let cover_path_obj = Path::new(&cover_path);
        if !cover_path_obj.is_file() {
            return Err("选择的封面图片不存在".to_string());
        }

        let image_bytes = fs::read(cover_path_obj).map_err(|e| e.to_string())?;
        let picture = Picture::new_unchecked(
            PictureType::CoverFront,
            Some(image_mime_for_extension(cover_path_obj)),
            None,
            image_bytes,
        );
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(picture);
    }

    tagged_file
        .save_to_path(path_obj, WriteOptions::default())
        .map_err(|e| e.to_string())
}

// 从本地文件直接构造详情（文件体积 + 标签扩展字段 + 容器后缀兜底）。
fn detail_from_local_file(path_obj: &Path, normalized_path: &str) -> SongDetail {
    let mut detail = SongDetail {
        path: normalized_path.to_string(),
        ..SongDetail::default()
    };

    if let Ok(metadata) = fs::metadata(path_obj) {
        detail.file_size = Some(metadata.len());
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path_obj) {
        let tag_detail = extract_detail_metadata(&tagged_file);
        detail.genre = tag_detail.genre;
        detail.year = tag_detail.year;
        detail.track_number = tag_detail.track_number;
        detail.disc_number = tag_detail.disc_number;
        detail.comment = tag_detail.comment;
    }

    detail.container = path_obj
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    detail
}

fn query_song_id(conn: &rusqlite::Connection, path: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM songs WHERE path = ?1 LIMIT 1",
        params![path],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_song_info(
    _app: tauri::AppHandle,
    path: String,
    payload: SongInfoEditPayload,
    db_state: State<'_, DbState>,
) -> Result<SaveSongInfoResponse, String> {
    if is_remote_uri(&path) {
        return Err("远程歌曲暂不支持直接编辑文件标签".to_string());
    }

    let normalized_path = normalize_path(&path);
    let path_obj = crate::security::path_validator::validate_path(&path, None)?;
    if !path_obj.is_file() {
        return Err("歌曲文件不存在".to_string());
    }

    let existing_song_id = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        query_song_id(&conn, &normalized_path)?
    };

    apply_info_edit_to_tags(&path_obj, &payload)?;

    let extension = path_obj
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    let mut song = parse_song_from_file(&path_obj, &normalized_path, &extension)
        .ok_or_else(|| "保存后无法重新读取歌曲信息".to_string())?;
    song.id = existing_song_id;

    {
        let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        if existing_song_id.is_some() {
            apply_scan_changes(&mut conn, &[], std::slice::from_ref(&song), &[], None)?;
        } else {
            apply_scan_changes(&mut conn, std::slice::from_ref(&song), &[], &[], None)?;
            song.id = query_song_id(&conn, &normalized_path)?;
        }
    }

    let mut detail = detail_from_local_file(&path_obj, &normalized_path);
    detail.container = song.container.clone().or(detail.container);
    detail.codec = song.codec.clone();
    detail.file_size = Some(song.file_size);

    Ok(SaveSongInfoResponse { song, detail })
}

#[tauri::command]
pub async fn get_song_detail(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<SongDetail, String> {
    let normalized_path = normalize_path(&path);
    let path_obj = crate::security::path_validator::validate_path(&path, None)?;
    let mut detail = SongDetail {
        path: normalized_path.clone(),
        ..SongDetail::default()
    };

    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        if let Some((container, codec, file_size)) = conn
            .query_row(
                "SELECT container, codec, file_size FROM songs WHERE path = ?1 LIMIT 1",
                params![&normalized_path],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            detail.container = container.filter(|value| !value.trim().is_empty());
            detail.codec = codec.filter(|value| !value.trim().is_empty());
            detail.file_size = file_size.and_then(|value| u64::try_from(value).ok());
        }
    }

    if let Ok(metadata) = fs::metadata(&path_obj) {
        detail.file_size = Some(metadata.len());
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(&path_obj) {
        let tag_detail = extract_detail_metadata(&tagged_file);
        detail.genre = tag_detail.genre;
        detail.year = tag_detail.year;
        detail.track_number = tag_detail.track_number;
        detail.disc_number = tag_detail.disc_number;
        detail.comment = tag_detail.comment;

        if detail.container.is_none() {
            detail.container = path_obj
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_ascii_lowercase());
        }
    }

    Ok(detail)
}
