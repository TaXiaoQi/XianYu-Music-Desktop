// lx_search.rs - LX 音源搜索（Rust 实现）
//
// 将前端 lxMusicSdk.ts 中的搜索逻辑迁移到 Rust，支持 kw / kg / tx / wy / mg 五个音源。
// 搜索结果带 5 分钟缓存，供 find_alternative_lx_source 换源命令使用。
//
// 与前端搜索保持一致的字段解析和音质映射，确保换源匹配结果与前端搜索结果兼容。

use crate::music::url_resolver::LxTypeEntry;
use base64::Engine;
use regex::Regex;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

// ==================== Types ====================

/// 搜索结果项（与前端 LxSearchResultItem 对应）
#[derive(Serialize, Clone, Debug)]
pub struct LxSearchItem {
    pub name: String,
    pub singer: String,
    pub album_name: String,
    pub album_id: serde_json::Value,
    pub songmid: String,
    pub source: String,
    pub interval: String,
    pub img: Option<String>,
    pub hash: Option<String>,
    pub str_media_mid: Option<String>,
    pub song_id: Option<serde_json::Value>,
    pub album_mid: Option<String>,
    pub copyright_id: Option<String>,
    /// 音质列表 (type, size, hash)
    pub types: Vec<LxTypeTuple>,
    /// 音质 → { size, hash } 映射
    pub lx_types: Option<HashMap<String, LxTypeEntry>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct LxTypeTuple {
    #[serde(rename = "type")]
    pub quality_type: String,
    pub size: Option<String>,
    pub hash: Option<String>,
}

// ==================== Search Cache ====================

struct SearchCacheEntry {
    items: Vec<LxSearchItem>,
    expires_at: Instant,
}

static SEARCH_CACHE: OnceLock<Arc<RwLock<HashMap<String, SearchCacheEntry>>>> = OnceLock::new();

fn search_cache() -> &'static Arc<RwLock<HashMap<String, SearchCacheEntry>>> {
    SEARCH_CACHE.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

const SEARCH_CACHE_TTL_SECS: u64 = 300; // 5 分钟

fn make_search_cache_key(source: &str, keyword: &str, limit: u32) -> String {
    format!("{}/{}/{}", source, keyword, limit)
}

async fn get_cached_search(source: &str, keyword: &str, limit: u32) -> Option<Vec<LxSearchItem>> {
    let cache = search_cache().read().await;
    let key = make_search_cache_key(source, keyword, limit);
    if let Some(entry) = cache.get(&key) {
        if entry.expires_at > Instant::now() {
            return Some(entry.items.clone());
        }
    }
    None
}

async fn set_cached_search(source: &str, keyword: &str, limit: u32, items: Vec<LxSearchItem>) {
    let mut cache = search_cache().write().await;
    let key = make_search_cache_key(source, keyword, limit);
    cache.insert(
        key,
        SearchCacheEntry {
            items,
            expires_at: Instant::now() + Duration::from_secs(SEARCH_CACHE_TTL_SECS),
        },
    );

    // 淘汰过期条目
    if cache.len() > 200 {
        let now = Instant::now();
        cache.retain(|_, entry| entry.expires_at > now);
    }
}

/// 清除搜索缓存
pub async fn clear_lx_search_cache() {
    let mut cache = search_cache().write().await;
    cache.clear();
}

// ==================== Utility Functions ====================

fn format_play_time(seconds: f64) -> String {
    if seconds.is_nan() || seconds <= 0.0 {
        return "00:00".to_string();
    }
    let total = seconds as u64;
    let m = total / 60;
    let s = total % 60;
    format!("{:02}:{:02}", m, s)
}

fn size_formate(bytes: f64) -> String {
    if bytes <= 0.0 {
        return "0B".to_string();
    }
    if bytes < 1024.0 {
        return format!("{}B", bytes as u64);
    }
    if bytes < 1024.0 * 1024.0 {
        return format!("{:.1}KB", bytes / 1024.0);
    }
    if bytes < 1024.0 * 1024.0 * 1024.0 {
        return format!("{:.1}MB", bytes / (1024.0 * 1024.0));
    }
    format!("{:.1}GB", bytes / (1024.0 * 1024.0 * 1024.0))
}

/// HTML 数字实体正则（`&#38;` / `&#x26;`），惰性编译一次复用
static HTML_NUMERIC_RE: OnceLock<Regex> = OnceLock::new();

/// 解码 HTML 数字实体（十进制/十六进制）为真实字符；无效码点原样保留
fn decode_numeric_entities(s: &str) -> String {
    let re = HTML_NUMERIC_RE.get_or_init(|| Regex::new(r"&#(x?[0-9a-fA-F]+);").unwrap());
    re.replace_all(s, |caps: &regex::Captures| {
        let digits = &caps[1];
        let parsed = if let Some(hex) = digits
            .strip_prefix('x')
            .or_else(|| digits.strip_prefix('X'))
        {
            u32::from_str_radix(hex, 16)
        } else {
            digits.parse::<u32>()
        };
        match parsed {
            Ok(cp) if cp != 0 => char::from_u32(cp)
                .map(|c| c.to_string())
                .unwrap_or_else(|| caps[0].to_string()),
            _ => caps[0].to_string(),
        }
    })
    .into_owned()
}

/// HTML 实体解码（覆盖常见命名实体 + 数字实体，前缀等价于前端 `he` 库的常用场景）
fn decode_name(s: &str) -> String {
    let named = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");
    decode_numeric_entities(&named)
}

/// 从歌手数组中提取歌手名（与前端 formatSingerName 一致）
fn format_singer_name(singers: &serde_json::Value, name_key: &str) -> String {
    if let Some(arr) = singers.as_array() {
        let names: Vec<String> = arr
            .iter()
            .filter_map(|item| {
                item.get(name_key)
                    .and_then(|n| n.as_str())
                    .map(|s| decode_name(s.trim()))
                    .filter(|s| !s.is_empty())
            })
            .collect();
        return names.join("、");
    }
    if let Some(s) = singers.as_str() {
        return decode_name(s);
    }
    String::new()
}

/// 构造酷我封面 URL（把开头尺寸段替换为目标尺寸）
static KUWO_SIZE_RE: OnceLock<Regex> = OnceLock::new();

fn build_kuwo_cover_url(web_albumpic_short: &str, size: u32) -> Option<String> {
    let short = web_albumpic_short.trim().trim_start_matches('/');
    if short.is_empty() {
        return None;
    }
    // 把开头的尺寸段换成目标尺寸（120/xxx → 500/xxx）
    let re = KUWO_SIZE_RE.get_or_init(|| Regex::new(r"^\d+/").unwrap());
    let sized = re.replace(short, format!("{}/", size));
    Some(format!("https://img3.kuwo.cn/star/albumcover/{}", sized))
}

/// 构造酷狗封面 URL（替换 {size} 占位符并升级为 HTTPS）
fn build_kugou_cover_url(url: &str, size: u32) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }
    let u = u.replacen("http://", "https://", 1);
    let u = u.replace("{size}", &size.to_string());
    Some(u)
}

// ==================== HTTP Helpers ====================

/// 全局 HTTP 客户端单例：复用连接池 / TLS 会话，避免每次请求重建 Client。
///
/// ⚠️ 这里对`音乐源搜索端点`关闭了 TLS 证书校验（`danger_accept_invalid_certs`），
/// 因历史源部分 CDN 证书链不完整。该放宽仅适用于公开的搜索接口，不应用于鉴权/下载链路。
/// 若将来这些端点修复证书，应移除此开关。
static HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

fn http_client() -> &'static Result<reqwest::Client, String> {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())
    })
}

async fn http_get_json(url: &str, headers: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let client = http_client().as_ref().map_err(|e| e.clone())?;
    let mut req = client.get(url);
    for (key, value) in headers {
        req = req.header(*key, *value);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    if status != 200 {
        return Err(format!("HTTP {} for {}", status, url));
    }

    serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {}", e))
}

async fn http_post_json(
    url: &str,
    body: &str,
    headers: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let client = http_client().as_ref().map_err(|e| e.clone())?;
    let mut req = client.post(url).body(body.to_string());
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

// ==================== TX (QQ音乐) Signing ====================

const TX_PART_1_INDEXES: [usize; 8] = [23, 14, 6, 36, 16, 40, 7, 19];
const TX_PART_2_INDEXES: [usize; 8] = [16, 1, 32, 12, 19, 27, 8, 5];
const TX_SCRAMBLE_VALUES: [u8; 20] = [
    89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179,
];

fn sha1_hex(text: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(text.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

fn pick_hash_by_idx(hash: &str, indexes: &[usize]) -> String {
    indexes
        .iter()
        .map(|&idx| hash.chars().nth(idx).unwrap_or('0'))
        .collect()
}

/// TX 签名（与前端 zzcSign 一致）
fn zzc_sign(text: &str) -> String {
    let hash = sha1_hex(text);
    let part1 = pick_hash_by_idx(&hash, &TX_PART_1_INDEXES);
    let part2 = pick_hash_by_idx(&hash, &TX_PART_2_INDEXES);

    // part3: XOR scramble values with hash bytes
    let mut part3_bytes = Vec::with_capacity(20);
    for (i, &scramble) in TX_SCRAMBLE_VALUES.iter().enumerate() {
        let hex_pair = &hash[i * 2..i * 2 + 2];
        let hash_byte = u8::from_str_radix(hex_pair, 16).unwrap_or(0);
        part3_bytes.push(scramble ^ hash_byte);
    }

    // Base64 encode and remove [\/+=]
    let b64 = base64::engine::general_purpose::STANDARD.encode(&part3_bytes);
    let b64_clean: String = b64
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '+' | '='))
        .collect();

    format!("zzc{}{}{}", part1, b64_clean, part2).to_lowercase()
}

// ==================== MG (咪咕) Signing ====================

fn mg_create_signature(time: &str, text: &str) -> (String, String) {
    let device_id = "963B7AA0D21511ED807EE5846EC87D20";
    let signature_md5 = "6cdc72a439cef99a3418d2a78aa28c73";
    let input = format!(
        "{}{}yyapp2d16148780a1dcc7408e06336b98cfd50{}{}",
        text, signature_md5, device_id, time
    );
    let sign = format!("{:x}", md5::compute(input.as_bytes()));
    (sign, device_id.to_string())
}

// ==================== KW (酷我) Search ====================

const KW_MINFO_REGEX: &str = r"level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)";

/// KW minfo 正则惰性编译一次，避免每次解析都重建
static KW_MINFO_RE: OnceLock<Regex> = OnceLock::new();

fn kw_handle_result(raw_data: &serde_json::Value) -> Option<Vec<LxSearchItem>> {
    let re = KW_MINFO_RE.get_or_init(|| Regex::new(KW_MINFO_REGEX).unwrap());
    let mut result = Vec::new();

    let arr = raw_data.as_array()?;
    for info in arr {
        let musicrid = info.get("MUSICRID").and_then(|v| v.as_str()).unwrap_or("");
        let song_id = musicrid.replace("MUSIC_", "");
        let n_minfo = info.get("N_MINFO").and_then(|v| v.as_str());
        if n_minfo.is_none() {
            return None; // 与前端一致：N_MINFO 为空时返回 null 触发重试
        }

        let mut types = Vec::new();
        let mut lx_types = HashMap::new();

        for item_str in n_minfo.unwrap().split(';') {
            if let Some(caps) = re.captures(item_str) {
                let bitrate = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let size = caps.get(4).map(|m| m.as_str()).unwrap_or("").to_uppercase();
                match bitrate {
                    "4000" => {
                        types.push(LxTypeTuple {
                            quality_type: "flac24bit".into(),
                            size: Some(size.clone()),
                            hash: None,
                        });
                        lx_types.insert(
                            "flac24bit".into(),
                            LxTypeEntry {
                                size: Some(size),
                                hash: None,
                            },
                        );
                    }
                    "2000" => {
                        types.push(LxTypeTuple {
                            quality_type: "flac".into(),
                            size: Some(size.clone()),
                            hash: None,
                        });
                        lx_types.insert(
                            "flac".into(),
                            LxTypeEntry {
                                size: Some(size),
                                hash: None,
                            },
                        );
                    }
                    "320" => {
                        types.push(LxTypeTuple {
                            quality_type: "320k".into(),
                            size: Some(size.clone()),
                            hash: None,
                        });
                        lx_types.insert(
                            "320k".into(),
                            LxTypeEntry {
                                size: Some(size),
                                hash: None,
                            },
                        );
                    }
                    "128" => {
                        types.push(LxTypeTuple {
                            quality_type: "128k".into(),
                            size: Some(size.clone()),
                            hash: None,
                        });
                        lx_types.insert(
                            "128k".into(),
                            LxTypeEntry {
                                size: Some(size),
                                hash: None,
                            },
                        );
                    }
                    _ => {}
                }
            }
        }
        // 构建顺序为高→低（flac24bit→128k），反转为低→高（128k 在前），与前端展示一致
        types.reverse();

        let duration_str = info
            .get("DURATION")
            .and_then(|v| v.as_str())
            .or_else(|| info.get("DURATION").and_then(|v| v.as_i64()).map(|_| "0"))
            .unwrap_or("0");
        let interval = duration_str
            .parse::<i64>()
            .map(|d| format_play_time(d as f64))
            .unwrap_or_else(|_| "00:00".to_string());

        let songname = decode_name(info.get("SONGNAME").and_then(|v| v.as_str()).unwrap_or(""));
        let artist = decode_name(info.get("ARTIST").and_then(|v| v.as_str()).unwrap_or(""))
            .replace('&', "、");
        let album = info.get("ALBUM").and_then(|v| v.as_str()).unwrap_or("");
        let album_id = info
            .get("ALBUMID")
            .and_then(|v| v.as_str())
            .or_else(|| {
                info.get("ALBUMID")
                    .and_then(|v| v.as_i64().map(|_| ""))
                    .map(|_| "")
            })
            .unwrap_or("");

        let web_albumpic_short = info
            .get("web_albumpic_short")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let img = build_kuwo_cover_url(web_albumpic_short, 500);

        result.push(LxSearchItem {
            name: songname,
            singer: artist,
            album_name: decode_name(album),
            album_id: serde_json::Value::String(album_id.to_string()),
            songmid: song_id,
            source: "kw".into(),
            interval,
            img,
            hash: None,
            str_media_mid: None,
            song_id: None,
            album_mid: None,
            copyright_id: None,
            types,
            lx_types: Some(lx_types),
        });
    }
    Some(result)
}

async fn search_kw(keyword: &str, limit: u32) -> Result<Vec<LxSearchItem>, String> {
    let url = format!(
        "http://search.kuwo.cn/r.s?client=kt&all={}&pn=0&rn={}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1",
        urlencoding::encode(keyword),
        limit
    );
    let result = http_get_json(&url, &[]).await?;

    // 检查是否需要重试（TOTAL !== '0' && SHOW === '0'）
    let total = result.get("TOTAL").and_then(|v| v.as_str()).unwrap_or("0");
    let show = result.get("SHOW").and_then(|v| v.as_str()).unwrap_or("1");
    if total != "0" && show == "0" {
        // 重试一次
        let retry = http_get_json(&url, &[]).await?;
        return kw_handle_result(retry.get("abslist").unwrap_or(&serde_json::Value::Null))
            .ok_or_else(|| "KW search: no valid results".to_string());
    }

    kw_handle_result(result.get("abslist").unwrap_or(&serde_json::Value::Null))
        .ok_or_else(|| "KW search: N_MINFO missing".to_string())
}

// ==================== KG (酷狗) Search ====================

fn kg_filter_data(raw: &serde_json::Value) -> LxSearchItem {
    let mut types = Vec::new();
    let mut lx_types = HashMap::new();

    let file_size = raw.get("FileSize").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let hq_size = raw
        .get("HQFileSize")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let sq_size = raw
        .get("SQFileSize")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let res_size = raw
        .get("ResFileSize")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let file_hash = raw
        .get("FileHash")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let hq_hash = raw
        .get("HQFileHash")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sq_hash = raw
        .get("SQFileHash")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let res_hash = raw
        .get("ResFileHash")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if file_size != 0.0 {
        let s = size_formate(file_size);
        types.push(LxTypeTuple {
            quality_type: "128k".into(),
            size: Some(s.clone()),
            hash: Some(file_hash.clone()),
        });
        lx_types.insert(
            "128k".into(),
            LxTypeEntry {
                size: Some(s),
                hash: Some(file_hash.clone()),
            },
        );
    }
    if hq_size != 0.0 {
        let s = size_formate(hq_size);
        types.push(LxTypeTuple {
            quality_type: "320k".into(),
            size: Some(s.clone()),
            hash: Some(hq_hash.clone()),
        });
        lx_types.insert(
            "320k".into(),
            LxTypeEntry {
                size: Some(s),
                hash: Some(hq_hash),
            },
        );
    }
    if sq_size != 0.0 {
        let s = size_formate(sq_size);
        types.push(LxTypeTuple {
            quality_type: "flac".into(),
            size: Some(s.clone()),
            hash: Some(sq_hash.clone()),
        });
        lx_types.insert(
            "flac".into(),
            LxTypeEntry {
                size: Some(s),
                hash: Some(sq_hash),
            },
        );
    }
    if res_size != 0.0 {
        let s = size_formate(res_size);
        types.push(LxTypeTuple {
            quality_type: "flac24bit".into(),
            size: Some(s.clone()),
            hash: Some(res_hash.clone()),
        });
        lx_types.insert(
            "flac24bit".into(),
            LxTypeEntry {
                size: Some(s),
                hash: Some(res_hash),
            },
        );
    }

    let image = raw
        .get("Image")
        .and_then(|v| v.as_str())
        .or_else(|| {
            raw.pointer("/trans_param/union_cover")
                .and_then(|v| v.as_str())
        })
        .unwrap_or("");
    let img = build_kugou_cover_url(image, 480);

    let duration = raw.get("Duration").and_then(|v| v.as_f64()).unwrap_or(0.0);

    LxSearchItem {
        singer: decode_name(&format_singer_name(
            raw.get("Singers").unwrap_or(&serde_json::Value::Null),
            "name",
        )),
        name: decode_name(raw.get("SongName").and_then(|v| v.as_str()).unwrap_or("")),
        album_name: decode_name(raw.get("AlbumName").and_then(|v| v.as_str()).unwrap_or("")),
        album_id: serde_json::Value::String(
            raw.get("AlbumID")
                .and_then(|v| v.as_str())
                .or_else(|| raw.get("AlbumID").and_then(|v| v.as_i64()).map(|_| ""))
                .unwrap_or("")
                .to_string(),
        ),
        songmid: raw
            .get("Audioid")
            .and_then(|v| v.as_str())
            .or_else(|| raw.get("Audioid").and_then(|v| v.as_i64()).map(|_| ""))
            .unwrap_or("")
            .to_string(),
        source: "kg".into(),
        interval: format_play_time(duration),
        img,
        hash: Some(file_hash),
        str_media_mid: None,
        song_id: None,
        album_mid: None,
        copyright_id: None,
        types,
        lx_types: Some(lx_types),
    }
}

fn kg_handle_result(raw_data: &serde_json::Value) -> Vec<LxSearchItem> {
    let mut ids = std::collections::HashSet::new();
    let mut list = Vec::new();

    if let Some(arr) = raw_data.as_array() {
        for item in arr {
            let audioid = item
                .get("Audioid")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("Audioid").and_then(|v| v.as_i64()).map(|_| ""))
                .unwrap_or("");
            let file_hash = item.get("FileHash").and_then(|v| v.as_str()).unwrap_or("");
            let key = format!("{}{}", audioid, file_hash);
            if ids.contains(&key) {
                continue;
            }
            ids.insert(key);
            list.push(kg_filter_data(item));

            // 处理 Grp 子项
            if let Some(grp) = item.get("Grp").and_then(|v| v.as_array()) {
                for child in grp {
                    let child_audioid = child
                        .get("Audioid")
                        .and_then(|v| v.as_str())
                        .or_else(|| child.get("Audioid").and_then(|v| v.as_i64()).map(|_| ""))
                        .unwrap_or("");
                    let child_hash = child.get("FileHash").and_then(|v| v.as_str()).unwrap_or("");
                    let child_key = format!("{}{}", child_audioid, child_hash);
                    if ids.contains(&child_key) {
                        continue;
                    }
                    ids.insert(child_key);
                    list.push(kg_filter_data(child));
                }
            }
        }
    }
    list
}

async fn search_kg(keyword: &str, limit: u32) -> Result<Vec<LxSearchItem>, String> {
    let url = format!(
        "https://songsearch.kugou.com/song_search_v2?keyword={}&page=1&pagesize={}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1",
        urlencoding::encode(keyword),
        limit
    );
    let result = http_get_json(&url, &[]).await?;

    if result.get("error_code").and_then(|v| v.as_i64()) != Some(0) {
        return Err("KG search: error_code != 0".to_string());
    }

    let lists = result
        .pointer("/data/lists")
        .unwrap_or(&serde_json::Value::Null);
    Ok(kg_handle_result(lists))
}

// ==================== TX (QQ音乐) Search ====================

fn tx_handle_result(raw_list: &serde_json::Value) -> Vec<LxSearchItem> {
    let mut list = Vec::new();
    let arr = match raw_list.as_array() {
        Some(a) => a,
        None => return list,
    };

    for item in arr {
        let file = match item.get("file") {
            Some(f) => f,
            None => continue,
        };
        let media_mid = file.get("media_mid").and_then(|v| v.as_str()).unwrap_or("");
        if media_mid.is_empty() {
            continue;
        }

        let mut types = Vec::new();
        let mut lx_types = HashMap::new();

        let size_128 = file
            .get("size_128mp3")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let size_320 = file
            .get("size_320mp3")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let size_flac = file
            .get("size_flac")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let size_hires = file
            .get("size_hires")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        if size_128 != 0.0 {
            let s = size_formate(size_128);
            types.push(LxTypeTuple {
                quality_type: "128k".into(),
                size: Some(s.clone()),
                hash: None,
            });
            lx_types.insert(
                "128k".into(),
                LxTypeEntry {
                    size: Some(s),
                    hash: None,
                },
            );
        }
        if size_320 != 0.0 {
            let s = size_formate(size_320);
            types.push(LxTypeTuple {
                quality_type: "320k".into(),
                size: Some(s.clone()),
                hash: None,
            });
            lx_types.insert(
                "320k".into(),
                LxTypeEntry {
                    size: Some(s),
                    hash: None,
                },
            );
        }
        if size_flac != 0.0 {
            let s = size_formate(size_flac);
            types.push(LxTypeTuple {
                quality_type: "flac".into(),
                size: Some(s.clone()),
                hash: None,
            });
            lx_types.insert(
                "flac".into(),
                LxTypeEntry {
                    size: Some(s),
                    hash: None,
                },
            );
        }
        if size_hires != 0.0 {
            let s = size_formate(size_hires);
            types.push(LxTypeTuple {
                quality_type: "flac24bit".into(),
                size: Some(s.clone()),
                hash: None,
            });
            lx_types.insert(
                "flac24bit".into(),
                LxTypeEntry {
                    size: Some(s),
                    hash: None,
                },
            );
        }

        let mut album_id = String::new();
        let mut album_name = String::new();
        if let Some(album) = item.get("album") {
            album_name = album
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            album_id = album
                .get("mid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        }

        let interval = item.get("interval").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let songmid = item
            .get("mid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let song_id = item.get("id").cloned();
        let album_mid = item
            .pointer("/album/mid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let img = if album_id.is_empty() || album_id == "空" {
            // 回退到歌手头像
            item.pointer("/singer/0/mid")
                .and_then(|v| v.as_str())
                .map(|mid| {
                    format!(
                        "https://y.gtimg.cn/music/photo_new/T001R500x500M000{}.jpg",
                        mid
                    )
                })
        } else {
            Some(format!(
                "https://y.gtimg.cn/music/photo_new/T002R500x500M000{}.jpg",
                album_id
            ))
        };

        list.push(LxSearchItem {
            singer: format_singer_name(
                item.get("singer").unwrap_or(&serde_json::Value::Null),
                "name",
            ),
            name: item
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            album_name,
            album_id: serde_json::Value::String(album_id),
            source: "tx".into(),
            interval: format_play_time(interval),
            songmid,
            img,
            hash: None,
            str_media_mid: Some(media_mid.to_string()),
            song_id,
            album_mid,
            copyright_id: None,
            types,
            lx_types: Some(lx_types),
        });
    }
    list
}

async fn search_tx(keyword: &str, limit: u32) -> Result<Vec<LxSearchItem>, String> {
    let request_data = serde_json::json!({
        "comm": {
            "ct": "11", "cv": "14090508", "v": "14090508", "tmeAppID": "qqmusic",
            "phonetype": "EBG-AN10", "deviceScore": "553.47", "devicelevel": "50", "newdevicelevel": "20",
            "rom": "HuaWei/EMOTION/EmotionUI_14.2.0", "os_ver": "12",
            "OpenUDID": "0", "OpenUDID2": "0", "QIMEI36": "0", "udid": "0", "chid": "0", "aid": "0",
            "oaid": "0", "taid": "0", "tid": "0", "wid": "0", "uid": "0", "sid": "0",
            "modeSwitch": "6", "teenMode": "0", "ui_mode": "2", "nettype": "1020", "v4ip": "",
        },
        "req": {
            "module": "music.search.SearchCgiService",
            "method": "DoSearchForQQMusicMobile",
            "param": {
                "search_type": 0,
                "searchid": format!("{}", chrono_like_random()),
                "query": keyword,
                "page_num": 1,
                "num_per_page": limit,
                "highlight": 0, "nqc_flag": 0, "multi_zhida": 0, "cat": 2, "grp": 1, "sin": 0, "sem": 0,
            },
        },
    });

    let request_str = serde_json::to_string(&request_data).map_err(|e| e.to_string())?;
    let sign = zzc_sign(&request_str);
    let url = format!("https://u.y.qq.com/cgi-bin/musics.fcg?sign={}", sign);

    let body = http_post_json(
        &url,
        &request_str,
        &[
            ("User-Agent", "QQMusic 14090508(android 12)"),
            ("Content-Type", "application/json"),
        ],
    )
    .await?;

    // 检查响应
    if body.get("code").and_then(|v| v.as_i64()) != Some(0)
        || body.pointer("/req/code").and_then(|v| v.as_i64()) != Some(0)
    {
        return Err("TX search: invalid response code".to_string());
    }

    let song_list = body
        .pointer("/req/data/body/item_song")
        .unwrap_or(&serde_json::Value::Null);
    Ok(tx_handle_result(song_list))
}

/// 生成一个类似 Date.now().toString().slice(2) 的随机 ID
fn chrono_like_random() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let mut val = now.as_millis() as u64;
    // 模拟 JS Math.random().toString().slice(2) 附加
    val = val.wrapping_mul(1000) + (val % 900);
    val
}

// ==================== WY (网易云) Search ====================

async fn search_wy(keyword: &str, limit: u32) -> Result<Vec<LxSearchItem>, String> {
    let url = format!(
        "https://music.163.com/api/search/get/web?s={}&type=1&offset=0&limit={}",
        urlencoding::encode(keyword),
        limit
    );

    let result = http_get_json(
        &url,
        &[
            ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36"),
            ("Referer", "https://music.163.com"),
            ("Cookie", "MUSIC_A=1"),
        ],
    )
    .await?;

    if result.get("code").and_then(|v| v.as_i64()) != Some(200) {
        return Err("WY search: code != 200".to_string());
    }

    let songs = result
        .pointer("/result/songs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut list = Vec::new();

    for song in &songs {
        let mut types = Vec::new();
        let mut lx_types = HashMap::new();

        if song.get("hq").is_some() {
            types.push(LxTypeTuple {
                quality_type: "320k".into(),
                size: None,
                hash: None,
            });
            lx_types.insert(
                "320k".into(),
                LxTypeEntry {
                    size: None,
                    hash: None,
                },
            );
        }
        if song.get("sq").is_some() {
            types.push(LxTypeTuple {
                quality_type: "flac".into(),
                size: None,
                hash: None,
            });
            lx_types.insert(
                "flac".into(),
                LxTypeEntry {
                    size: None,
                    hash: None,
                },
            );
        }
        types.push(LxTypeTuple {
            quality_type: "128k".into(),
            size: None,
            hash: None,
        });
        lx_types.insert(
            "128k".into(),
            LxTypeEntry {
                size: None,
                hash: None,
            },
        );
        // 构建顺序为高→低（hq→sq→128k），反转为低→高（128k 在前），与前端展示一致
        types.reverse();

        let ar = song
            .get("artists")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let al = song
            .get("album")
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        let img = al
            .get("picUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let singer = ar
            .iter()
            .filter_map(|s| {
                s.get("name")
                    .and_then(|n| n.as_str())
                    .map(|n| n.to_string())
            })
            .collect::<Vec<_>>()
            .join("、");

        let duration = song.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);

        list.push(LxSearchItem {
            singer,
            name: song
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            album_name: al
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            album_id: al.get("id").cloned().unwrap_or(serde_json::Value::Null),
            source: "wy".into(),
            interval: format_play_time(duration / 1000.0),
            songmid: song
                .get("id")
                .and_then(|v| v.as_i64())
                .map(|n| n.to_string())
                .unwrap_or_default(),
            img,
            hash: None,
            str_media_mid: None,
            song_id: None,
            album_mid: None,
            copyright_id: None,
            types,
            lx_types: Some(lx_types),
        });
    }

    Ok(list)
}

// ==================== MG (咪咕) Search ====================

fn mg_filter_data(raw_data: &serde_json::Value) -> Vec<LxSearchItem> {
    let mut list = Vec::new();
    let mut ids = std::collections::HashSet::new();

    // raw_data 可能是 [[{...}, {...}], [{...}]] 的嵌套结构
    let flat: Vec<&serde_json::Value> = if let Some(outer) = raw_data.as_array() {
        let mut items = Vec::new();
        for inner in outer {
            if let Some(arr) = inner.as_array() {
                for item in arr {
                    items.push(item);
                }
            } else {
                items.push(inner);
            }
        }
        items
    } else {
        vec![]
    };

    for data in flat {
        let song_id = data
            .get("songId")
            .and_then(|v| v.as_str())
            .or_else(|| data.get("songId").and_then(|v| v.as_i64()).map(|_| ""))
            .unwrap_or("");
        let copyright_id = data
            .get("copyrightId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if song_id.is_empty() || copyright_id.is_empty() || ids.contains(copyright_id) {
            continue;
        }
        ids.insert(copyright_id.to_string());

        let mut types = Vec::new();
        let mut lx_types = HashMap::new();

        if let Some(audio_formats) = data.get("audioFormats").and_then(|v| v.as_array()) {
            for fmt in audio_formats {
                let format_type = fmt.get("formatType").and_then(|v| v.as_str()).unwrap_or("");
                let asize = fmt.get("asize").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let isize = fmt.get("isize").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let size_val = if asize > 0.0 { asize } else { isize };
                let size_str = size_formate(size_val);

                match format_type {
                    "PQ" => {
                        types.push(LxTypeTuple {
                            quality_type: "128k".into(),
                            size: Some(size_str.clone()),
                            hash: None,
                        });
                        lx_types.insert(
                            "128k".into(),
                            LxTypeEntry {
                                size: Some(size_str),
                                hash: None,
                            },
                        );
                    }
                    "HQ" => {
                        types.push(LxTypeTuple {
                            quality_type: "320k".into(),
                            size: Some(size_str.clone()),
                            hash: None,
                        });
                        lx_types.insert(
                            "320k".into(),
                            LxTypeEntry {
                                size: Some(size_str),
                                hash: None,
                            },
                        );
                    }
                    "SQ" => {
                        types.push(LxTypeTuple {
                            quality_type: "flac".into(),
                            size: Some(size_str.clone()),
                            hash: None,
                        });
                        lx_types.insert(
                            "flac".into(),
                            LxTypeEntry {
                                size: Some(size_str),
                                hash: None,
                            },
                        );
                    }
                    "ZQ24" => {
                        types.push(LxTypeTuple {
                            quality_type: "flac24bit".into(),
                            size: Some(size_str.clone()),
                            hash: None,
                        });
                        lx_types.insert(
                            "flac24bit".into(),
                            LxTypeEntry {
                                size: Some(size_str),
                                hash: None,
                            },
                        );
                    }
                    _ => {}
                }
            }
        }

        let mut img = data
            .get("img3")
            .and_then(|v| v.as_str())
            .or_else(|| data.get("img2").and_then(|v| v.as_str()))
            .or_else(|| data.get("img1").and_then(|v| v.as_str()))
            .map(|s| s.to_string());
        if let Some(ref img_url) = img {
            if !img_url.starts_with("http") {
                img = Some(format!("http://d.musicapp.migu.cn{}", img_url));
            }
        }

        let duration = data.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);

        list.push(LxSearchItem {
            singer: format_singer_name(
                data.get("singerList")
                    .or_else(|| data.get("singers"))
                    .unwrap_or(&serde_json::Value::Null),
                "name",
            ),
            name: data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            album_name: data
                .get("album")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            album_id: data
                .get("albumId")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            songmid: song_id.to_string(),
            source: "mg".into(),
            interval: format_play_time(duration),
            img,
            hash: None,
            str_media_mid: None,
            song_id: None,
            album_mid: None,
            copyright_id: Some(copyright_id.to_string()),
            types,
            lx_types: Some(lx_types),
        });
    }

    list
}

async fn search_mg(keyword: &str, limit: u32) -> Result<Vec<LxSearchItem>, String> {
    let time = std::time::SystemTime::now();
    let timestamp = time
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    let (sign, device_id) = mg_create_signature(&timestamp, keyword);

    let search_switch = urlencoding::encode(
        r#"{"song":1,"album":0,"singer":0,"tagSong":1,"mvSong":0,"bestShow":1,"songlist":0,"lyricSong":0}"#,
    );
    let url = format!(
        "https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch={}&pageSize={}&text={}&pageNo=1&sort=0&sid=USS",
        search_switch,
        limit,
        urlencoding::encode(keyword)
    );

    let result = http_get_json(
        &url,
        &[
            ("uiVersion", "A_music_3.6.1"),
            ("deviceId", &device_id),
            ("timestamp", &timestamp),
            ("sign", &sign),
            ("channel", "0146921"),
            ("User-Agent", "Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30"),
        ],
    )
    .await?;

    if result.get("code").and_then(|v| v.as_str()) != Some("000000") {
        return Err("MG search: code != 000000".to_string());
    }

    let song_result_data = result
        .get("songResultData")
        .unwrap_or(&serde_json::Value::Null);
    let result_list = song_result_data
        .get("resultList")
        .unwrap_or(&serde_json::Value::Null);
    Ok(mg_filter_data(result_list))
}

// ==================== Public API ====================

/// 搜索 LX 音源
///
/// 优先查询缓存，缓存未命中时执行实际搜索。
/// 搜索成功后自动写入缓存。
pub async fn lx_search(
    source: &str,
    keyword: &str,
    limit: u32,
) -> Result<Vec<LxSearchItem>, String> {
    // 归一化 limit：0 表示使用各音源默认值，缓存键统一用实际查询条数，避免同一结果存多份
    let default_limit = match source {
        "tx" => 50,
        "mg" => 20,
        _ => 30,
    };
    let actual_limit = if limit == 0 { default_limit } else { limit };

    // 查询缓存
    if let Some(cached) = get_cached_search(source, keyword, actual_limit).await {
        return Ok(cached);
    }

    // 执行搜索
    let items = match source {
        "kw" => search_kw(keyword, actual_limit).await,
        "kg" => search_kg(keyword, actual_limit).await,
        "tx" => search_tx(keyword, actual_limit).await,
        "wy" => search_wy(keyword, actual_limit).await,
        "mg" => search_mg(keyword, actual_limit).await,
        _ => Err(format!("Unknown LX source: {}", source)),
    }?;

    // 写入缓存
    set_cached_search(source, keyword, actual_limit, items.clone()).await;

    Ok(items)
}

/// 清除所有 LX 缓存（URL + 搜索）
#[tauri::command]
pub async fn clear_lx_all_cache() -> Result<(), String> {
    clear_lx_search_cache().await;
    let _ = crate::music::url_resolver::clear_lx_url_cache().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ===== format_play_time =====

    #[test]
    fn test_format_play_time_zero() {
        assert_eq!(format_play_time(0.0), "00:00");
    }

    #[test]
    fn test_format_play_time_negative() {
        assert_eq!(format_play_time(-5.0), "00:00");
    }

    #[test]
    fn test_format_play_time_nan() {
        assert_eq!(format_play_time(f64::NAN), "00:00");
    }

    #[test]
    fn test_format_play_time_seconds_only() {
        assert_eq!(format_play_time(45.0), "00:45");
    }

    #[test]
    fn test_format_play_time_minutes_and_seconds() {
        assert_eq!(format_play_time(125.0), "02:05");
    }

    #[test]
    fn test_format_play_time_large_value() {
        assert_eq!(format_play_time(3661.0), "61:01");
    }

    #[test]
    fn test_format_play_time_truncates_fractional() {
        assert_eq!(format_play_time(65.7), "01:05");
    }

    // ===== size_formate =====

    #[test]
    fn test_size_formate_zero() {
        assert_eq!(size_formate(0.0), "0B");
    }

    #[test]
    fn test_size_formate_negative() {
        assert_eq!(size_formate(-100.0), "0B");
    }

    #[test]
    fn test_size_formate_bytes() {
        assert_eq!(size_formate(512.0), "512B");
    }

    #[test]
    fn test_size_formate_kilobytes() {
        assert_eq!(size_formate(2048.0), "2.0KB");
    }

    #[test]
    fn test_size_formate_megabytes() {
        assert_eq!(size_formate(1048576.0), "1.0MB");
    }

    #[test]
    fn test_size_formate_gigabytes() {
        assert_eq!(size_formate(1073741824.0), "1.0GB");
    }

    // ===== decode_name =====

    #[test]
    fn test_decode_name_amp() {
        assert_eq!(decode_name("Tom &amp; Jerry"), "Tom & Jerry");
    }

    #[test]
    fn test_decode_name_lt_gt() {
        assert_eq!(decode_name("&lt;tag&gt;"), "<tag>");
    }

    #[test]
    fn test_decode_name_quot() {
        assert_eq!(decode_name("&quot;hello&quot;"), "\"hello\"");
    }

    #[test]
    fn test_decode_name_multiple_entities() {
        assert_eq!(
            decode_name("&amp;&lt;&gt;&quot;&#39;&apos;&nbsp;"),
            "&<>\"'' "
        );
    }

    #[test]
    fn test_decode_name_no_entities() {
        assert_eq!(decode_name("plain text"), "plain text");
    }

    // ===== format_singer_name =====

    #[test]
    fn test_format_singer_name_array() {
        let singers = serde_json::json!([
            {"name": "周杰伦"},
            {"name": "方文山"}
        ]);
        assert_eq!(format_singer_name(&singers, "name"), "周杰伦、方文山");
    }

    #[test]
    fn test_format_singer_name_string() {
        let singers = serde_json::json!("陈奕迅");
        assert_eq!(format_singer_name(&singers, "name"), "陈奕迅");
    }

    #[test]
    fn test_format_singer_name_empty_array() {
        let singers = serde_json::json!([]);
        assert_eq!(format_singer_name(&singers, "name"), "");
    }

    #[test]
    fn test_format_singer_name_skips_empty_names() {
        let singers = serde_json::json!([
            {"name": "  "},
            {"name": "李荣浩"}
        ]);
        assert_eq!(format_singer_name(&singers, "name"), "李荣浩");
    }

    #[test]
    fn test_format_singer_name_null() {
        let singers = serde_json::Value::Null;
        assert_eq!(format_singer_name(&singers, "name"), "");
    }

    // ===== build_kuwo_cover_url =====

    #[test]
    fn test_build_kuwo_cover_url_normal() {
        let url = build_kuwo_cover_url("/120/albumcover/abc.jpg", 500);
        assert_eq!(
            url.as_deref(),
            Some("https://img3.kuwo.cn/star/albumcover/500/albumcover/abc.jpg")
        );
    }

    #[test]
    fn test_build_kuwo_cover_url_empty() {
        assert_eq!(build_kuwo_cover_url("", 500), None);
    }

    #[test]
    fn test_build_kuwo_cover_url_whitespace_only() {
        assert_eq!(build_kuwo_cover_url("   ", 500), None);
    }

    #[test]
    fn test_build_kuwo_cover_url_no_leading_size() {
        let url = build_kuwo_cover_url("albumcover/abc.jpg", 300);
        assert_eq!(
            url.as_deref(),
            Some("https://img3.kuwo.cn/star/albumcover/albumcover/abc.jpg")
        );
    }

    // ===== build_kugou_cover_url =====

    #[test]
    fn test_build_kugou_cover_url_with_size_placeholder() {
        let url = build_kugou_cover_url("http://imge.kugou.com/album/{size}/abc.jpg", 480);
        assert_eq!(
            url.as_deref(),
            Some("https://imge.kugou.com/album/480/abc.jpg")
        );
    }

    #[test]
    fn test_build_kugou_cover_url_empty() {
        assert_eq!(build_kugou_cover_url("", 480), None);
    }

    #[test]
    fn test_build_kugou_cover_url_https_upgrade() {
        let url = build_kugou_cover_url("http://example.com/cover.jpg", 480);
        assert_eq!(url.as_deref(), Some("https://example.com/cover.jpg"));
    }

    #[test]
    fn test_build_kugou_cover_url_already_https() {
        let url = build_kugou_cover_url("https://example.com/cover.jpg", 480);
        assert_eq!(url.as_deref(), Some("https://example.com/cover.jpg"));
    }

    // ===== make_search_cache_key =====

    #[test]
    fn test_make_search_cache_key() {
        assert_eq!(make_search_cache_key("kw", "周杰伦", 30), "kw/周杰伦/30");
    }

    #[test]
    fn test_make_search_cache_key_different_sources() {
        let key1 = make_search_cache_key("kw", "test", 20);
        let key2 = make_search_cache_key("kg", "test", 20);
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_make_search_cache_key_different_limits() {
        let key1 = make_search_cache_key("kw", "test", 20);
        let key2 = make_search_cache_key("kw", "test", 30);
        assert_ne!(key1, key2);
    }

    // ===== sha1_hex =====

    #[test]
    fn test_sha1_hex_known_value() {
        // SHA1("hello") = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
        assert_eq!(
            sha1_hex("hello"),
            "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
        );
    }

    #[test]
    fn test_sha1_hex_empty_string() {
        // SHA1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709
        assert_eq!(sha1_hex(""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    }

    #[test]
    fn test_sha1_hex_unicode() {
        let hash = sha1_hex("周杰伦");
        assert_eq!(hash.len(), 40); // SHA1 hex = 40 chars
    }

    // ===== pick_hash_by_idx =====

    #[test]
    fn test_pick_hash_by_idx_normal() {
        let hash = "0123456789abcdef";
        assert_eq!(pick_hash_by_idx(hash, &[0, 5, 10]), "05a");
    }

    #[test]
    fn test_pick_hash_by_idx_out_of_range() {
        let hash = "abc";
        // index 10 is out of range, should default to '0'
        assert_eq!(pick_hash_by_idx(hash, &[0, 10]), "a0");
    }

    #[test]
    fn test_pick_hash_by_idx_empty_indexes() {
        let hash = "0123456789abcdef";
        assert_eq!(pick_hash_by_idx(hash, &[]), "");
    }

    // ===== LxSearchItem serialization =====

    #[test]
    fn test_lx_search_item_serialization() {
        let item = LxSearchItem {
            name: "晴天".into(),
            singer: "周杰伦".into(),
            album_name: "叶惠美".into(),
            album_id: serde_json::json!(12345),
            songmid: "song123".into(),
            source: "kw".into(),
            interval: "04:29".into(),
            img: Some("https://example.com/cover.jpg".into()),
            hash: Some("abc123".into()),
            str_media_mid: None,
            song_id: None,
            album_mid: None,
            copyright_id: None,
            types: vec![LxTypeTuple {
                quality_type: "320k".into(),
                size: Some("10.5MB".into()),
                hash: None,
            }],
            lx_types: None,
        };

        let json = serde_json::to_string(&item).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        // 验证 types 中的 rename
        assert_eq!(v["types"][0]["type"], "320k");
        assert_eq!(v["types"][0]["size"], "10.5MB");
        // 验证基本字段
        assert_eq!(v["name"], "晴天");
        assert_eq!(v["singer"], "周杰伦");
        assert_eq!(v["source"], "kw");
    }

    // ===== tx_handle_result fixture =====

    #[test]
    fn test_tx_handle_result_maps_fields_and_orders_types() {
        let raw = serde_json::json!([{
            "title": "晴天",
            "mid": "003",
            "singer": [{"name": "周杰伦"}],
            "album": {"mid": "alb01", "name": "叶惠美"},
            "interval": 240,
            "file": {
                "media_mid": "M001",
                "size_128mp3": 4.1e6,
                "size_320mp3": 8.2e6,
                "size_flac": 20.0e6,
                "size_hires": 0.0
            }
        }]);

        let list = tx_handle_result(&raw);
        assert_eq!(list.len(), 1);
        let it = &list[0];
        assert_eq!(it.name, "晴天");
        assert_eq!(it.singer, "周杰伦");
        assert_eq!(it.album_name, "叶惠美");
        assert_eq!(it.source, "tx");
        assert_eq!(it.songmid, "003");
        assert_eq!(it.str_media_mid.as_deref(), Some("M001"));
        assert_eq!(it.album_mid.as_deref(), Some("alb01"));
        assert_eq!(it.interval, "04:00");

        // 音质 128k/320k/flac 均有 → 低→高顺序
        let types: Vec<&str> = it.types.iter().map(|t| t.quality_type.as_str()).collect();
        assert_eq!(types, vec!["128k", "320k", "flac"]);
    }

    #[test]
    fn test_tx_handle_result_skips_item_without_media_mid() {
        let raw = serde_json::json!([
            { "title": "有料", "file": {} },
            { "title": "没料", "file": { "media_mid": "M001" } }
        ]);
        let list = tx_handle_result(&raw);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "没料");
    }

    // ===== mg_filter_data fixture =====

    #[test]
    fn test_mg_filter_data_flattens_and_dedupes_by_copyright() {
        let raw = serde_json::json!([[
            {
                "songId": "s1",
                "copyrightId": "c1",
                "name": "歌一",
                "album": "专辑一",
                "albumId": 42,
                "duration": 180,
                "singerList": [{"name": "歌手一"}],
                "audioFormats": [
                    {"formatType": "PQ", "asize": 3.0e6},
                    {"formatType": "SQ", "asize": 9.0e6}
                ]
            },
            {
                "songId": "s1-dup",
                "copyrightId": "c1",
                "name": "重复项(应被去重)",
                "audioFormats": [{"formatType": "PQ", "asize": 3.0e6}]
            }
        ]]);
        let list = mg_filter_data(&raw);
        assert_eq!(list.len(), 1);

        let it = &list[0];
        assert_eq!(it.name, "歌一");
        assert_eq!(it.source, "mg");
        assert_eq!(it.songmid, "s1");
        assert_eq!(it.copyright_id.as_deref(), Some("c1"));
        assert_eq!(it.singer, "歌手一");
        assert_eq!(it.interval, "03:00");

        // PQ(128k) 先、SQ(flac) 后 → 低→高
        let types: Vec<&str> = it.types.iter().map(|t| t.quality_type.as_str()).collect();
        assert_eq!(types, vec!["128k", "flac"]);
    }

    #[test]
    fn test_mg_filter_data_dedup_same_quality_using_isize_fallback() {
        let raw = serde_json::json!([[{
            "songId": "s2",
            "copyrightId": "c2",
            "name": "歌二",
            "album": "专辑B",
            "singerList": [{"name": "歌手二"}],
            "audioFormats": [
                // asize 缺失时回退 isize
                {"formatType": "HQ", "asize": 0.0, "isize": 5.0e6},
                {"formatType": "ZQ24", "asize": 0.0, "isize": 30.0e6}
            ]
        }]]);
        let items = mg_filter_data(&raw);
        assert_eq!(items.len(), 1);
        let it = &items[0];
        let types: Vec<&str> = it.types.iter().map(|t| t.quality_type.as_str()).collect();
        assert_eq!(types, vec!["320k", "flac24bit"]);
    }
}
