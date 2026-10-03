use super::common::{format_play_time, format_singer_name, http_post_json, size_formate};
use super::sign::zzc_sign;
use super::{LxSearchItem, LxTypeTuple};
use crate::music::url_resolver::LxTypeEntry;
use std::collections::HashMap;

fn tx_string_field(item: &serde_json::Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = item.get(*key) {
            if let Some(text) = value.as_str() {
                if !text.is_empty() {
                    return text.to_string();
                }
            } else if let Some(number) = value.as_i64() {
                return number.to_string();
            } else if let Some(number) = value.as_u64() {
                return number.to_string();
            }
        }
    }
    String::new()
}

fn tx_pick_search_raw_list(data: &serde_json::Value) -> Option<&serde_json::Value> {
    const PATHS: &[&str] = &[
        "/body/song/list",
        "/body/song/songlist",
        "/body/song/itemlist",
        "/body/song/items",
        "/body/song/item_song",
        "/body/songlist/list",
        "/body/songlist/songlist",
        "/body/songlist/itemlist",
        "/body/songlist/items",
        "/body/songlist",
        "/body/item_song",
        "/song/list",
        "/songlist",
        "/item_song",
    ];

    for path in PATHS {
        if let Some(value) = data.pointer(path) {
            if value.as_array().map_or(false, |arr| !arr.is_empty()) {
                return Some(value);
            }
        }
    }

    None
}

pub(super) fn tx_handle_result(raw_list: &serde_json::Value) -> Vec<LxSearchItem> {
    let mut list = Vec::new();
    let arr = match raw_list.as_array() {
        Some(a) => a,
        None => return list,
    };

    for raw_item in arr {
        let item = raw_item
            .get("song")
            .or_else(|| raw_item.get("songInfo"))
            .or_else(|| raw_item.get("musicInfo"))
            .unwrap_or(raw_item);
        let songmid = tx_string_field(item, &["mid", "songmid", "songMid", "strMediaMid", "id"]);
        let has_mid = !songmid.is_empty();
        let has_id = item.get("id").is_some();
        if !has_mid && !has_id {
            continue;
        }
        let file = item.get("file").unwrap_or(&serde_json::Value::Null);
        let media_mid = file
            .get("media_mid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| tx_string_field(item, &["strMediaMid", "mediaMid", "mediamid"]));

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
        let size_master = file
            .get("size_master")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let size_atmos = file
            .get("size_atmos")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let size_dolby = file
            .get("size_dolby")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        if size_128 > 0.0 {
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
        if size_320 > 0.0 {
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
        if size_flac > 0.0 {
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
        if size_hires > 0.0 {
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
        if size_master > 0.0 {
            let s = size_formate(size_master);
            types.push(LxTypeTuple {
                quality_type: "master".into(),
                size: Some(s.clone()),
                hash: None,
            });
            lx_types.insert(
                "master".into(),
                LxTypeEntry {
                    size: Some(s),
                    hash: None,
                },
            );
        }
        if size_atmos > 0.0 {
            let s = size_formate(size_atmos);
            types.push(LxTypeTuple {
                quality_type: "atmos".into(),
                size: Some(s.clone()),
                hash: None,
            });
            lx_types.insert(
                "atmos".into(),
                LxTypeEntry {
                    size: Some(s),
                    hash: None,
                },
            );
        }
        if size_dolby > 0.0 {
            let s = size_formate(size_dolby);
            types.push(LxTypeTuple {
                quality_type: "dolby".into(),
                size: Some(s.clone()),
                hash: None,
            });
            lx_types.insert(
                "dolby".into(),
                LxTypeEntry {
                    size: Some(s),
                    hash: None,
                },
            );
        }

        let album = item.get("album").unwrap_or(&serde_json::Value::Null);
        let album_id = album
            .get("mid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| tx_string_field(item, &["albumMid", "albummid", "albumid"]));
        let album_name = album
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| tx_string_field(item, &["albumName", "albumname"]));

        let interval = item.get("interval").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let song_id = item.get("id").or_else(|| item.get("songid")).cloned();
        let album_mid = if album_id.is_empty() {
            None
        } else {
            Some(album_id.clone())
        };

        let img = if album_id.is_empty() || album_id == "空" {
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
                item.get("singer")
                    .or_else(|| item.get("singerName"))
                    .or_else(|| item.get("singername"))
                    .unwrap_or(&serde_json::Value::Null),
                "name",
            ),
            name: item
                .get("title")
                .or_else(|| item.get("name"))
                .or_else(|| item.get("songname"))
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
            str_media_mid: Some(media_mid),
            song_id,
            album_mid,
            copyright_id: None,
            types,
            lx_types: Some(lx_types),
        });
    }
    list
}

pub(super) async fn search_tx(keyword: &str, limit: u32) -> Result<Vec<LxSearchItem>, String> {
    let request_data = serde_json::json!({
        "comm": {
            "ct": "24", "cv": "4747474", "v": "4747474", "tmeAppID": "qqmusic",
            "format": "json", "inCharset": "utf-8", "outCharset": "utf-8",
            "platform": "yqq.json", "needNewCode": 0,
            "uin": "0", "guid": "0",
        },
        "req": {
            "module": "music.search.SearchCgiService",
            "method": "DoSearchForQQMusicDesktop",
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
            ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
            ("Content-Type", "application/json"),
            ("Referer", "https://y.qq.com/"),
        ],
    )
    .await?;

    if body.get("code").and_then(|v| v.as_i64()) != Some(0)
        || body.pointer("/req/code").and_then(|v| v.as_i64()) != Some(0)
    {
        return Err("TX search: invalid response code".to_string());
    }

    let data = body
        .pointer("/req/data")
        .unwrap_or(&serde_json::Value::Null);
    let mut result = tx_pick_search_raw_list(data)
        .map(tx_handle_result)
        .unwrap_or_default();
    if !result.is_empty() {
        return Ok(result);
    }

    let mobile_request_data = serde_json::json!({
        "comm": {
            "ct": "24", "cv": "4747474", "v": "4747474", "tmeAppID": "qqmusic",
            "format": "json", "inCharset": "utf-8", "outCharset": "utf-8",
            "platform": "yqq.json", "needNewCode": 0,
            "uin": "0", "guid": "0",
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
    let mobile_request_str =
        serde_json::to_string(&mobile_request_data).map_err(|e| e.to_string())?;
    let mobile_sign = zzc_sign(&mobile_request_str);
    let mobile_url = format!("https://u.y.qq.com/cgi-bin/musics.fcg?sign={}", mobile_sign);
    let mobile_body = http_post_json(
        &mobile_url,
        &mobile_request_str,
        &[
            ("User-Agent", "Mozilla/5.0 (Linux; Android 12; EBG-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.141 Mobile Safari/537.36"),
            ("Content-Type", "application/json"),
            ("Referer", "https://y.qq.com/"),
        ],
    )
    .await?;

    if mobile_body.get("code").and_then(|v| v.as_i64()) == Some(0)
        && mobile_body.pointer("/req/code").and_then(|v| v.as_i64()) == Some(0)
    {
        let mobile_data = mobile_body
            .pointer("/req/data")
            .unwrap_or(&serde_json::Value::Null);
        result = tx_pick_search_raw_list(mobile_data)
            .map(tx_handle_result)
            .unwrap_or_default();
    }

    Ok(result)
}

fn chrono_like_random() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let mut val = now.as_millis() as u64;
    val = val.wrapping_mul(1000) + (val % 900);
    val
}
