use super::common::{format_play_time, http_get_json};
use super::{LxSearchItem, LxTypeTuple};
use crate::music::url_resolver::LxTypeEntry;
use std::collections::HashMap;

pub(super) async fn search_wy(keyword: &str, limit: u32) -> Result<Vec<LxSearchItem>, String> {
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

        let push_quality = |types: &mut Vec<LxTypeTuple>,
                            lx_types: &mut HashMap<String, LxTypeEntry>,
                            quality: &str| {
            types.push(LxTypeTuple {
                quality_type: quality.into(),
                size: None,
                hash: None,
            });
            lx_types.insert(
                quality.to_string(),
                LxTypeEntry {
                    size: None,
                    hash: None,
                },
            );
        };
        for quality in ["128k", "320k", "flac", "flac24bit", "master"] {
            push_quality(&mut types, &mut lx_types, quality);
        }

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
