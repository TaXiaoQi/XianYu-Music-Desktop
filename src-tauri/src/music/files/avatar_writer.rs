// 歌手头像：图片校验入缓存目录，并可选地把头像批量写入该歌手单曲的标签（带进度事件）。

use super::super::covers::get_cover_cache_dir;
use super::super::types::{SaveArtistAvatarResponse, WriteTagsProgressPayload};
use super::super::utils::normalize_path;
use crate::database::DbState;
use crate::remote::cache::is_remote_uri;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::Tag;
use rusqlite::params;
use std::fs;
use std::path::Path;
use tauri::{Emitter, State};
use uuid::Uuid;

struct SongTagWriteInfo {
    path: String,
    source_type: Option<String>,
    remote_source_id: Option<String>,
    cue_source_path: Option<String>,
    artist_count: i64,
}

#[tauri::command]
pub async fn save_artist_avatar(
    app: tauri::AppHandle,
    db_state: State<'_, DbState>,
    artist_id: i64,
    image_path: String,
    write_to_tags: bool,
) -> Result<SaveArtistAvatarResponse, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Seek};

    let path = crate::security::path_validator::validate_path(&image_path, None)?;
    if !path.exists() {
        return Err("Image file does not exist".to_string());
    }

    let mut file =
        fs::File::open(&path).map_err(|e| format!("Failed to open image file: {}", e))?;
    let mut header = [0u8; 12];
    let bytes_read = file
        .read(&mut header)
        .map_err(|e| format!("Failed to read image header: {}", e))?;

    if bytes_read < 3 {
        return Err("Invalid image file: too short".to_string());
    }

    let ext = if header[..3] == [0xFF, 0xD8, 0xFF] {
        "jpg"
    } else if bytes_read >= 8 && header[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        "png"
    } else if bytes_read >= 12 && &header[0..4] == b"RIFF" && &header[8..12] == b"WEBP" {
        "webp"
    } else {
        return Err("Unsupported image format. Only JPEG, PNG, and WEBP are allowed.".to_string());
    };

    file.seek(std::io::SeekFrom::Start(0))
        .map_err(|e| format!("Failed to seek image file: {}", e))?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read image file for hashing: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash_result = hasher.finalize();
    let sha256_hex = format!("{:x}", hash_result);

    let covers_dir = get_cover_cache_dir(&app);
    let target_filename = format!("artist-avatar-{}-{}.{}", artist_id, sha256_hex, ext);
    let target_path = covers_dir.join(target_filename);

    fs::copy(&path, &target_path)
        .map_err(|e| format!("Failed to copy image to covers directory: {}", e))?;

    let target_path_str = normalize_path(&target_path.to_string_lossy());

    let (songs_info, task_id) = if write_to_tags {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE artists SET avatar_path = ?1 WHERE id = ?2",
            params![Some(&target_path_str), artist_id],
        )
        .map_err(|e| format!("Failed to update database: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT s.path, s.source_type, s.remote_source_id, s.cue_source_path, \
             (SELECT COUNT(*) FROM song_artists sa2 WHERE sa2.song_id = s.id) AS artist_count \
             FROM songs s \
             INNER JOIN song_artists sa ON s.id = sa.song_id \
             WHERE sa.artist_id = ?1",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![artist_id], |row| {
                Ok(SongTagWriteInfo {
                    path: row.get(0)?,
                    source_type: row.get(1)?,
                    remote_source_id: row.get(2)?,
                    cue_source_path: row.get(3)?,
                    artist_count: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut items = Vec::new();
        for r in rows {
            if let Ok(item) = r {
                items.push(item);
            }
        }

        let tid = Uuid::new_v4().to_string();
        (items, Some(tid))
    } else {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE artists SET avatar_path = ?1 WHERE id = ?2",
            params![Some(&target_path_str), artist_id],
        )
        .map_err(|e| format!("Failed to update database: {}", e))?;

        (Vec::new(), None)
    };

    if let Some(ref task_id_str) = task_id {
        let app_clone = app.clone();
        let avatar_path_clone = target_path_str.clone();
        let task_id_clone = task_id_str.clone();
        let ext_clone = ext.to_string();

        tokio::task::spawn_blocking(move || {
            let total = songs_info.len();
            let mut success_count = 0;
            let mut failure_count = 0;
            let mut skipped_count = 0;
            let mut skipped_multi_artist = 0;
            let mut skipped_remote = 0;
            let mut skipped_cue = 0;
            let mut skipped_readonly = 0;
            let mut skipped_missing = 0;

            let _ = app_clone.emit(
                "artist-avatar:write-tags-progress",
                WriteTagsProgressPayload {
                    task_id: task_id_clone.clone(),
                    artist_id,
                    current: 0,
                    total,
                    success_count: 0,
                    failure_count: 0,
                    skipped_count: 0,
                    skipped_multi_artist: 0,
                    skipped_remote: 0,
                    skipped_cue: 0,
                    skipped_readonly: 0,
                    skipped_missing: 0,
                    done: false,
                    error: None,
                },
            );

            if total > 0 {
                match fs::read(&avatar_path_clone) {
                    Ok(image_bytes) => {
                        let mime = match ext_clone.as_str() {
                            "jpg" | "jpeg" => MimeType::Jpeg,
                            "png" => MimeType::Png,
                            "webp" => MimeType::Unknown("image/webp".to_string()),
                            _ => MimeType::Unknown("application/octet-stream".to_string()),
                        };

                        for (idx, item) in songs_info.iter().enumerate() {
                            let path_obj = Path::new(&item.path);

                            let is_remote = {
                                let is_remote_source = match &item.source_type {
                                    Some(s) => !s.is_empty() && s != "local",
                                    None => false,
                                };
                                let is_remote_id = match &item.remote_source_id {
                                    Some(s) => !s.is_empty(),
                                    None => false,
                                };
                                is_remote_source || is_remote_id || is_remote_uri(&item.path)
                            };

                            let is_cue = match &item.cue_source_path {
                                Some(s) => !s.is_empty(),
                                None => false,
                            };

                            if is_remote {
                                skipped_remote += 1;
                                skipped_count += 1;
                            } else if is_cue {
                                skipped_cue += 1;
                                skipped_count += 1;
                            } else if item.artist_count > 1 {
                                skipped_multi_artist += 1;
                                skipped_count += 1;
                            } else if !path_obj.is_file() {
                                skipped_missing += 1;
                                skipped_count += 1;
                            } else {
                                let is_readonly = match fs::metadata(path_obj) {
                                    Ok(meta) => meta.permissions().readonly(),
                                    Err(_) => false,
                                };

                                if is_readonly {
                                    skipped_readonly += 1;
                                    skipped_count += 1;
                                } else {
                                    match super::super::tags::read_tagged_file_from_path(path_obj)
                                    {
                                        Ok(mut tagged_file) => {
                                            let tag_type = tagged_file.primary_tag_type();
                                            if tagged_file.tag_mut(tag_type).is_none() {
                                                tagged_file.insert_tag(Tag::new(tag_type));
                                            }
                                            if let Some(tag) = tagged_file.tag_mut(tag_type) {
                                                let picture = Picture::new_unchecked(
                                                    PictureType::Artist,
                                                    Some(mime.clone()),
                                                    None,
                                                    image_bytes.clone(),
                                                );
                                                tag.remove_picture_type(PictureType::Artist);
                                                tag.push_picture(picture);

                                                match tagged_file
                                                    .save_to_path(path_obj, WriteOptions::default())
                                                {
                                                    Ok(_) => {
                                                        success_count += 1;
                                                    }
                                                    Err(_) => {
                                                        failure_count += 1;
                                                    }
                                                }
                                            } else {
                                                failure_count += 1;
                                            }
                                        }
                                        Err(_) => {
                                            failure_count += 1;
                                        }
                                    }
                                }
                            }

                            let _ = app_clone.emit(
                                "artist-avatar:write-tags-progress",
                                WriteTagsProgressPayload {
                                    task_id: task_id_clone.clone(),
                                    artist_id,
                                    current: idx + 1,
                                    total,
                                    success_count,
                                    failure_count,
                                    skipped_count,
                                    skipped_multi_artist,
                                    skipped_remote,
                                    skipped_cue,
                                    skipped_readonly,
                                    skipped_missing,
                                    done: false,
                                    error: None,
                                },
                            );
                        }
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to read avatar cache: {}", e);
                        let _ = app_clone.emit(
                            "artist-avatar:write-tags-progress",
                            WriteTagsProgressPayload {
                                task_id: task_id_clone.clone(),
                                artist_id,
                                current: 0,
                                total,
                                success_count: 0,
                                failure_count: total,
                                skipped_count: 0,
                                skipped_multi_artist: 0,
                                skipped_remote: 0,
                                skipped_cue: 0,
                                skipped_readonly: 0,
                                skipped_missing: 0,
                                done: true,
                                error: Some(error_msg),
                            },
                        );
                        return;
                    }
                }
            }

            let _ = app_clone.emit(
                "artist-avatar:write-tags-progress",
                WriteTagsProgressPayload {
                    task_id: task_id_clone,
                    artist_id,
                    current: total,
                    total,
                    success_count,
                    failure_count,
                    skipped_count,
                    skipped_multi_artist,
                    skipped_remote,
                    skipped_cue,
                    skipped_readonly,
                    skipped_missing,
                    done: true,
                    error: None,
                },
            );
        });
    }

    Ok(SaveArtistAvatarResponse {
        artist_id,
        avatar_path: target_path_str,
        task_id,
    })
}
