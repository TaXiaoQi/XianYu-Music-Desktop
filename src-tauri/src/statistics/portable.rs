//! 可迁移统计快照的数据形状。
//!
//! 这里只声明"导出文件长什么样"与"命令收发什么参数"，不包含任何逻辑。
//! 字段名和 serde 改写规则是前端解析 JSON 的契约：改一个字母，前端就会
//! 拿到 undefined。因此结构体名、字段名与 camelCase 配置一律不动；
//! 字段的声明顺序不在契约之内，允许调整。

use serde::{Deserialize, Serialize};

/// 一首歌在统计口径下的身份。标题、歌手、专辑、时长四者共同决定
/// 两条记录是否为同一首歌，轨号只是附带信息。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableSongIdentity { // 单曲身份，导出与匹配共用
    pub title: String,        // 曲目标题
    pub artist: String,       // 歌手名
    pub album: String,        // 专辑名
    pub duration_ms: i64,     // 时长，毫秒
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_number: Option<i64>, // 轨号，未知时省略
}

/// 一首歌累计下来的四个计数，外加首尾播放时间。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableSongStats { // 单曲聚合计数
    pub play_count: i64,       // 播放次数
    pub play_time_ms: i64,     // 累计收听时长
    pub full_play_count: i64,  // 完整播放次数
    pub skip_count: i64,       // 切歌次数
    pub first_played_at: Option<String>, // 首次播放时刻
    pub last_played_at: Option<String>,  // 最近一次播放时刻
}

/// 身份与计数配成一对，构成导出文件里 songs 数组的一项。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableSongStatsEntry { // 身份 + 计数
    pub song_identity: PortableSongIdentity, // 歌曲身份
    pub song_stats: PortableSongStats,       // 聚合计数
}

/// 全局汇总：总次数、总时长与首尾播放时间。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableGlobalStats { // 全局汇总
    pub total_play_count: i64,           // 总播放次数
    pub total_play_time_ms: i64,         // 总收听时长
    pub first_played_at: Option<String>, // 首次播放时刻
    pub last_played_at: Option<String>,  // 最近一次播放时刻
}

/// 单日汇总。unique_* 记录当天出现过的不同歌曲 / 歌手数量。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableDailyStats { // 按天汇总
    pub date: String,        // 日期（本地时区）
    pub play_count: i64,     // 当天播放次数
    pub play_time_ms: i64,   // 当天收听时长
    pub unique_songs: i64,   // 当天不同歌曲数
    pub unique_artists: i64, // 当天不同歌手数
}

/// 按小时切分的汇总，hour 取 0-23。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableHourlyStats { // 按小时汇总
    pub hour: i64,         // 小时（0-23）
    pub play_count: i64,   // 该时段播放次数
    pub play_time_ms: i64, // 该时段收听时长
}

/// 最近播放时间线上的一条记录。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableRecentPlay { // 最近播放条目
    pub played_at: String,  // 播放时刻
    pub title: String,      // 曲目标题
    pub artist: String,     // 歌手名
    pub album: String,      // 专辑名
    pub duration_ms: i64,   // 曲目时长
    pub listened_ms: i64,   // 实际收听时长
    pub is_full_play: bool, // 是否完整播放
    pub is_skip: bool,      // 是否切歌
}

/// 快照正文：全局 + 歌曲 + 每日 + 每小时 + 最近播放。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableStatisticsPayload { // 快照正文
    pub songs: Vec<PortableSongStatsEntry>,    // 歌曲聚合
    pub global: PortableGlobalStats,           // 全局汇总
    pub daily: Vec<PortableDailyStats>,        // 按天汇总
    pub hourly: Vec<PortableHourlyStats>,      // 按小时汇总
    #[serde(default)]
    pub recent_plays: Vec<PortableRecentPlay>, // 最近播放，旧快照可缺省
}

/// 导出文件的信封。format 与 version 用于校验来源，
/// export_id 用于识别重复导入。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PortableStatisticsExport { // 导出文件信封
    pub stats: PortableStatisticsPayload,    // 快照正文
    pub format: String,                      // 格式标识
    pub version: i64,                        // 快照版本号
    pub exported_at: String,                 // 导出时刻
    pub app_version: String,                 // 导出时的应用版本
    pub export_id: String,                   // 本次导出的唯一标识
    pub library_fingerprint: Option<String>, // 曲库指纹，可缺省
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsExportOptions { // 导出命令参数
    pub default_file_name: String,  // 建议的导出文件名
    pub include_recent_plays: bool, // 是否附带最近播放
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsImportPreviewOptions { // 预览命令参数
    pub file_path: String, // 待检查的导出文件路径
}

/// 导入方式：整体覆盖现有统计，或者叠加到现有统计上。
#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum StatisticsImportMode { // 导入策略
    Overwrite, // 清空后整体写入
    Merge,     // 在现有数据上累加
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsImportOptions { // 导入命令参数
    pub file_path: String,               // 导出文件路径
    pub mode: StatisticsImportMode,      // 导入方式
    pub continue_duplicate_import: bool, // 重复导入时是否继续
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsExportResult { // 导出命令回执
    pub file_path: String,   // 实际写出的文件路径
    pub export_id: String,   // 本次导出标识
    pub exported_at: String, // 导出时刻
}

/// 导入前的预览：让前端先弹一个"会覆盖多少条"的确认框。
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsImportPreview { // 导入预览
    pub version: i64,                    // 快照版本号
    pub exported_at: String,             // 导出时刻
    pub app_version: String,             // 应用版本
    pub export_id: String,               // 导出标识
    pub song_stats_count: usize,         // 快照内歌曲条数
    pub daily_stats_count: usize,        // 快照内每日条数
    pub recent_plays_count: usize,       // 快照内最近播放条数
    pub matched_song_count: usize,       // 能在本地曲库匹配上的歌曲数
    pub unmatched_song_count: usize,     // 匹配不上的歌曲数
    pub duplicate_import_detected: bool, // 是否检测到重复导入
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsImportResult { // 导入命令回执
    pub mode: String,                       // 实际执行的导入方式
    pub matched_song_count: usize,          // 匹配上的歌曲数
    pub unmatched_song_count: usize,        // 匹配不上的歌曲数
    pub merged_song_count: usize,           // 实际写入的歌曲数
    pub imported_recent_plays_count: usize, // 写入的最近播放条数
    pub duplicate_import_skipped: bool,     // 是否因重复导入被跳过
}

/// 前端上报一次收听时带的载荷。
///
/// count_as_play 区分"真的播放了一次"和"只是定时刷新的时长增量"：
/// 后者只累加时长，不增加播放次数，也不进最近播放列表。
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecordPlayPayload { // 上报收听的载荷
    pub song_path: String,            // 曲目路径
    pub listened_ms: i64,             // 本次收听时长
    pub duration_ms: i64,             // 曲目总时长
    pub title: String,                // 标题
    pub artist: String,               // 歌手
    pub album: String,                // 专辑
    pub track_number: Option<String>, // 轨号，字符串形式
    pub count_as_play: Option<bool>,  // 是否计一次播放
}
