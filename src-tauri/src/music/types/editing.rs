// 歌词存储与歌曲信息保存相关载荷。

use super::media::{Song, SongDetail};
use serde::{Deserialize, Serialize};

/// 歌词的实际存放位置。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LyricsStorageSource {
    Embedded,
    Sidecar,
    Empty,
}

/// 编辑面板读取到的歌词及其来源。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SongLyricsForEdit {
    pub lyrics: String,
    pub source: LyricsStorageSource,
    pub source_path: Option<String>,
}

/// 保存歌曲信息后的完整回执：更新后的实体与详情。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveSongInfoResponse {
    pub song: Song,
    pub detail: SongDetail,
}
