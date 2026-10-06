use super::downloads::read_authorized_download_dir;
use crate::music::tags::{
    write_metadata_to_file, EmbedMetadataRequest,
};
use crate::security::{path_validator, ssrf};
use serde::{Deserialize, Serialize};
use std::{fs};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct FetchedImage {
    pub data: Vec<u8>,
    pub mime: String,
}

#[tauri::command] // 实现
pub async fn fetch_image_bytes(url: String) -> Result<FetchedImage, String> {
    use std::time::Duration;

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("无效的图片链接".to_string());
    }

    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("图片链接校验失败: {e}"))?;

    let client = crate::netproxy::client_builder()
        .timeout(Duration::from_secs(30))
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建请求客户端失败: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求图片失败: {e}"))?;

    if !response.status().is_success() { // 实现
        return Err(format!("图片服务器返回错误状态: {}", response.status()));
    }

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string(); // 实现

    let data = response
        .bytes()
        .await
        .map_err(|e| format!("读取图片数据失败: {e}"))?
        .to_vec();

    if data.is_empty() {
        return Err("图片数据为空".to_string());
    }

    Ok(FetchedImage { data, mime })
}

#[derive(Debug, Deserialize)]
pub struct SaveDialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

pub fn pick_save_path(
    app_handle: &tauri::AppHandle,
    default_file_name: &str,
    filter: Option<&SaveDialogFilter>,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_name = path_validator::sanitize_filename_component(default_file_name)?;

    let mut dialog = app_handle.dialog().file();
    dialog = dialog.set_file_name(&file_name);
    if let Some(f) = filter {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }

    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    Ok(Some(
        picked
            .into_path()
            .map_err(|e| format!("解析所选路径失败: {e}"))?,
    ))
}

fn write_file_bytes(dest: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(dest, data).map_err(|e| format!("写入文件失败: {e}"))
}

// async：对话框阻塞调用需离开主线程（同 register_download_directory 注释）
#[tauri::command] // 实现
pub async fn save_text_via_dialog(
    app_handle: tauri::AppHandle, // 实现
    default_file_name: String,
    filter: Option<SaveDialogFilter>,
    content: String,
) -> Result<Option<String>, String> {
    let Some(dest) = pick_save_path(&app_handle, &default_file_name, filter.as_ref())? else {
        return Ok(None);
    };
    write_file_bytes(&dest, content.as_bytes())?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

// async：对话框阻塞调用需离开主线程（同 register_download_directory 注释）
#[tauri::command] // 实现
pub async fn save_bytes_via_dialog(
    app_handle: tauri::AppHandle, // 实现
    default_file_name: String,
    filter: Option<SaveDialogFilter>,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    if data.is_empty() {
        return Err("保存数据为空".to_string());
    }
    let Some(dest) = pick_save_path(&app_handle, &default_file_name, filter.as_ref())? else {
        return Ok(None);
    };
    write_file_bytes(&dest, &data)?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

#[derive(Debug, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeDownloadExtrasRequest {
    pub lyrics_text: Option<String>,
    pub lyrics_path: Option<String>,
    pub cover_url: Option<String>,
    pub cover_path: Option<String>,
    pub metadata: Option<EmbedMetadataRequest>,
    pub embed_cover: bool,
}

#[derive(Debug, Serialize, Default)]
pub struct FinalizeDownloadExtrasResult {
    pub lyrics_saved: bool,
    pub cover_saved: bool,
    pub metadata_embedded: bool,
    pub metadata_error: Option<String>,
    pub cover_data: Option<Vec<u8>>,
    pub cover_mime: String,
}

#[tauri::command] // 实现
pub async fn finalize_download_extras(
    app_handle: tauri::AppHandle, // 实现
    request: FinalizeDownloadExtrasRequest,
) -> Result<FinalizeDownloadExtrasResult, String> {
    let mut result = FinalizeDownloadExtrasResult::default();

    let download_dir = if request.lyrics_path.is_some() || request.cover_path.is_some() {
        Some(read_authorized_download_dir(&app_handle)?)
    } else {
        None
    };

    if let (Some(text), Some(name)) = (&request.lyrics_text, &request.lyrics_path) {
        if !text.is_empty() {
            let dir = download_dir.clone().ok_or("下载目录未授权")?;
            let name = path_validator::sanitize_filename_component(name)?;
            let dest = dir.join(name);
            match tokio::fs::write(&dest, text).await {
                Ok(_) => result.lyrics_saved = true,
                Err(_) => {}
            }
        }
    }

    if let Some(url) = &request.cover_url {
        if !url.is_empty() && (url.starts_with("http://") || url.starts_with("https://")) {
            match fetch_image_bytes(url.clone()).await {
                Ok(img) => {
                    if let Some(name) = &request.cover_path {
                        let dir = download_dir.clone().ok_or("下载目录未授权")?;
                        let name = path_validator::sanitize_filename_component(name)?;
                        let actual_ext = if img.mime.contains("png") {
                            ".png"
                        } else {
                            ".jpg"
                        };
                        let name_str = name;
                        let final_name = if name_str.ends_with(".jpg") && actual_ext == ".png" {
                            format!("{}.png", &name_str[..name_str.len() - 4])
                        } else if name_str.ends_with(".png") && actual_ext == ".jpg" {
                            format!("{}.jpg", &name_str[..name_str.len() - 4])
                        } else {
                            name_str
                        };
                        let dest = dir.join(final_name);
                        match tokio::fs::write(&dest, &img.data).await {
                            Ok(_) => {
                                result.cover_saved = true;
                            }
                            Err(_) => {}
                        }
                    }
                    result.cover_data = Some(img.data);
                    result.cover_mime = img.mime;
                }
                Err(_) => {}
            }
        }
    }

    if let Some(mut meta) = request.metadata {
        if request.embed_cover && meta.cover_data.is_none() {
            if let Some(data) = &result.cover_data {
                meta.cover_data = Some(data.clone());
                meta.cover_mime = Some(result.cover_mime.clone());
            }
        }
        let meta = meta.clone();
        match tokio::task::spawn_blocking(move || write_metadata_to_file(&meta)).await {
            Ok(Ok(())) => result.metadata_embedded = true,
            Ok(Err(e)) => {
                result.metadata_error = Some(e);
            }
            Err(e) => {
                let msg = format!("元数据嵌入任务失败: {e}");
                result.metadata_error = Some(msg);
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::FinalizeDownloadExtrasRequest;

    #[test]
    fn finalize_download_extras_request_accepts_frontend_camel_case_payload() {
        let json = serde_json::json!({
            "lyricsText": "[00:00.00]测试歌词",
            "lyricsPath": "D:\\Music\\song.lrc",
            "coverUrl": "https://example.com/cover.jpg",
            "coverPath": "D:\\Music\\song.jpg",
            "embedCover": true,
            "metadata": {
                "filePath": "D:\\Music\\song.mp3",
                "title": "测试歌曲",
                "albumArtist": "测试专辑艺术家",
                "trackNumber": "7",
                "coverMime": "image/jpeg"
            }
        });

        let request: FinalizeDownloadExtrasRequest =
            serde_json::from_value(json).expect("frontend payload should deserialize");

        assert_eq!(request.lyrics_text.as_deref(), Some("[00:00.00]测试歌词"));
        assert_eq!(request.lyrics_path.as_deref(), Some("D:\\Music\\song.lrc"));
        assert_eq!(
            request.cover_url.as_deref(),
            Some("https://example.com/cover.jpg")
        );
        assert_eq!(request.cover_path.as_deref(), Some("D:\\Music\\song.jpg"));
        assert!(request.embed_cover);

        let metadata = request.metadata.expect("metadata should deserialize");
        assert_eq!(metadata.file_path, "D:\\Music\\song.mp3");
        assert_eq!(metadata.title.as_deref(), Some("测试歌曲"));
        assert_eq!(metadata.album_artist.as_deref(), Some("测试专辑艺术家"));
        assert_eq!(metadata.track_number.as_deref(), Some("7"));
        assert_eq!(metadata.cover_mime.as_deref(), Some("image/jpeg"));
    }
}
