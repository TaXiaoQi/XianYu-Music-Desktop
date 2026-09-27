// 源文本清洗、时间戳解析、元信息标签读取与歌词偏移。

use super::model::{ExplicitLineRole, LyricsMeta, ParsedLine};

/// 时间戳上限（约 1000 分钟），超出按回退值处理。
const MS_CEILING: u64 = 60_039_999;

/// 去掉零宽空格并规整首尾；形如注释的斜杠包裹也一并剥除。
pub(super) fn tidy_line(text: &str) -> String {
    let stripped = text.replace('\u{200b}', "").trim().to_string();
    if stripped.starts_with("//") {
        let unslashed = stripped.trim_start_matches('/').trim().to_string();
        if unslashed.ends_with("//") {
            unslashed.trim_end_matches('/').trim().to_string()
        } else {
            unslashed
        }
    } else if stripped.ends_with("//") {
        stripped.trim_end_matches('/').trim().to_string()
    } else {
        stripped
    }
}

/// 词级文本只清零宽连接符，保留原始空格。
pub(super) fn tidy_word(text: &str) -> String {
    text.replace(['\u{200b}', '\u{2063}'], "")
}

/// 毫秒值安全收紧：超出上限（或 u32 放不下）时退回调用方给定的兜底值。
pub(super) fn ms_capped(value: u64, fallback: u32) -> u32 {
    value
        .try_into()
        .ok()
        .filter(|v| u64::from(*v) <= MS_CEILING)
        .unwrap_or(fallback)
}

/// 解析 `分:秒.毫秒` 形式的 LRC 时间戳；秒 >= 60 视为非法。
pub(super) fn lrc_clock_ms(raw: &str) -> Option<u32> {
    let trimmed = raw.trim();
    let mut sections = trimmed.split(':');
    let minutes: u32 = sections.next()?.parse().ok()?;
    let seconds_section = sections.next()?;
    if sections.next().is_some() {
        return None;
    }

    let mut halves = seconds_section.split('.');
    let seconds: u32 = halves.next()?.parse().ok()?;
    if seconds >= 60 {
        return None;
    }

    let millis = halves
        .next()
        .map(|fraction| {
            let mut digits = fraction.to_string();
            while digits.len() < 3 {
                digits.push('0');
            }
            digits.chars().take(3).collect::<String>().parse::<u32>().ok()
        })
        .flatten()
        .unwrap_or(0);

    Some(minutes * 60_000 + seconds * 1_000 + millis)
}

/// TTML 时钟值：支持毫秒后缀、秒后缀与 `分:秒` 形式。
pub(super) fn ttml_clock_ms(raw: &str) -> Option<u32> {
    if let Some(millis) = raw.strip_suffix("ms") {
        return millis.trim().parse::<u32>().ok();
    }
    if let Some(seconds) = raw.strip_suffix('s') {
        let parsed: f64 = seconds.trim().parse().ok()?;
        return Some((parsed * 1000.0).round().max(0.0) as u32);
    }
    if raw.contains(':') {
        return lrc_clock_ms(raw);
    }
    None
}

/// 扫描文本里所有成对的 `open..close` 时间戳标记，返回（起点、终点、毫秒）。
pub(super) fn scan_timestamp_marks(text: &str, open: char, close: char) -> Vec<(usize, usize, u32)> {
    let mut marks = Vec::new();
    let mut cursor = 0usize;

    while cursor < text.len() {
        let Some(lead) = text[cursor..].chars().next() else {
            break;
        };
        if lead == open {
            let after_open = cursor + open.len_utf8();
            if let Some(offset) = text[after_open..].find(close) {
                let inner_end = after_open + offset;
                if let Some(ms) = lrc_clock_ms(&text[after_open..inner_end]) {
                    let total_end = inner_end + close.len_utf8();
                    marks.push((cursor, total_end, ms));
                    cursor = total_end;
                    continue;
                }
            }
        }
        cursor += lead.len_utf8();
    }

    marks
}

/// 尝试从字符串头吞下一个 `[时间戳]` 块。
fn take_stamp_block(rest: &str) -> Option<(usize, String)> {
    if !rest.starts_with('[') {
        return None;
    }
    let close = rest.find(']')?;
    let block = rest[..=close].to_string();
    lrc_clock_ms(&rest[1..close])?;
    Some((close + 1, block))
}

/// ESLRC 行内可能连续携带多个 `[时间戳]`：在正文开始前把它们用隐形分隔符串起来，
/// 供 amll 的 eslrc 解析器拆成多行。
pub(super) fn expand_multi_stamp_lines(source: &str) -> String {
    source
        .lines()
        .map(|line| {
            let mut rebuilt = String::with_capacity(line.len());
            let mut cursor = 0usize;

            while cursor < line.len() {
                let rest = &line[cursor..];
                if rest.starts_with('[') {
                    let mut blocks: Vec<String> = Vec::new();
                    let mut probe = cursor;
                    while let Some((consumed, block)) = take_stamp_block(&line[probe..]) {
                        blocks.push(block);
                        probe += consumed;
                    }

                    if blocks.len() > 1 {
                        let follows = line[probe..].chars().next();
                        if matches!(follows, Some(ch) if ch != '[' && ch != ']') {
                            for (slot, block) in blocks.iter().enumerate() {
                                rebuilt.push_str(block);
                                if slot + 1 != blocks.len() {
                                    rebuilt.push('\u{2063}');
                                }
                            }
                            cursor = probe;
                            continue;
                        }
                    }
                }

                match rest.chars().next() {
                    Some(ch) => {
                        rebuilt.push(ch);
                        cursor += ch.len_utf8();
                    }
                    None => break,
                }
            }

            rebuilt
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 识别行首显式标注的角色前缀（翻译 / 罗马音），返回角色与剥掉前缀后的正文。
pub(super) fn split_role_prefix(text: &str) -> (Option<ExplicitLineRole>, String) {
    let trimmed = tidy_line(text);
    if trimmed.is_empty() {
        return (None, trimmed);
    }

    const TRANSLATION_HEADS: [&str; 9] = [
        "[tr]",
        "[trans]",
        "[translation]",
        "翻译:",
        "翻译：",
        "译文:",
        "译文：",
        "【翻译】",
        "【译文】",
    ];
    let lowered = trimmed.to_lowercase();
    for head in TRANSLATION_HEADS {
        if lowered.starts_with(&head.to_lowercase()) {
            return (Some(ExplicitLineRole::Translation), tidy_line(&trimmed[head.len()..]));
        }
    }

    const ROMAN_HEADS: [&str; 12] = [
        "[roma]",
        "[romaji]",
        "[roman]",
        "罗马音:",
        "罗马音：",
        "罗马字:",
        "罗马字：",
        "音译:",
        "音译：",
        "【罗马音】",
        "【罗马字】",
        "【音译】",
    ];
    for head in ROMAN_HEADS {
        if lowered.starts_with(&head.to_lowercase()) {
            return (Some(ExplicitLineRole::Roman), tidy_line(&trimmed[head.len()..]));
        }
    }

    (None, trimmed)
}

/// 读取 `[ti:][ar:][al:][by:][re:][ve:][offset:]` 等头部标签。
pub(super) fn read_meta_tags(raw: &str) -> LyricsMeta {
    let mut meta = LyricsMeta::default();
    for line in raw.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('[') {
            continue;
        }
        let Some(close) = trimmed.find(']') else {
            continue;
        };
        let tag = &trimmed[1..close];
        let value = trimmed[close + 1..].trim();
        let lowered = tag.to_ascii_lowercase();

        if let Some(rest) = lowered.strip_prefix("offset:") {
            if let Ok(ms) = rest.trim().parse::<i64>() {
                meta.offset_ms = ms;
            }
        } else if let Some(rest) = lowered.strip_prefix("ti:") {
            if !rest.trim().is_empty() {
                meta.title = Some(value.to_string());
            }
        } else if let Some(rest) = lowered.strip_prefix("ar:") {
            if !rest.trim().is_empty() {
                meta.artist = Some(value.to_string());
            }
        } else if let Some(rest) = lowered.strip_prefix("al:") {
            if !rest.trim().is_empty() {
                meta.album = Some(value.to_string());
            }
        } else if let Some(rest) = lowered.strip_prefix("by:") {
            if !rest.trim().is_empty() {
                meta.by = Some(value.to_string());
            }
        } else if let Some(rest) = lowered.strip_prefix("re:") {
            if !rest.trim().is_empty() {
                meta.re = Some(value.to_string());
            }
        } else if let Some(rest) = lowered.strip_prefix("ve:") {
            if !rest.trim().is_empty() {
                meta.ve = Some(value.to_string());
            }
        }
    }
    meta
}

/// 按元信息里的 offset 整体平移（负值向 early 方向），统一钳到非负。
pub(super) fn shift_for_offset(rows: &mut [ParsedLine], offset_ms: i64) {
    if offset_ms == 0 {
        return;
    }
    let shift = |ms: u32| -> u32 { (ms as i64 + offset_ms).max(0) as u32 };
    for row in rows.iter_mut() {
        row.start_ms = shift(row.start_ms);
        row.end_ms = shift(row.end_ms);
        if let Some(words) = &mut row.words {
            for word in words.iter_mut() {
                word.start_ms = shift(word.start_ms);
                word.end_ms = shift(word.end_ms);
            }
        }
    }
}

/// 解析前的源文本规范化：
/// 去 BOM、统一换行、解码 HTML 实体、展开字面 `\n`、过滤注释行
/// （`//` 开头、非十六进制色值的 `#` 行、`;` 行；含 `[` 的行不当作注释）。
pub(super) fn normalize_source(raw: &str) -> String {
    let mut text = raw
        .replace('\u{FEFF}', "")
        .replace("\r\n", "\n")
        .replace('\r', "\n");

    text = super::super::lyric_fetcher::decode_html_entities(&text);
    text = text.replace("\\n", "\n");

    let mut kept = String::with_capacity(text.len());
    for line in text.split('\n') {
        let head = line.trim_start();
        let hex_color = head.strip_prefix('#').is_some_and(|rest| {
            (rest.len() == 3 || rest.len() == 6) && rest.chars().all(|c| c.is_ascii_hexdigit())
        });
        let is_comment = head.starts_with("//")
            || (head.starts_with('#') && !hex_color && !head.contains('['))
            || (head.starts_with(';') && !head.contains('['));
        if is_comment {
            continue;
        }
        kept.push_str(line);
        kept.push('\n');
    }
    kept
}
