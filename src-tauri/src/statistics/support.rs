//! 统计模块的公共底座。
//!
//! 这里只收容与数据库表结构、与具体命令都解耦的纯函数：时钟读取、
//! 名字归一化、身份键拼装、行读取的小包装，以及完整播放 / 切歌的判定。
//! 聚合写入、快照匹配、备份合入等多处都要用，所以独立成层，避免互相牵扯。

use std::fmt::Display;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use super::portable::{PortableRecentPlay, PortableSongIdentity};

/// 迁移快照的格式版本。读到更高版本的备份文件时直接拒收，
/// 免得把不认识的字段按旧语义解释进去。升级时需同步调整校验逻辑。
pub(crate) const STATS_SCHEMA_VERSION: i64 = 1;

/// 最近播放表的容量上限；每次写入之后都会把更早的记录挤出去。
pub(crate) const RECENT_PLAY_CAP: i64 = 300;

/// 统计口径下的「未知」占位名集合。比对前先 trim 再转小写；
/// 这些值多来自缺失的标签，放任它们参与汇分会把排行搅乱。
const PLACEHOLDER_NAME_SET: [&str; 7] = [
    "",
    "未知",
    "未知歌手",
    "未知专辑",
    "unknown",
    "unknown artist",
    "unknown album",
];

/// 名字是否为空白，或各语言下的「未知」占位串。
pub(crate) fn is_meaningless_name(name: &str) -> bool {
    let normalized = name.trim().to_lowercase();
    PLACEHOLDER_NAME_SET.contains(&normalized.as_str())
}

/// Hi-Res 判定门槛：位深至少 24bit 且采样率至少 48kHz，位深缺失按 0 计。
pub(crate) fn qualifies_as_hires(bit_depth: Option<i64>, sample_rate: i64) -> bool {
    bit_depth.map_or(false, |depth| depth >= 24) && sample_rate >= 48_000
}

/// 距 Unix 纪元流逝的时长；系统时钟异常时按 0 处理，不让上层跟着崩。
fn elapsed_since_epoch() -> Duration {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
}

/// 当前时刻的 Unix 秒。
pub(crate) fn current_unix_secs() -> i64 {
    elapsed_since_epoch().as_secs() as i64
}

/// 当前时刻的 Unix 毫秒，用在拼导出编号这类需要更细粒度的场合。
pub(crate) fn current_unix_millis() -> i128 {
    elapsed_since_epoch().as_millis() as i128
}

/// 把任意可显示的错误摊平成字符串，统一供各处 map_err 复用。
pub(crate) fn error_text<E: Display>(err: E) -> String {
    err.to_string()
}

fn render_rfc3339(moment: OffsetDateTime) -> Result<String, String> {
    moment.format(&Rfc3339).map_err(error_text)
}

/// 当前 UTC 时间的 RFC3339 文本，用作导出时间与导入日志时间。
pub(crate) fn utc_now_rfc3339() -> Result<String, String> {
    render_rfc3339(OffsetDateTime::now_utc())
}

/// Unix 秒转 RFC3339 文本；越界的时间戳返回错误，而不是静默截断。
pub(crate) fn rfc3339_from_unix_secs(timestamp: i64) -> Result<String, String> {
    let moment = OffsetDateTime::from_unix_timestamp(timestamp).map_err(error_text)?;
    render_rfc3339(moment)
}

/// 名字归一化：把连续空白压成单个空格并整体转小写，供身份键比对使用。
pub(crate) fn collapse_identity_text(value: &str) -> String {
    let mut flattened = String::with_capacity(value.len());
    let mut emitted = false;
    for word in value.split_whitespace() {
        if emitted {
            flattened.push(' ');
        }
        emitted = true;
        flattened.push_str(&word.to_lowercase());
    }
    flattened
}

/// 轨号在标签里可能是 "03/12" 这类写法：取斜杠前的首段，
/// 再只吃掉开头的数字，吃不出数字就当作没有轨号。
pub(crate) fn track_number_from_raw(value: Option<&str>) -> Option<i64> {
    let raw = value?;
    let head = raw.split(['/', '\\']).next()?;

    let mut digits = String::new();
    for ch in head.chars() {
        if !ch.is_ascii_digit() {
            break;
        }
        digits.push(ch);
    }

    if digits.is_empty() {
        return None;
    }
    match digits.parse::<i64>() {
        Ok(number) => Some(number),
        Err(_) => None,
    }
}

/// 一级身份键：标题 + 歌手 + 专辑 + 时长，全部走归一化。
pub(crate) fn full_match_key(identity: &PortableSongIdentity) -> String {
    [
        collapse_identity_text(&identity.title),
        collapse_identity_text(&identity.artist),
        collapse_identity_text(&identity.album),
        identity.duration_ms.max(0).to_string(),
    ]
    .join("|")
}

/// 二级身份键：丢掉专辑，只剩标题 + 歌手 + 时长。
pub(crate) fn title_artist_match_key(identity: &PortableSongIdentity) -> String {
    [
        collapse_identity_text(&identity.title),
        collapse_identity_text(&identity.artist),
        identity.duration_ms.max(0).to_string(),
    ]
    .join("|")
}

/// 三级身份键：只剩标题 + 时长，作为同名曲的兜底。
pub(crate) fn title_only_match_key(identity: &PortableSongIdentity) -> String {
    [collapse_identity_text(&identity.title), identity.duration_ms.max(0).to_string()].join("|")
}

/// 最近播放的去重键：播放时刻 + 标题 + 歌手 + 时长。
pub(crate) fn recent_entry_dedupe_key(entry: &PortableRecentPlay) -> String {
    [
        entry.played_at.clone(),
        collapse_identity_text(&entry.title),
        collapse_identity_text(&entry.artist),
        entry.duration_ms.max(0).to_string(),
    ]
    .join("|")
}

/// 组装一条用于统计的歌曲身份。标题缺失时先退回文件名主干，
/// 连文件名都拿不到才落回 "Unknown"。
pub(crate) fn build_song_identity(title: &str, artist: &str, album: &str, duration_ms: i64, track_number: Option<i64>, fallback_path: Option<&str>) -> PortableSongIdentity {
    let trimmed_title = title.trim();
    let non_negative_span = duration_ms.max(0);
    let resolved_title = if trimmed_title.is_empty() {
        fallback_path
            .and_then(|raw_path| Path::new(raw_path).file_stem())
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_else(|| String::from("Unknown"))
    } else {
        trimmed_title.to_string()
    };

    PortableSongIdentity {
        title: resolved_title,
        artist: artist.trim().to_owned(),
        album: album.trim().to_owned(),
        duration_ms: non_negative_span,
        track_number,
    }
}

/// 判定一次收听算「完整播放」还是「切歌」。
///
/// 完整播放：听到至少九成时长，或者距离结尾不足 5 秒（后者照顾
/// 结尾几秒本来就没内容的音轨）。切歌：没听完，而且连一半都没到；
/// 「一半」再压一个 30 秒的上限，避免长音频被整段误判成切歌。
pub(crate) fn classify_playback(listened_ms: i64, duration_ms: i64) -> (bool, bool) {
    if listened_ms <= 0 || duration_ms <= 0 {
        return (false, false);
    }

    let span = duration_ms as f64;
    let finish_floor = ((span * 0.9).round() as i64).max(duration_ms - 5_000);
    let skip_ceiling = ((span * 0.5).round() as i64).min(30_000);

    if listened_ms >= finish_floor {
        (true, false)
    } else {
        (false, listened_ms < skip_ceiling)
    }
}

/// 读一个文本列。列值为 NULL 时按空串处理，调用方不用再判一次。
pub(crate) fn text_cell(row: &rusqlite::Row, index: usize) -> rusqlite::Result<String> {
    let cell = row.get::<_, Option<String>>(index)?;
    Ok(cell.unwrap_or_default())
}

/// 读一个可空的文本列。取不出来或本身就是 NULL 都算 None。
pub(crate) fn maybe_text(row: &rusqlite::Row, index: usize) -> Option<String> {
    match row.get::<_, Option<String>>(index) {
        Ok(cell) => cell,
        Err(_) => None,
    }
}

/// 读一个可空的整数列。取不出来或本身就是 NULL 都算 None。
pub(crate) fn maybe_int(row: &rusqlite::Row, index: usize) -> Option<i64> {
    match row.get::<_, Option<i64>>(index) {
        Ok(cell) => cell,
        Err(_) => None,
    }
}

/// 读一个文本列但容忍失败：出错时给空串，不把错误往上抛。
/// 用在「少一列也不影响统计结论」的扫描型查询里。
pub(crate) fn loose_text(row: &rusqlite::Row, index: usize) -> String {
    match row.get::<_, String>(index) {
        Ok(value) => value,
        Err(_) => String::new(),
    }
}

/// 读一个整数列。取不出来（NULL 或类型不符）时退化为 0。
pub(crate) fn int_cell(row: &rusqlite::Row, index: usize) -> rusqlite::Result<i64> {
    Ok(row.get::<_, i64>(index).unwrap_or(0))
}

/// Unix 秒换算成本地日历日（YYYY-MM-DD）。时区交给 SQLite 处理，
/// 免得 Rust 侧再引一套时区表。
pub(crate) fn local_calendar_date(conn: &rusqlite::Connection, played_at: i64) -> Result<String, String> {
    let fetched = conn.query_row(
        "SELECT strftime('%Y-%m-%d', ?1, 'unixepoch', 'localtime')",
        [played_at],
        |record| record.get(0),
    );
    fetched.map_err(error_text)
}

/// Unix 秒换算成本地小时（0-23），时区同样交给 SQLite。
pub(crate) fn local_clock_hour(conn: &rusqlite::Connection, played_at: i64) -> Result<i64, String> {
    let probed = conn.query_row(
        "SELECT CAST(strftime('%H', ?1, 'unixepoch', 'localtime') AS INTEGER)",
        [played_at],
        |record| record.get(0),
    );
    probed.map_err(error_text)
}
