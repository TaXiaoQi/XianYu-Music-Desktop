// 文件夹树视图节点与扫描分组结果。

use super::media::Song;
use serde::Serialize;

/// 文件夹视图（folder_as_playlists）里的一个分组。
#[derive(Serialize)]
pub struct GeneratedFolder {
    pub name: String,
    pub path: String,
    pub songs: Vec<Song>,
}

/// 曲库目录树节点；子级可延迟加载。
#[derive(Serialize, Clone, Debug)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub child_count: usize,
    pub children_loaded: bool,
    pub song_count: usize,
    pub cover_song_path: Option<String>,
    pub is_expanded: bool,
}

/// 已登记的曲库根目录及其歌曲计数。
#[derive(Serialize)]
pub struct LibraryFolder {
    pub path: String,
    pub song_count: usize,
}
