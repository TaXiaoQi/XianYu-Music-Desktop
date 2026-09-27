// 曲库核心实体：歌曲条目（完整版 / 库缓存版）与文件详情摘要。

use serde::{Deserialize, Serialize};

/// 扫描与播放链路使用的完整歌曲实体。
/// 字段名参与 serde 序列化契约，不可调整。
#[derive(Serialize, Clone, Debug)]
pub struct Song {
    pub id: Option<i64>,
    pub name: String,
    pub title: String,
    pub path: String,
    pub artist: String,
    pub artist_names: Vec<String>,
    pub effective_artist_names: Vec<String>,
    pub album: String,
    pub album_artist: String,
    pub album_key: String,
    pub is_various_artists_album: bool,
    pub collapse_artist_credits: bool,
    pub duration: u32,
    pub cover_thumb_path: Option<String>,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub bit_depth: Option<u8>,
    pub format: String,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub file_size: u64,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub added_at: Option<u64>,
    pub file_modified_at: Option<u64>,
    pub cue_source_path: Option<String>,
    pub cue_start_offset: Option<u32>,
    pub cue_end_offset: Option<u32>,
    pub comment: Option<String>,
    /// 内嵌歌手头像原图字节，仅在扫描中转，不落库、不序列化。
    #[serde(skip)]
    pub artist_avatar_bytes: Option<Vec<u8>>,
    /// 头像落盘后的缓存路径，入库时写入 artists 表。
    #[serde(skip)]
    pub artist_avatar_path: Option<String>,
}

/// 库缓存视图下的歌曲条目（无头像中转字段，多远程音源标记）。
#[derive(Serialize, Clone, Debug)]
pub struct LibrarySong {
    pub id: Option<i64>,
    pub name: String,
    pub title: String,
    pub path: String,
    pub artist: String,
    pub artist_names: Vec<String>,
    pub effective_artist_names: Vec<String>,
    pub album: String,
    pub album_artist: String,
    pub album_key: String,
    pub is_various_artists_album: bool,
    pub collapse_artist_credits: bool,
    pub duration: u32,
    pub cover_thumb_path: Option<String>,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub bit_depth: Option<u8>,
    pub format: String,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub added_at: Option<u64>,
    pub file_modified_at: Option<u64>,
    pub source_type: String,
    pub remote_source_id: Option<String>,
    pub cue_source_path: Option<String>,
    pub cue_start_offset: Option<u32>,
    pub cue_end_offset: Option<u32>,
    pub comment: Option<String>,
}

/// 文件详情面板展示的扩展元数据（流派/年份/轨号等）。
#[derive(Serialize, Clone, Debug, Default)]
pub struct SongDetail {
    pub path: String,
    pub genre: Option<String>,
    pub year: Option<String>,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub comment: Option<String>,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub file_size: Option<u64>,
}

/// 前端提交的歌曲信息编辑载荷。
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SongInfoEditPayload {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub year: Option<String>,
    pub cover_path: Option<String>,
}
