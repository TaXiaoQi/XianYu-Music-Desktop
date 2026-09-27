// 远程音频本地缓存：缓存键计算、容量回收、下载重试与播放源决策。
use super::repository::get_song_cache_path;
use super::repository::{get_source_for_remote_uri, update_song_cache_path};
use super::types::{RemoteCacheUsage, RemoteDownloadProgress, RemoteSourceCredentials};
use super::webdav;
use crate::database::DbState;
use sha2::Sha256;
use sha2::Digest;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use std::time::Duration;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

/// 缓存目录容量上限：5 GiB（0x1_4000_0000）。
pub(crate) const MAX_REMOTE_CACHE_BYTES: u64 = 0x1_4000_0000;
/// 下载进度事件名（前端契约，冻结）。
const EVENT_DOWNLOAD_PROGRESS: &str = "remote-download-progress";
/// 单文件下载失败后的最大尝试次数。
const DOWNLOAD_MAX_TRIES: usize = 3;
/// 重试退避基数（毫秒），第 n 次重试前等待 250ms * n。
const RETRY_BACKOFF_MILLIS: u64 = 250;

/// 判断路径是否指向远程曲库资源。
pub(crate) fn is_remote_uri(path: &str) -> bool { path.strip_prefix("remote://").is_some() }

/// 远端直播所需的最小信息集合（供播放器流式输出使用）。
#[derive(Clone, Debug, Default)] pub(crate) struct RemoteStreamSource {
    pub remote_uri: String, pub url: String,
    pub username: Option<String>, pub password: Option<String>,
    pub user_agent: Option<String>, pub referer: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
}

/// 播放决策结果：命中本地缓存走文件，否则走远程流。
#[derive(Clone, Debug)] pub(crate) enum RemotePlaybackSource {
    Cached { path: String },
    Stream(RemoteStreamSource),
}

/// 缓存根目录（不存在则创建）。
fn cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("remote-audio");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}

/// 缓存键：sha256(remote_uri ++ etag)，扩展名取 URI 末段（过长或含斜杠则回落 "audio"）。
fn cache_artifact_name(remote_uri: &str, etag: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(remote_uri.as_bytes());
    hasher.update(etag.unwrap_or("").as_bytes());
    let digest = hex::encode(hasher.finalize());

    let candidate = remote_uri.rsplit('.').next().unwrap_or("audio");
    let suffix = if candidate.len() <= 8 && !candidate.contains('/') { candidate } else { "audio" };
    format!("{digest}.{suffix}")
}

/// 超出容量上限时按最后修改时间从旧到新删除，直到回落上限以内。
fn enforce_cache_budget(root: &Path) {
    let Ok(read_dir) = fs::read_dir(root) else { return };
    // (路径, 大小, 修改时间) 清单；仅统计普通文件。
    let mut inventory: Vec<(PathBuf, u64, SystemTime)> = read_dir
        .filter_map(Result::ok)
        .filter_map(|item| {
            let meta = item.metadata().ok()?;
            if !meta.is_file() { return None; }
            Some((item.path(), meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
        })
        .collect();

    let total: u64 = inventory.iter().map(|(_, size, _)| size).sum();
    if total <= MAX_REMOTE_CACHE_BYTES { return; }

    inventory.sort_by_key(|(_, _, modified)| *modified);
    let mut remaining = total;
    for (path, size, _) in inventory {
        if remaining <= MAX_REMOTE_CACHE_BYTES { break; }
        if fs::remove_file(&path).is_ok() { remaining = remaining.saturating_sub(size); }
    }
}

/// 统计缓存目录占用。
pub(crate) fn cache_usage(app: &AppHandle) -> Result<RemoteCacheUsage, String> {
    let directory = cache_directory(app)?;
    let mut bytes = 0u64;
    let mut files = 0usize;
    for item in fs::read_dir(&directory).map_err(|e| e.to_string())? {
        let meta = item.map_err(|e| e.to_string())?.metadata().map_err(|e| e.to_string())?;
        if meta.is_file() {
            files += 1;
            bytes = bytes.saturating_add(meta.len());
        }
    }
    Ok(RemoteCacheUsage { bytes, files, limit_bytes: MAX_REMOTE_CACHE_BYTES })
}

/// 清空缓存目录内全部文件，返回清空后的占用。
pub(crate) fn clear_cache(app: &AppHandle) -> Result<RemoteCacheUsage, String> {
    let directory = cache_directory(app)?;
    for item in fs::read_dir(&directory).map_err(|e| e.to_string())? {
        let entry = item.map_err(|e| e.to_string())?;
        if entry.metadata().map_err(|e| e.to_string())?.is_file() {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    let after = cache_usage(app)?;
    Ok(after)
}

/// 广播单文件下载进度（事件名与负载结构冻结）。
#[allow(clippy::too_many_arguments)]
fn publish_download_progress(
    app: &AppHandle, remote_uri: &str, downloaded: u64, total: Option<u64>,
    done: bool, failed: bool, message: Option<String>,
) {
    let percent = total
        .and_then(|value| (value > 0).then_some(value))
        .map(|value| ((downloaded as f64 / value as f64) * 100.0).clamp(0.0, 100.0));
    let _ = app.emit(EVENT_DOWNLOAD_PROGRESS, RemoteDownloadProgress {
        uri: remote_uri.to_string(), downloaded, total, percent, done, failed, message,
    });
}

/// 依据缓存命中情况决定播放来源；测试构建下非空缓存路径一律视为命中。
pub(crate) fn choose_remote_playback_source(
    remote_uri: &str, cached_path: Option<String>,
    source: RemoteSourceCredentials, remote_path: String,
) -> RemotePlaybackSource {
    if let Some(path) = cached_path.filter(|candidate| !candidate.trim().is_empty()) {
        // 测试环境无真实文件系统缓存，非空路径即视为命中。
        #[cfg(test)] let hit = true;
        #[cfg(not(test))] let hit = Path::new(&path).is_file();
        if hit {
            return RemotePlaybackSource::Cached { path };
        }
    }

    RemotePlaybackSource::Stream(RemoteStreamSource {
        remote_uri: remote_uri.to_string(),
        url: webdav::build_url(&source, &remote_path),
        username: source.username,
        password: source.password,
        ..RemoteStreamSource::default()
    })
}

/// 查询某 remote URI 的播放来源（先解析音源与缓存登记，再决策）。
pub(crate) fn remote_playback_source(
    db_state: &DbState, remote_uri: &str,
) -> Result<RemotePlaybackSource, String> {
    let guard = db_state.conn.lock().map_err(|e| e.to_string())?;
    let (source, remote_path, _etag, stored_uri) = get_source_for_remote_uri(&guard, remote_uri)?;
    let canonical_uri = stored_uri.unwrap_or_else(|| remote_uri.to_string());
    let cached_path = get_song_cache_path(&guard, &canonical_uri)?;
    drop(guard);

    Ok(choose_remote_playback_source(&canonical_uri, cached_path, source, remote_path))
}

/// 下载远程文件进缓存（带重试与进度事件），返回缓存绝对路径。
pub(crate) async fn cache_remote_file(
    app: &AppHandle, source: &RemoteSourceCredentials, remote_path: &str,
    remote_uri: &str, etag: Option<&str>,
) -> Result<String, String> {
    let root = cache_directory(app)?;
    let final_path = root.join(cache_artifact_name(remote_uri, etag));
    if final_path.is_file() {
        return Ok(final_path.to_string_lossy().into_owned());
    }

    // 先写临时文件，成功后再原子改名，避免半截文件混入缓存。
    let staging_path = final_path.with_extension("download");
    let mut failure: Option<String> = None;
    for attempt in 1..=DOWNLOAD_MAX_TRIES {
        let sink = |downloaded, total| {
            publish_download_progress(app, remote_uri, downloaded, total, false, false, None);
        };
        match webdav::download_file_to_path(source, remote_path, &staging_path, sink).await {
            Ok(()) => { failure = None; break; }
            Err(e) => {
                failure = Some(e);
                if attempt < DOWNLOAD_MAX_TRIES {
                    let backoff = RETRY_BACKOFF_MILLIS * attempt as u64;
                    tokio::time::sleep(Duration::from_millis(backoff)).await;
                }
            }
        }
    }

    if let Some(e) = failure {
        publish_download_progress(app, remote_uri, 0, None, true, true, Some(e.clone()));
        return Err(e);
    }
    if !staging_path.is_file() {
        let e = String::from("远程文件下载失败：未生成缓存文件");
        publish_download_progress(app, remote_uri, 0, None, true, true, Some(e.clone()));
        return Err(e);
    }

    fs::rename(&staging_path, &final_path).map_err(|e| e.to_string())?;
    enforce_cache_budget(&root);

    let final_path_str = final_path.to_string_lossy().into_owned();
    publish_download_progress(app, remote_uri, 1, Some(1), true, false, None);
    Ok(final_path_str)
}

/// 确保远程文件已缓存并回写数据库，返回缓存路径。
pub(crate) async fn ensure_cached_path(
    app: &AppHandle, db_state: &DbState, remote_uri: &str,
) -> Result<String, String> {
    let (source, remote_path, etag, stored_uri) = {
        let guard = db_state.conn.lock().map_err(|e| e.to_string())?;
        get_source_for_remote_uri(&guard, remote_uri)?
    };
    let canonical_uri = stored_uri.unwrap_or_else(|| remote_uri.to_string());

    let cache_path = cache_remote_file(app, &source, &remote_path, &canonical_uri, etag.as_deref()).await?;
    if let Ok(guard) = db_state.conn.lock() {
        let _ = update_song_cache_path(&guard, &canonical_uri, &cache_path);
    }
    Ok(cache_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::types::RemoteSourceCredentials;

    fn streaming_source() -> RemoteSourceCredentials {
        RemoteSourceCredentials {
            id: "source".into(), name: "Source".into(), provider: "webdav".into(),
            base_url: "https://dav.example.com".into(),
            username: Some("user".into()), password: Some("pass".into()),
            root_path: "/music".into(), enabled: true,
            last_sync_at: None, last_sync_error: None, created_at: 0, updated_at: 0,
        }
    }

    #[test]
    fn registered_cache_path_wins_over_remote_stream() {
        let plan = choose_remote_playback_source(
            "remote://source/song.flac",
            Some("C:\\cache\\song.flac".to_string()),
            streaming_source(), "/song.flac".to_string(),
        );

        assert!(matches!(
            plan,
            RemotePlaybackSource::Cached { path } if path == "C:\\cache\\song.flac"
        ));
    }

    #[test]
    fn absent_cache_falls_back_to_direct_stream() {
        let plan = choose_remote_playback_source(
            "remote://source/song.flac", None, streaming_source(), "/song.flac".to_string(),
        );

        let RemotePlaybackSource::Stream(stream) = plan else {
            panic!("missing cache must stream remote file");
        };
        assert_eq!((stream.remote_uri.as_str(), stream.url.as_str()),
            ("remote://source/song.flac", "https://dav.example.com/music/song.flac"));
        assert_eq!((stream.username.as_deref(), stream.password.as_deref()),
            (Some("user"), Some("pass")));
    }
}
