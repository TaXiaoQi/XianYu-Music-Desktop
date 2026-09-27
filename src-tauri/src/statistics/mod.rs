//! 听歌统计模块。
//!
//! 这一块负责四件事：给曲库做规模 / 音质 / 格式概览，把零散的播放事件
//! 聚合成可查询的统计表，维护"最近播放"这条时间线，以及把统计结果导出成
//! 备份文件或从备份文件里合回来。
//!
//! 按职责切开之后的子模块：
//!
//! * support  —— 时间换算、文本归一化、身份键等无状态工具；
//! * portable —— 可迁移快照用到的数据形状；
//! * matching —— 快照里的歌曲身份与本地曲库之间的三级匹配；
//! * write    —— 聚合表的写入、容量裁剪与全量重建；
//! * read     —— 聚合表的读取；
//! * library  —— 曲库总数、音质分布、格式分布；
//! * behavior —— 听歌行为统计（排行、时段、近七日）；
//! * history  —— 播放历史与最近播放列表；
//! * catalog  —— 收藏 / 最近播放的歌手、专辑、歌单目录视图；
//! * backup   —— 统计备份文件的导出与导入；
//! * cloud    —— 云端时长与快照的合并。

mod backup;
mod behavior;
mod catalog;
mod cloud;
mod history;
mod library;
mod matching;
mod portable;
mod read;
mod support;
mod write;

pub use backup::{export_statistics_file, import_statistics_file, preview_statistics_import};
pub use behavior::{get_behavior_stats, get_listen_durations};
pub use catalog::{
    get_favorite_album_catalog, get_favorite_artist_catalog, get_favorite_song_paths_view,
    get_recent_album_catalog, get_recent_playlist_catalog, get_recent_song_paths_view,
};
pub use cloud::{
    clear_listen_stats, export_listen_snapshot, merge_cloud_listen_duration, merge_listen_snapshot,
};
pub use history::{
    add_to_history, clear_recent_history, get_recent_history, import_recent_history,
    remove_from_recent_history, remove_songs_from_history_and_statistics, reset_local_statistics,
};
pub use library::{get_format_distribution, get_library_stats, get_quality_distribution};
pub use write::record_play;
