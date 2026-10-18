// 云端曲目内嵌元数据探针。
//
// 起播后前端调用 probe_cloud_track_meta：后台等待流缓存头部就绪（部分
// .dat 文件），用 lofty 提取内嵌封面/歌词/时长，经 cloud-track-meta-ready
// 事件回传前端回填（封面缩略图已落盘，直接给路径）。
//
// 部分文件解析约束：FLAC/ID3v2 元数据块都在文件头部，头 2MB 足够解出
// 标签与封面；FLAC 时长取 STREAMINFO（精确），MP3 时长按
// 总字节×8/码率估算（头部码率），总长未知则不回填时长。

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::ItemKey;
#[cfg(test)]
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

use super::stream_cache;
use crate::music::covers;
use crate::music::tags::read_tagged_file_from_path;

/// 头部等待上限：探针只读头部标签，拿不到就放弃（不打扰播放）。
const HEAD_WAIT_BYTES: u64 = 2 * 1024 * 1024;
/// 边下边试的首个解析门槛：FLAC/ID3 头部标签通常远小于此。
const HEAD_FIRST_TRY_BYTES: u64 = 128 * 1024;
const HEAD_WAIT_SECS: u64 = 90;
const POLL_INTERVAL_MS: u64 = 400;

/// 列表期头部探针的拉取字节数：ID3v2 大封面可把标签顶到 1MB+，2MB 稳妥。
const HEAD_RANGE_BYTES: u64 = 2 * 1024 * 1024;

/// cloud-track-meta-ready 事件负载（字段名冻结，前端按 camelCase 消费）。
/// 同时作为本地持久化索引的条目（cloud_meta_index.json，跨会话复用）。
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTrackMetaPayload {
    cloud_path: String,
    url: String,
    lyrics_raw: Option<String>,
    cover_path: Option<String>,
    duration_secs: Option<u32>,
}

// ---------------------------------------------------------------------------
// 本地元数据索引（跨会话）：解析成功的封面/歌词/时长按 cloud_path 落盘，
// 下次列表装配/播放直接命中，不再走直链探针（对齐 WebDAV 远端缓存体验）。
// ---------------------------------------------------------------------------

fn index_cache_slot() -> &'static Mutex<Option<HashMap<String, CloudTrackMetaPayload>>> {
    static CELL: OnceLock<Mutex<Option<HashMap<String, CloudTrackMetaPayload>>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

/// 索引文件路径：app_data/cloud_meta_index.json。
fn index_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("cloud_meta_index.json"))
}

/// 从磁盘读索引；封面文件已丢失的条目降级（封面置空，歌词/时长保留）。
fn load_index_from_disk(app: &tauri::AppHandle) -> HashMap<String, CloudTrackMetaPayload> {
    let Some(path) = index_path(app) else {
        return HashMap::new();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let map: HashMap<String, CloudTrackMetaPayload> = match serde_json::from_str(&text) {
        Ok(map) => map,
        Err(_) => return HashMap::new(),
    };
    map.into_iter()
        .filter_map(|(key, mut payload)| {
            if let Some(p) = &payload.cover_path {
                if !std::path::Path::new(p).exists() {
                    payload.cover_path = None;
                }
            }
            let has_any = payload.cover_path.is_some()
                || payload.lyrics_raw.is_some()
                || payload.duration_secs.is_some();
            has_any.then_some((key, payload))
        })
        .collect()
}

/// 读取索引（进程内 memo，首次落盘读，之后走内存）。
fn load_index(app: &tauri::AppHandle) -> HashMap<String, CloudTrackMetaPayload> {
    if let Ok(guard) = index_cache_slot().lock() {
        if let Some(map) = guard.as_ref() {
            return map.clone();
        }
    }
    let map = load_index_from_disk(app);
    if let Ok(mut guard) = index_cache_slot().lock() {
        *guard = Some(map.clone());
    }
    map
}

/// 解析成功后写索引（读-改-写 + 进程内 memo 同步更新；文件小，直接同步落盘）。
fn persist_entry(app: &tauri::AppHandle, payload: &CloudTrackMetaPayload) {
    let mut map = load_index(app);
    map.insert(payload.cloud_path.clone(), payload.clone());
    if let Ok(mut guard) = index_cache_slot().lock() {
        *guard = Some(map.clone());
    }
    let Some(path) = index_path(app) else { return };
    if let Ok(json) = serde_json::to_string(&map) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, json);
    }
}

/// 本地缓存命中即广播并返回 true（零网络）。
fn emit_cached(app: &tauri::AppHandle, cloud_path: &str) -> bool {
    let hit = load_index(app).get(cloud_path).cloned();
    match hit {
        Some(payload) => {
            eprintln!("[cloud-meta] 本地缓存命中: {cloud_path}");
            let _ = app.emit("cloud-track-meta-ready", payload);
            true
        }
        None => false,
    }
}

/// 启动期加载本地元数据索引：前端列表装配前预填，命中即零网络回填。
#[tauri::command]
pub fn load_cloud_meta_index(
    app: tauri::AppHandle,
) -> HashMap<String, CloudTrackMetaPayload> {
    load_index(&app)
}

/// 安排后台探针：等流缓存头部就绪 → 解析 → 广播。全程静默失败。
pub fn spawn_probe(
    app: tauri::AppHandle,
    url: String,
    cloud_path: String,
    duration_hint: u32,
) {
    tauri::async_runtime::spawn(async move {
        // 本地索引命中：直接广播，不碰网络
        if emit_cached(&app, &cloud_path) {
            return;
        }
        let started = std::time::Instant::now();
        // FLAC/ID3 标签集中在文件头（首块起就有），边下边试解析：
        // 首次尝试门槛 128KB，此后每轮轮询重试，成功即回填，不等下载满 2MB。
        loop {
            let Some(snap) = stream_cache::cache_entry_snapshot(&url) else {
                eprintln!("[cloud-meta] 无流缓存条目（URL 未起播或键不一致）: {url}");
                return;
            };
            if snap.failed {
                eprintln!("[cloud-meta] 流缓存下载失败，探针放弃: {url}");
                return;
            }
            let due = snap.downloaded_bytes >= HEAD_FIRST_TRY_BYTES
                || started.elapsed() > std::time::Duration::from_secs(2);
            if due {
                if let Some(payload) = extract_meta(
                    &app,
                    std::path::Path::new(&snap.path),
                    snap.total_bytes,
                    snap.complete,
                    &url,
                    &cloud_path,
                    duration_hint,
                ) {
                    eprintln!(
                        "[cloud-meta] 就绪（{} bytes 时解出）: cover={} lyrics={} dur={:?} ({cloud_path})",
                        snap.downloaded_bytes,
                        payload.cover_path.is_some(),
                        payload.lyrics_raw.is_some(),
                        payload.duration_secs
                    );
                    persist_entry(&app, &payload);
                    let _ = app.emit("cloud-track-meta-ready", payload);
                    return;
                }
            }
            if snap.complete || snap.downloaded_bytes >= HEAD_WAIT_BYTES {
                eprintln!("[cloud-meta] 头部标签解析无收获（complete={}，{} bytes）: {cloud_path}", snap.complete, snap.downloaded_bytes);
                return;
            }
            if started.elapsed() > std::time::Duration::from_secs(HEAD_WAIT_SECS) {
                eprintln!(
                    "[cloud-meta] 等待头部超时（{}s，已到 {} bytes）: {url}",
                    started.elapsed().as_secs(),
                    snap.downloaded_bytes
                );
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)).await;
        }
    });
}

/// 从部分缓存文件提取内嵌元数据；无任何收获时返回 None。
fn extract_meta(
    app: &tauri::AppHandle,
    partial_path: &std::path::Path,
    total_bytes: u64,
    is_complete: bool,
    url: &str,
    cloud_path: &str,
    duration_hint: u32,
) -> Option<CloudTrackMetaPayload> {
    let tagged = read_tagged_file_from_path(partial_path).ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;

    // 歌词：ID3v2 USLT / FLAC 通用 Lyrics 项
    let lyrics_raw = tag
        .get_string(&ItemKey::Lyrics)
        .map(str::to_owned)
        .filter(|s| !s.trim().is_empty());

    // 封面：内嵌图 → 缩略图实体落盘（按图内容指纹共享缓存）
    let cover_path = tag
        .pictures()
        .first()
        .and_then(|pic| covers::save_embedded_thumb_from_bytes(pic.data(), app));

    // 时长：FLAC 精确；MP3 按总长×8/码率估算；下载完成后直接信属性
    let props = tagged.properties();
    let duration_secs = {
        let from_props = props.duration().as_secs();
        let estimate_from_total = || {
            let bitrate = u64::from(props.audio_bitrate().unwrap_or(0));
            (total_bytes > 0 && bitrate > 0)
                .then(|| ((total_bytes * 8) / (bitrate * 1000)) as u32)
                .filter(|d| *d > 0)
        };
        if is_complete && from_props > 0 {
            Some(from_props as u32)
        } else if from_props > 0 && matches!(tagged.file_type(), lofty::file::FileType::Flac) {
            Some(from_props as u32) // STREAMINFO 与总长无关，部分文件也精确
        } else {
            estimate_from_total().or_else(|| {
                (duration_hint > 0).then_some(duration_hint) // 播放器实测值兜底
            })
        }
    };

    if lyrics_raw.is_none() && cover_path.is_none() && duration_secs.is_none() {
        return None;
    }

    Some(CloudTrackMetaPayload {
        cloud_path: cloud_path.to_string(),
        url: url.to_string(),
        lyrics_raw,
        cover_path,
        duration_secs,
    })
}

/// 前端探测诊断透传落盘（直链解析失败等未到网络层的失败原因）。
#[tauri::command]
pub fn log_cloud_meta_diag(app: tauri::AppHandle, line: String) {
    probe_log(&app, &line);
}

/// 探测诊断日志：dev 终端不可达时落盘排查（crash.log 同目录，超 1MB 重建）。
fn probe_log(app: &tauri::AppHandle, line: &str) {
    use std::io::Write;
    use tauri::Manager;
    eprintln!("{line}");
    let Ok(dir) = app.path().app_data_dir() else { return };
    let path = dir.join("cloud_meta_probe.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 1_000_000 {
            let _ = std::fs::remove_file(&path);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "[{ts}] {line}");
    }
}

/// 直链 host（日志脱敏：只记主机名，不落签名参数）。
fn url_host(url: &str) -> &str {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split(['/']).next())
        .unwrap_or("?")
}

/// 列表期头部元数据探针命令：Range 拉头 512KB 解析内嵌封面/歌词/时长，
/// 经 cloud-track-meta-ready 广播（与播放期探针同事件、同回填链路）。
/// 失败静默——列表期探测不打扰用户，播放期探针兜底。
#[tauri::command]
pub fn probe_cloud_head_meta(
    app: tauri::AppHandle,
    url: String,
    headers: Option<HashMap<String, String>>,
    cloud_path: String,
    duration_hint: Option<u32>,
) -> Result<(), String> {
    crate::security::ssrf::validate_url_ip_literal(&url)
        .map_err(|why| format!("播放链接校验失败: {why}"))?;
    tauri::async_runtime::spawn(async move {
        let host = url_host(&url).to_string();
        let hdr_note = match &headers {
            Some(h) => format!("hdrs={}", h.len()),
            None => "hdrs=0".to_string(),
        };
        if let Err(()) = probe_head_meta(
            &app,
            &url,
            headers.as_ref(),
            &cloud_path,
            duration_hint.unwrap_or(0),
        )
        .await
        {
            probe_log(&app, &format!("[cloud-head] 探测失败 host={host} {hdr_note}"));
        }
    });
    Ok(())
}

/// 头部 Range 拉取 + 解析 + 广播。任一步失败即放弃（Err(()) 静默）。
async fn probe_head_meta(
    app: &tauri::AppHandle,
    url: &str,
    headers: Option<&HashMap<String, String>>,
    cloud_path: &str,
    duration_hint: u32,
) -> Result<(), ()> {
    // 本地索引命中：直接广播，不碰网络
    if emit_cached(app, cloud_path) {
        probe_log(app, &format!("[cloud-head] 索引命中 host={} ({cloud_path})", url_host(url)));
        return Ok(());
    }
    let hdr_note = headers
        .map(|h| format!("hdrs={}", h.len()))
        .unwrap_or_else(|| "hdrs=0".to_string());
    probe_log(app, &format!("[cloud-head] 开始 host={} {hdr_note}", url_host(url)));
    let client = reqwest::Client::builder()
        .timeout(core::time::Duration::from_secs(20))
        .build()
        .map_err(|_| ())?;
    let mut req = client
        .get(url)
        .header("Range", format!("bytes=0-{}", HEAD_RANGE_BYTES - 1));
    if let Some(hs) = headers {
        for (k, v) in hs {
            req = req.header(k.as_str(), v.as_str());
        }
    } else {
        req = req.header("User-Agent", super::commands::DEFAULT_STREAM_USER_AGENT);
    }
    let mut resp = req.send().await.map_err(|e| {
        probe_log(app, &format!("[cloud-head] 直链请求失败 host={}: {e}", url_host(url)));
        ()
    })?;
    // content-range: "bytes 0-524287/92050432" → 总长（MP3 时长估算需要）
    let total_bytes = resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|t| t.parse::<u64>().ok())
        .unwrap_or(0);
    let status = resp.status();
    // 非 2xx 直接落盘响应体片段（CDN 拒绝原因就在 body 里，如 OSS
    // AccessDenied XML），避免无效解析与猜测。
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        probe_log(
            app,
            &format!(
                "[cloud-head] 直链被拒 status={status} host={} body={snippet}",
                url_host(url)
            ),
        );
        return Err(());
    }

    // 流式下载 + 渐进解析：FLAC/ID3 标签在文件头，每到检查点就试解析，
    // 解出即中断下载（慢速节点不必等满 2MB）。
    let mut acc: Vec<u8> = Vec::with_capacity(HEAD_RANGE_BYTES as usize);
    let mut next_try = HEAD_FIRST_TRY_BYTES;
    let mut emitted: Option<CloudTrackMetaPayload> = None;
    while emitted.is_none() {
        let Some(chunk) = resp.chunk().await.map_err(|e| {
            probe_log(app, &format!("[cloud-head] 直链读取失败 host={}: {e}", url_host(url)));
            ()
        })?
        else {
            break; // 流结束
        };
        acc.extend_from_slice(&chunk);
        if (acc.len() as u64) >= next_try {
            if let Some(payload) =
                extract_head_bytes(app, &acc, total_bytes, url, cloud_path, duration_hint)
            {
                emitted = Some(payload);
                break;
            }
            next_try = (next_try * 2).min(HEAD_RANGE_BYTES);
        }
        if acc.len() as u64 >= HEAD_RANGE_BYTES {
            break;
        }
    }
    if acc.is_empty() {
        probe_log(
            app,
            &format!("[cloud-head] 响应为空 status={status} host={}", url_host(url)),
        );
        return Err(());
    }
    let payload = emitted
        .take()
        .or_else(|| extract_head_bytes(app, &acc, total_bytes, url, cloud_path, duration_hint));
    match payload {
        Some(payload) => {
            probe_log(
                app,
                &format!(
                    "[cloud-head] 就绪（{} bytes, status={status}）: cover={} lyrics={} dur={:?} ({cloud_path})",
                    acc.len(),
                    payload.cover_path.is_some(),
                    payload.lyrics_raw.is_some(),
                    payload.duration_secs
                ),
            );
            persist_entry(app, &payload);
            let _ = app.emit("cloud-track-meta-ready", payload);
        }
        None => {
            probe_log(
                app,
                &format!(
                    "[cloud-head] 解析无收获（status={status}, bytes={}）: {cloud_path}",
                    acc.len()
                ),
            );
        }
    }
    Ok(())
}

/// 从缓冲的头部字节解析（临时文件供 lofty 按路径读，用完即删）。
fn extract_head_bytes(
    app: &tauri::AppHandle,
    bytes: &[u8],
    total_bytes: u64,
    url: &str,
    cloud_path: &str,
    duration_hint: u32,
) -> Option<CloudTrackMetaPayload> {
    let nonce = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        url.hash(&mut h);
        h.finish()
    };
    // lofty 的 Probe::guess_file_type 按扩展名识别容器，固定 ".bin" 会直接
    // 解析失败（表现为 2MB 拉满却「解析无收获」），后缀必须还原真实类型
    let ext = probe_file_ext(url, bytes);
    let tmp = std::env::temp_dir().join(format!("xym-cloud-head-{nonce:016x}{ext}"));
    std::fs::write(&tmp, bytes).ok()?;
    let payload = extract_meta(app, &tmp, total_bytes, false, url, cloud_path, duration_hint);
    let _ = std::fs::remove_file(&tmp);
    payload
}

/// 探针临时文件的扩展名：依次取 URL 路径扩展名 → 头部魔数嗅探，兜底 ".mp3"。
fn probe_file_ext(url: &str, bytes: &[u8]) -> String {
    if let Some(rest) = url.split("://").nth(1) {
        let path = rest.split('?').next().unwrap_or("");
        let last = path.rsplit('/').next().unwrap_or("");
        if let Some(dot) = last.rfind('.') {
            let ext = &last[dot + 1..];
            let ok = !ext.is_empty()
                && ext.len() <= 5
                && ext.chars().all(|c| c.is_ascii_alphanumeric());
            if ok {
                return format!(".{}", ext.to_ascii_lowercase());
            }
        }
    }
    if bytes.starts_with(b"fLaC") {
        return ".flac".into();
    }
    if bytes.starts_with(b"ID3") {
        return ".mp3".into();
    }
    if bytes.len() > 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0 {
        return ".mp3".into();
    }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return ".wav".into();
    }
    if bytes.starts_with(b"OggS") {
        return ".ogg".into();
    }
    if bytes.len() > 12 && &bytes[4..8] == b"ftyp" {
        return ".m4a".into();
    }
    if bytes.starts_with(b"MAC ") {
        return ".ape".into();
    }
    ".mp3".into()
}

/// 事件名与负载的构造单测锚点（防字段漂移）。
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_serializes_camel_case() {
        let payload = CloudTrackMetaPayload {
            cloud_path: "cloud://a/_/x".into(),
            url: "https://example.com/f.mp3".into(),
            lyrics_raw: Some("[00:00.00]hi".into()),
            cover_path: Some("C:/covers/x.jpg".into()),
            duration_secs: Some(238),
        };
        let j = json!(payload);
        assert!(j.get("cloudPath").is_some());
        assert!(j.get("lyricsRaw").is_some());
        assert!(j.get("coverPath").is_some());
        assert!(j.get("durationSecs").is_some());
    }
}
