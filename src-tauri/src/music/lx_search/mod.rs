mod api;
mod cache;
mod common;
mod kg;
mod kw;
mod mg;
mod sign;
mod tx;
mod wy;

pub use api::lx_search;
pub use common::{LxSearchItem, LxTypeTuple};

#[cfg(test)]
use cache::make_search_cache_key;
#[cfg(test)]
use common::{decode_name, format_play_time, format_singer_name, size_formate};
#[cfg(test)]
use kg::build_kugou_cover_url;
#[cfg(test)]
use kw::build_kuwo_cover_url;
#[cfg(test)]
use mg::mg_filter_data;
#[cfg(test)]
use sign::{pick_hash_by_idx, sha1_hex};
#[cfg(test)]
use tx::tx_handle_result;

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
        assert_eq!(
            sha1_hex("hello"),
            "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
        );
    }

    #[test]
    fn test_sha1_hex_empty_string() {
        assert_eq!(sha1_hex(""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    }

    #[test]
    fn test_sha1_hex_unicode() {
        let hash = sha1_hex("周杰伦");
        assert_eq!(hash.len(), 40);
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

        assert_eq!(v["types"][0]["type"], "320k");
        assert_eq!(v["types"][0]["size"], "10.5MB");
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

        let types: Vec<&str> = it.types.iter().map(|t| t.quality_type.as_str()).collect();
        assert_eq!(types, vec!["128k", "320k", "flac"]);
    }

    #[test]
    fn test_tx_handle_result_skips_item_without_songmid() {
        let raw = serde_json::json!([
            { "title": "无标识", "file": {} },
            { "title": "有料", "mid": "003", "file": { "media_mid": "M001" } },
            { "title": "仅id", "id": 42 }
        ]);
        let list = tx_handle_result(&raw);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "有料");
        assert_eq!(list[0].songmid, "003");
        assert_eq!(list[0].str_media_mid.as_deref(), Some("M001"));
        assert_eq!(list[1].name, "仅id");
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
