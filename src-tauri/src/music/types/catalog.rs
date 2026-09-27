// 歌手 / 专辑目录条目，以及歌手头像写入任务的进度载荷。

use serde::{Deserialize, Serialize};

/// 歌手目录中的一行。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArtistCatalogItem {
    pub id: i64,
    pub name: String,
    pub count: u32,
    pub first_song_path: String,
    pub avatar_path: Option<String>,
}

/// 专辑目录中的一行，key 为稳定专辑标识。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCatalogItem {
    pub key: String,
    pub name: String,
    pub count: u32,
    pub artist: String,
    pub first_song_path: String,
}

/// 保存歌手头像后的回执；批量写标签时附带任务号。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveArtistAvatarResponse {
    pub artist_id: i64,
    pub avatar_path: String,
    pub task_id: Option<String>,
}

/// 头像批量写入标签的后台任务进度（snake_case 事件字段，前端监听）。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteTagsProgressPayload {
    pub task_id: String,
    pub artist_id: i64,
    pub current: usize,
    pub total: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub skipped_count: usize,
    pub skipped_multi_artist: usize,
    pub skipped_remote: usize,
    pub skipped_cue: usize,
    pub skipped_readonly: usize,
    pub skipped_missing: usize,
    pub done: bool,
    pub error: Option<String>,
}
