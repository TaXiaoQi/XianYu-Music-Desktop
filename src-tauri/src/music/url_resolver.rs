use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

// ==================== Types ====================

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LxUrlSongInfo {
    pub songmid: String,
    pub source: String,
    pub hash: Option<String>,
    pub name: Option<String>,
    #[allow(dead_code)]
    pub singer: Option<String>,
    #[allow(dead_code)]
    pub album_name: Option<String>,
    pub album_id: Option<serde_json::Value>,
    pub album_mid: Option<String>,
    #[allow(dead_code)]
    pub copyright_id: Option<String>,
    #[allow(dead_code)]
    pub str_media_mid: Option<String>,
    #[allow(dead_code)]
    pub song_id: Option<serde_json::Value>,
    #[serde(rename = "_types", default)]
    pub types: Option<HashMap<String, LxTypeEntry>>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LxTypeEntry {
    pub size: Option<String>,
    pub hash: Option<String>,
}

// ==================== URL Cache ====================

struct CacheEntry {
    url: String,
    expires_at: Instant,
    last_access: Instant,
}

static URL_CACHE: OnceLock<Arc<RwLock<HashMap<String, CacheEntry>>>> = OnceLock::new();

fn url_cache() -> &'static Arc<RwLock<HashMap<String, CacheEntry>>> {
    URL_CACHE.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

const URL_CACHE_TTL_SECS: u64 = 600;
const URL_CACHE_MAX_ENTRIES: usize = 500;

fn evict_url_cache(cache: &mut HashMap<String, CacheEntry>, now: Instant) {
    cache.retain(|_, e| e.expires_at > now);
    let excess = cache.len().saturating_sub(URL_CACHE_MAX_ENTRIES);
    if excess == 0 {
        return;
    }
    let mut keys: Vec<(String, Instant)> = cache
        .iter()
        .map(|(k, e)| (k.clone(), e.last_access))
        .collect();
    keys.sort_unstable_by_key(|(_, t)| *t);
    for (k, _) in keys.into_iter().take(excess) {
        cache.remove(&k);
    }
}

// ==================== WY 专辑封面缓存与串行限流 ====================

const WY_ALBUM_COVER_PREFIX: &str = "wy_album_cover";
const WY_ALBUM_FETCH_INTERVAL: Duration = Duration::from_millis(250);
static WY_ALBUM_FETCH_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

async fn get_cached_wy_album_cover(album_id: &str) -> Option<String> {
    let key = format!("{}/{}/{}", WY_ALBUM_COVER_PREFIX, "wy", album_id);
    let mut cache = url_cache().write().await;
    let now = Instant::now();
    let entry = cache.get_mut(&key)?;
    if entry.expires_at <= now {
        cache.remove(&key);
        return None;
    }
    entry.last_access = now;
    Some(entry.url.clone())
}

async fn set_cached_wy_album_cover(album_id: &str, cover: String) {
    let key = format!("{}/{}/{}", WY_ALBUM_COVER_PREFIX, "wy", album_id);
    let mut cache = url_cache().write().await;
    let now = Instant::now();
    cache.insert(
        key,
        CacheEntry {
            url: cover,
            expires_at: now + Duration::from_secs(URL_CACHE_TTL_SECS),
            last_access: now,
        },
    );
    evict_url_cache(&mut cache, now);
}

// ==================== HTTP ====================

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        crate::netproxy::client_builder()
            .redirect(crate::security::ssrf::ssrf_redirect_policy())
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build()
            .expect("failed to build url_resolver reqwest client")
    })
}

// ==================== Cover URL Resolution ====================

async fn http_get_text(url: &str, headers: &[(&str, &str)]) -> Result<(u16, String), String> {
    let client = http_client();

    let mut req = client.get(url).timeout(Duration::from_secs(10));
    for (key, value) in headers {
        req = req.header(*key, *value);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok((status, body))
}

async fn http_post_json(
    url: &str,
    body: &str,
    headers: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let client = http_client();

    let mut req = client
        .post(url)
        .timeout(Duration::from_secs(10))
        .body(body.to_string());
    for (key, value) in headers {
        req = req.header(*key, *value);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body_text = resp.text().await.map_err(|e| e.to_string())?;

    if status != 200 {
        return Err(format!("HTTP {} for {}", status, url));
    }

    serde_json::from_str(&body_text).map_err(|e| format!("Invalid JSON: {}", e))
}

fn normalize_kuwo_cover_url(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() || !url.starts_with("http") {
        return None;
    }
    let url = url.replace("http://", "https://");
    let url = url
        .replace("https://img1.kwcdn", "https://img3.kuwo")
        .replace("https://img.kuwo", "https://img3.kuwo");
    Some(url)
}

pub async fn get_lx_cover_url(song_info: &LxUrlSongInfo) -> Option<String> {
    let source = song_info.source.as_str();

    match source {
        "kw" => {
            let url = format!(
                "http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid={}",
                song_info.songmid
            );
            match http_get_text(&url, &[]).await {
                Ok((status, body)) if status == 200 => {
                    let trimmed = body.trim();
                    if trimmed.starts_with("http") {
                        return normalize_kuwo_cover_url(trimmed);
                    }
                }
                _ => {}
            }
            None
        }

        "kg" => {
            let hash = song_info
                .types
                .as_ref()
                .and_then(|t| t.get("128k"))
                .and_then(|e| e.hash.as_deref())
                .or(song_info.hash.as_deref())
                .unwrap_or("");

            let album_id_owned: String = song_info
                .album_id
                .as_ref()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .or_else(|| {
                    song_info
                        .album_id
                        .as_ref()
                        .and_then(|v| v.as_i64().map(|n| n.to_string()))
                })
                .unwrap_or_else(|| "0".to_string());
            let album_id = album_id_owned.as_str();

            let body = serde_json::json!({
                "appid": 1001,
                "area_code": "1",
                "behavior": "play",
                "clientver": "9020",
                "need_hash_offset": 1,
                "relate": 1,
                "resource": [{
                    "album_audio_id": 0,
                    "album_id": album_id,
                    "hash": hash,
                    "id": 0,
                    "name": song_info.name.as_deref().unwrap_or(""),
                    "type": "audio"
                }],
                "token": "",
                "userid": 2626431536u32,
                "vip": 1
            });
            let body_str = serde_json::to_string(&body).unwrap_or_default();

            match http_post_json(
                "http://media.store.kugou.com/v1/get_res_privilege",
                &body_str,
                &[
                    ("KG-RC", "1"),
                    ("KG-THash", "expand_search_manager.cpp:852736169:451"),
                    ("User-Agent", "KuGou2012-9020-ExpandSearchManager"),
                    ("Content-Type", "application/json"),
                ],
            )
            .await
            {
                Ok(resp) => {
                    if resp.get("error_code").and_then(|c| c.as_i64()) == Some(0) {
                        if let Some(info) = resp.pointer("/data/0/info") {
                            if let Some(imgsize) = info.get("imgsize").and_then(|v| v.as_array()) {
                                if let (Some(image), Some(first_size)) = (
                                    info.get("image").and_then(|v| v.as_str()),
                                    imgsize.first().and_then(|s| s.as_u64()),
                                ) {
                                    return Some(image.replace("{size}", &first_size.to_string()));
                                }
                            }
                            if let Some(image) = info.get("image").and_then(|v| v.as_str()) {
                                if !image.is_empty() {
                                    return Some(image.to_string());
                                }
                            }
                        }
                    }
                }
                Err(_) => {}
            }
            None
        }

        "tx" => {
            let album_id = song_info
                .album_mid
                .as_deref()
                .or(song_info.album_id.as_ref().and_then(|v| v.as_str()))
                .unwrap_or("");
            if !album_id.is_empty() {
                return Some(format!(
                    "https://y.gtimg.cn/music/photo_new/T002R500x500M000{}.jpg",
                    album_id
                ));
            }
            None
        }

        "wy" => {
            let album_id: String = song_info
                .album_id
                .as_ref()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .or_else(|| {
                    song_info
                        .album_id
                        .as_ref()
                        .and_then(|v| v.as_i64().map(|n| n.to_string()))
                })
                .unwrap_or_default();

            let headers: &[(&str, &str)] = &[
                ("Referer", "https://music.163.com"),
                ("Cookie", "MUSIC_A=1"),
            ];

            if !album_id.is_empty() {
                if let Some(cached) = get_cached_wy_album_cover(&album_id).await {
                    if !cached.is_empty() {
                        return Some(cached);
                    }
                }
                let _guard = WY_ALBUM_FETCH_LOCK
                    .get_or_init(|| tokio::sync::Mutex::new(()))
                    .lock()
                    .await;
                if let Some(cached) = get_cached_wy_album_cover(&album_id).await {
                    if !cached.is_empty() {
                        return Some(cached);
                    }
                }
                tokio::time::sleep(WY_ALBUM_FETCH_INTERVAL).await;
                let album_url = format!("https://music.163.com/api/album/{}?ext=true", album_id);
                if let Ok((status, body)) = http_get_text(&album_url, headers).await {
                    if status == 200 {
                        if let Ok(body_json) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(pic_url) =
                                body_json.pointer("/album/picUrl").and_then(|v| v.as_str())
                            {
                                if !pic_url.is_empty() {
                                    set_cached_wy_album_cover(&album_id, pic_url.to_string()).await;
                                    return Some(pic_url.to_string());
                                }
                            }
                        }
                    }
                }
            }

            let url = format!(
                "https://music.163.com/api/song/detail/?id={}&ids=%5B{}%5D",
                song_info.songmid, song_info.songmid
            );
            match http_get_text(&url, headers).await {
                Ok((status, body)) if status == 200 => {
                    if let Ok(body_json) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(pic_url) = body_json
                            .pointer("/songs/0/album/picUrl")
                            .and_then(|v| v.as_str())
                        {
                            if !pic_url.is_empty() {
                                return Some(pic_url.to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
            None
        }

        _ => None,
    }
}

// ==================== Tauri Commands ====================

#[tauri::command]
pub async fn get_lx_cover(song_info: LxUrlSongInfo) -> Result<Option<String>, String> {
    Ok(get_lx_cover_url(&song_info).await)
}

// ==================== Source Fallback ====================

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlternativeSourceResult {
    pub source: String,
    pub songmid: String,
    pub name: String,
    pub singer: String,
    pub album_name: String,
    pub album_id: serde_json::Value,
    pub album_mid: Option<String>,
    pub img: Option<String>,
    pub interval: String,
    pub hash: Option<String>,
    pub copyright_id: Option<String>,
    pub str_media_mid: Option<String>,
    pub song_id: Option<serde_json::Value>,
    pub lx_types: Option<HashMap<String, LxTypeEntry>>,
}

const SOURCE_PRIORITY: &[&str] = &["kw", "tx", "wy", "kg", "mg"];

const DURATION_TOLERANCE_SEC: f64 = 5.0;

fn normalize_name(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .chars()
        .filter(|c| {
            !c.is_whitespace()
                && !c.is_ascii_punctuation()
                && !matches!(c, '（' | '）' | '【' | '】' | '、' | '，' | '·')
        })
        .collect()
}

fn split_artists(singer: &str) -> Vec<String> {
    singer
        .split(|c| matches!(c, '、' | ',' | '/' | '&'))
        .flat_map(|s| s.split("feat."))
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

fn artists_intersect(a: &[String], b: &[String]) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let set_b: std::collections::HashSet<&String> = b.iter().collect();
    a.iter().any(|x| set_b.contains(x))
}

fn parse_interval_to_seconds(interval: &str) -> f64 {
    if interval.is_empty() {
        return 0.0;
    }
    if let Ok(secs) = interval.parse::<f64>() {
        return secs;
    }
    let parts: Vec<f64> = interval
        .split(':')
        .filter_map(|p| p.trim().parse::<f64>().ok())
        .collect();
    if parts.is_empty() {
        return 0.0;
    }
    parts.iter().fold(0.0, |acc, n| acc * 60.0 + n)
}

fn is_match(
    item: &crate::music::lx_search::LxSearchItem,
    target_name: &str,
    target_artists: &[String],
    target_duration: f64,
) -> bool {
    let item_name = normalize_name(&item.name);
    let title_matched = item_name == target_name
        || (item_name.chars().count() >= 3
            && target_name.chars().count() >= 3
            && (item_name.contains(target_name) || target_name.contains(&item_name)));
    if !title_matched {
        return false;
    }
    if !target_artists.is_empty() {
        let item_artists = split_artists(&item.singer);
        if !artists_intersect(target_artists, &item_artists) {
            return false;
        }
    }
    if target_duration > 0.0 {
        let item_duration = parse_interval_to_seconds(&item.interval);
        if item_duration > 0.0 && (item_duration - target_duration).abs() > DURATION_TOLERANCE_SEC {
            return false;
        }
    }
    true
}

#[tauri::command]
pub async fn find_alternative_lx_source(
    song_name: String,
    song_artist: String,
    song_duration: f64,
    failed_sources: Vec<String>,
) -> Result<Option<AlternativeSourceResult>, String> {
    let target_name = normalize_name(&song_name);
    if target_name.is_empty() {
        return Ok(None);
    }

    let primary_artist = extract_primary_artist(&song_artist);
    let keyword = if primary_artist.is_empty() {
        song_name.clone()
    } else {
        format!("{} {}", song_name, primary_artist)
    };

    let target_artists = split_artists(&song_artist);
    let failed_set: std::collections::HashSet<&str> =
        failed_sources.iter().map(|s| s.as_str()).collect();

    for &source in SOURCE_PRIORITY {
        if failed_set.contains(source) {
            continue;
        }

        let items = match crate::music::lx_search::lx_search(source, &keyword, 10).await {
            Ok(items) => items,
            Err(_) => {
                continue;
            }
        };

        for item in &items {
            if item.source != source {
                continue;
            }
            if !is_match(item, &target_name, &target_artists, song_duration) {
                continue;
            }

            return Ok(Some(AlternativeSourceResult {
                source: item.source.clone(),
                songmid: item.songmid.clone(),
                name: item.name.clone(),
                singer: item.singer.clone(),
                album_name: item.album_name.clone(),
                album_id: item.album_id.clone(),
                album_mid: item.album_mid.clone(),
                img: item.img.clone(),
                interval: item.interval.clone(),
                hash: item.hash.clone(),
                copyright_id: item.copyright_id.clone(),
                str_media_mid: item.str_media_mid.clone(),
                song_id: item.song_id.clone(),
                lx_types: item.lx_types.clone(),
            }));
        }
    }

    Ok(None)
}

fn extract_primary_artist(artist: &str) -> String {
    if artist.is_empty() || artist == "未知歌手" {
        return String::new();
    }
    let first = artist
        .split(|c| matches!(c, '、' | ',' | '/' | '&'))
        .next()
        .unwrap_or("");
    let trimmed = first.trim();
    if trimmed.is_empty() || trimmed == "未知歌手" {
        return String::new();
    }
    trimmed.to_string()
}
