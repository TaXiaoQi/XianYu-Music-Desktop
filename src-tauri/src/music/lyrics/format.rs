// 各类歌词文本格式的行级解析，以及"多格式尝试 → 择优"的入口流程。
// 覆盖：LRC / A2 逐字 LRC / 行内方括号与圆括号逐字 / 网易逐字 JSON /
// Lyricify Quick Export / TTML / QRC（明文与十六进制密文）/ YRC / LYS / ESLRC，
// 兜底为纯文本合成。

use super::native_parse::{
    decrypt_qrc_hex, parse_eslrc, parse_lys, parse_qrc, parse_yrc, NativeLine as SourceLine,
};
use regex::Regex;
use std::cmp::Ordering;
use std::sync::LazyLock;

use super::model::{source_index_order, FormatCandidate, ParsedLine, ParsedLineSourceFormat as LineFormat, ParsedWord};
use super::text::{
    expand_multi_stamp_lines, ms_capped, normalize_source, read_meta_tags, scan_timestamp_marks,
    shift_for_offset, split_role_prefix, tidy_line, tidy_word, ttml_clock_ms,
};
use super::vocal::mark_vocals;

/// A2 行尾无闭合时间戳时，尾词默认时长。
pub(super) const A2_TAIL_WORD_SPAN_MS: u32 = 400;

const HEX_DECRYPT_MIN_LEN: usize = 64;
const QRC_XML_CLOSER: &str = "</QrcInfos>";
const TRANSLATION_MATCH_WINDOW_MS: i64 = 2000;
const BLANK_ROW_INTERLUDE_MS: u32 = 4000;

struct FormatPatterns {
    xml_tag: Regex,
    ttml_paragraph: Regex,
    ttml_begin: Regex,
    ttml_end: Regex,
    ttml_span: Regex,
    ttml_role: Regex,
    paren_word: Regex,
}

static FORMAT_RE: LazyLock<FormatPatterns> = LazyLock::new(|| FormatPatterns {
    xml_tag: Regex::new(r"(?s)<[^>]+>").unwrap(),
    ttml_paragraph: Regex::new(r#"(?s)<p\b([^>]*)>(.*?)</p>"#).unwrap(),
    ttml_begin: Regex::new(r#"(?i)\bbegin="([^"]+)""#).unwrap(),
    ttml_end: Regex::new(r#"(?i)\bend="([^"]+)""#).unwrap(),
    ttml_span: Regex::new(r#"(?s)<span\b([^>]*)>(.*?)</span>"#).unwrap(),
    ttml_role: Regex::new(r#"(?i)\bttm:role="([^"]+)""#).unwrap(),
    paren_word: Regex::new(r"([^()]*)\((\d+),(\d+)(?:,\d+)?\)").unwrap(),
});

// ---------- 内部逐字解析结果的适配 ----------

/// 把逐字解析器的行折算成内部 ParsedLine（含逐字词、角色前缀、纯分隔行剔除）。
fn adapt_source_line(
    line: &SourceLine,
    format: LineFormat,
    order: usize,
) -> Option<ParsedLine> {
    let head_ms = ms_capped(line.start_time, 0);
    let tail_ms = ms_capped(
        line.end_time,
        head_ms.saturating_add(500).max(head_ms + 80),
    )
    .max(head_ms);

    let mut words: Vec<ParsedWord> = line
        .words
        .iter()
        .filter_map(|word| {
            let text = tidy_word(word.word.as_str());
            if text.is_empty() {
                return None;
            }
            let start_ms = ms_capped(word.start_time, head_ms);
            let end_ms = ms_capped(word.end_time, tail_ms).max(start_ms);
            Some(ParsedWord {
                text,
                start_ms,
                end_ms,
                roman_text: None,
            })
        })
        .collect();
    words.sort_by(|left, right| left.start_ms.cmp(&right.start_ms));

    let raw_text = if !line.words.is_empty() {
        tidy_line(
            &line
                .words
                .iter()
                .map(|word| word.word.as_str())
                .collect::<String>(),
        )
    } else {
        tidy_line(&words.iter().map(|word| word.text.clone()).collect::<String>())
    };
    let (role, text) = split_role_prefix(&raw_text);
    let translated_text = tidy_line(line.translated_lyric.as_str());
    let roman_text = tidy_line(line.roman_lyric.as_str());

    if text.is_empty() && translated_text.is_empty() && roman_text.is_empty() && words.is_empty() {
        return None;
    }
    // 纯分隔行（///、--- 之类）没有信息量，直接丢弃。
    let divider_only = text
        .chars()
        .all(|c| c == '/' || c == '\\' || c == '_' || c == '-' || c == '—' || c == '–' || c.is_whitespace());
    if divider_only && translated_text.is_empty() && roman_text.is_empty() {
        return None;
    }

    let first_word_start = words.first().map(|word| word.start_ms).unwrap_or(head_ms);
    let last_word_end = words.last().map(|word| word.end_ms).unwrap_or(tail_ms);

    Some(ParsedLine {
        start_ms: ms_capped(line.start_time, first_word_start),
        end_ms: ms_capped(line.end_time, last_word_end)
            .max(first_word_start)
            .max(last_word_end),
        text,
        words: if words.is_empty() { None } else { Some(words) },
        translated_text: if translated_text.is_empty() { None } else { Some(translated_text) },
        roman_text: if roman_text.is_empty() { None } else { Some(roman_text) },
        source_format: format,
        source_index: order as f64,
        explicit_role: role,
        speaker: None,
        is_bg: false,
        is_duet: false,
        is_duet_partner: false,
    })
}

fn source_rows(
    parsed: &[SourceLine],
    format: LineFormat,
) -> Vec<ParsedLine> {
    parsed
        .iter()
        .enumerate()
        .filter_map(|(order, line)| adapt_source_line(line, format.clone(), order))
        .collect()
}

// ---------- 行内逐字变体 ----------

/// `[t1]词[t2]词[t3]`：相邻时间戳之间的文本构成一个词。
fn line_from_square_word_marks(line: &str, order: usize) -> Option<ParsedLine> {
    let marks = scan_timestamp_marks(line, '[', ']');
    if marks.len() < 2 {
        return None;
    }

    let mut words = Vec::new();
    for pair in marks.windows(2) {
        let (_, seg_start_pos, seg_start_ms) = pair[0];
        let (seg_end_pos, _, seg_next_ms) = pair[1];
        let chunk = tidy_word(&line[seg_start_pos..seg_end_pos]);
        if chunk.is_empty() {
            continue;
        }
        words.push(ParsedWord {
            text: chunk,
            start_ms: seg_start_ms,
            end_ms: seg_next_ms.max(seg_start_ms),
            roman_text: None,
        });
    }
    if words.is_empty() {
        return None;
    }

    let joined = tidy_line(&words.iter().map(|w| w.text.clone()).collect::<String>());
    if joined.is_empty() {
        return None;
    }
    let (role, text) = split_role_prefix(&joined);
    let head_start = words.first()?.start_ms;
    let tail_ms = marks.last().map(|mark| mark.2).unwrap_or(head_start);

    Some(ParsedLine {
        start_ms: head_start,
        end_ms: tail_ms.max(head_start),
        text,
        words: Some(words),
        translated_text: None,
        roman_text: None,
        source_format: LineFormat::Eslrc,
        source_index: order as f64,
        explicit_role: role,
        speaker: None,
        is_bg: false,
        is_duet: false,
        is_duet_partner: false,
    })
}

/// `[t]词(s,d)词(s,d)`：圆括号内为相对行首的相对起点与时长。
fn line_from_paren_word_marks(line: &str, order: usize) -> Option<ParsedLine> {
    let marks = scan_timestamp_marks(line, '[', ']');
    let (body_from, line_start) = match marks.first() {
        Some((_, from, ms)) => (*from, *ms),
        None => return None,
    };
    let body = &line[body_from..];
    if !body.contains('(') || !body.contains(')') {
        return None;
    }

    let mut words = Vec::new();
    for caps in FORMAT_RE.paren_word.captures_iter(body) {
        let chunk = tidy_word(&caps[1]);
        if chunk.is_empty() {
            continue;
        }
        let relative_start: u32 = caps[2].parse().unwrap_or(0);
        let duration: u32 = caps[3].parse().unwrap_or(0);
        let start_ms = line_start.saturating_add(relative_start);
        words.push(ParsedWord {
            text: chunk,
            start_ms,
            end_ms: start_ms.saturating_add(duration),
            roman_text: None,
        });
    }
    if words.is_empty() {
        return None;
    }

    let joined = tidy_line(&words.iter().map(|w| w.text.clone()).collect::<String>());
    if joined.is_empty() {
        return None;
    }
    let (role, text) = split_role_prefix(&joined);
    let head_start = words.first()?.start_ms;
    let tail_ms = words.last().map(|w| w.end_ms).unwrap_or(head_start);

    Some(ParsedLine {
        start_ms: head_start,
        end_ms: tail_ms.max(head_start),
        text,
        words: Some(words),
        translated_text: None,
        roman_text: None,
        source_format: LineFormat::Eslrc,
        source_index: order as f64,
        explicit_role: role,
        speaker: None,
        is_bg: false,
        is_duet: false,
        is_duet_partner: false,
    })
}

/// A2 词级时间戳偏小（<=10ms，或整体明显落在行首之前）时按相对行首处理。
fn needs_anchor_shift(line_start_ms: u32, word_times: &[u32]) -> bool {
    if line_start_ms == 0 || word_times.is_empty() {
        return false;
    }
    let first = word_times[0];
    let last = *word_times.last().unwrap();
    first <= 10 || (first + 500 < line_start_ms && last < line_start_ms + 500)
}

/// `[t]<t1>词<t2>词<t3>`：A2 格式逐字行；行尾无闭合戳的尾词给默认时长。
fn line_from_angle_marks(line: &str, order: usize) -> Option<ParsedLine> {
    let marks = scan_timestamp_marks(line, '[', ']');
    let (body_from, line_start) = match marks.first() {
        Some((_, from, ms)) => (*from, *ms),
        None => return None,
    };
    let body = &line[body_from..];
    let mut stamps = scan_timestamp_marks(body, '<', '>');
    if stamps.is_empty() {
        return None;
    }

    let stamp_values: Vec<u32> = stamps.iter().map(|mark| mark.2).collect();
    if needs_anchor_shift(line_start, &stamp_values) {
        for stamp in stamps.iter_mut() {
            stamp.2 = stamp.2.saturating_add(line_start);
        }
    }

    // 行首戳与第一个词戳之间若夹了别的文本，就不是 A2 逐字行。
    if !body[..stamps[0].0].trim().is_empty() {
        return None;
    }

    let mut words = Vec::new();
    for pair in stamps.windows(2) {
        let (_, from_pos, from_ms) = pair[0];
        let (to_pos, _, to_ms) = pair[1];
        let chunk = tidy_word(&body[from_pos..to_pos]);
        if chunk.is_empty() {
            continue;
        }
        words.push(ParsedWord {
            text: chunk,
            start_ms: from_ms,
            end_ms: to_ms.max(from_ms),
            roman_text: None,
        });
    }
    if let Some((_, after_last, last_ms)) = stamps.last() {
        let trailing = tidy_word(&body[*after_last..]);
        if !trailing.is_empty() {
            words.push(ParsedWord {
                text: trailing,
                start_ms: *last_ms,
                end_ms: last_ms + A2_TAIL_WORD_SPAN_MS,
                roman_text: None,
            });
        }
    }
    if words.is_empty() {
        return None;
    }

    let joined = tidy_line(&words.iter().map(|w| w.text.clone()).collect::<String>());
    let (role, text) = split_role_prefix(&joined);
    let last_word_end = words.last().map(|w| w.end_ms).unwrap_or(line_start);
    let end_ms = stamps
        .last()
        .map(|mark| mark.2)
        .unwrap_or(line_start)
        .max(last_word_end);

    Some(ParsedLine {
        start_ms: line_start,
        end_ms: end_ms.max(line_start),
        text,
        words: Some(words),
        translated_text: None,
        roman_text: None,
        source_format: LineFormat::EnhancedLrc,
        source_index: order as f64,
        explicit_role: role,
        speaker: None,
        is_bg: false,
        is_duet: false,
        is_duet_partner: false,
    })
}

// ---------- LRC ----------

/// 单行普通 LRC：支持多时间戳前缀（一行拆多行）与三种行内逐字变体。
fn plain_lrc_rows(line: &str, order: usize) -> Vec<ParsedLine> {
    let marks = scan_timestamp_marks(line, '[', ']');
    if marks.is_empty() {
        return netease_single_row(line, order).into_iter().collect();
    }

    // 只有从行首连续排列的时间戳才算时间戳前缀。
    let mut leading = Vec::new();
    let mut expected = 0usize;
    for mark in &marks {
        if mark.0 != expected {
            break;
        }
        leading.push(*mark);
        expected = mark.1;
    }
    if leading.is_empty() {
        return Vec::new();
    }

    let body = &line[expected..];
    if body.contains('<') && body.contains('>') {
        if let Some(parsed) = line_from_angle_marks(line, order) {
            return vec![parsed];
        }
    }
    if body.contains('[') && body.contains(']') {
        if let Some(parsed) = line_from_square_word_marks(line, order) {
            return vec![parsed];
        }
    }
    if body.contains('(') && body.contains(')') {
        if let Some(parsed) = line_from_paren_word_marks(line, order) {
            return vec![parsed];
        }
    }

    let (role, text) = split_role_prefix(body);
    let blank = text.is_empty();
    leading
        .into_iter()
        .enumerate()
        .map(|(offset, (_, _, start_ms))| ParsedLine {
            start_ms,
            // 空文本行（间奏占位）start == end，留待空行收尾逻辑处理。
            end_ms: if blank { start_ms } else { start_ms.saturating_add(5000) },
            text: text.clone(),
            words: None,
            translated_text: None,
            roman_text: None,
            source_format: LineFormat::Lrc,
            source_index: order as f64 + offset as f64 * 0.001,
            explicit_role: if blank { None } else { role.clone() },
            speaker: None,
            is_bg: false,
            is_duet: false,
            is_duet_partner: false,
        })
        .collect()
}

/// 空文本 LRC 行可以把上一行的结束时间"顶"到当前位置（构成间奏），
/// 但仅当距离下一句足够远（>=4s）时才认为真的是间奏。
fn close_gaps_at_blank_rows(rows: Vec<ParsedLine>) -> Vec<ParsedLine> {
    let mut kept: Vec<ParsedLine> = Vec::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        if !row.text.trim().is_empty() {
            kept.push(row.clone());
            continue;
        }
        let Some(previous) = kept.last_mut() else {
            continue;
        };
        if previous.end_ms != previous.start_ms.saturating_add(5000) {
            continue;
        }
        if row.start_ms <= previous.start_ms {
            continue;
        }
        let upcoming = rows[index + 1..]
            .iter()
            .find(|candidate| !candidate.text.trim().is_empty());
        if let Some(next) = upcoming {
            if next.start_ms.saturating_sub(row.start_ms) < BLANK_ROW_INTERLUDE_MS {
                continue;
            }
        }
        previous.end_ms = row.start_ms;
    }
    kept
}

/// 逐行扫描 LRC 文本（A2 逐字优先，普通行随后）。
fn scan_lrc_text(raw: &str) -> Vec<ParsedLine> {
    let mut rows = Vec::new();
    for (order, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(parsed) = line_from_angle_marks(trimmed, order) {
            rows.push(parsed);
            continue;
        }
        rows.extend(plain_lrc_rows(trimmed, order));
    }
    close_gaps_at_blank_rows(rows)
}

/// QQ/Baka 链路会把解密后的 QRC XML 与插件译文 LRC 拼在同一份文本里；
/// parse_qrc 只吃 XML，尾部译文会被丢掉——这里按时间戳就近（±2s）补进主行
/// 的 translated_text，只填空位、不覆盖已有翻译。
fn merge_tail_translations(rows: &mut [ParsedLine], tail: &str) {
    let translations = scan_lrc_text(tail);
    if translations.is_empty() || rows.is_empty() {
        return;
    }
    for translation in &translations {
        let text = translation.text.trim();
        if text.is_empty() {
            continue;
        }
        let mut nearest: Option<(usize, i64)> = None;
        for (index, row) in rows.iter().enumerate() {
            let delta = (row.start_ms as i64 - translation.start_ms as i64).abs();
            if delta > TRANSLATION_MATCH_WINDOW_MS {
                continue;
            }
            if nearest.map(|(_, best)| delta < best).unwrap_or(true) {
                nearest = Some((index, delta));
            }
        }
        if let Some((index, _)) = nearest {
            let row = &mut rows[index];
            let slot_free = row
                .translated_text
                .as_deref()
                .map(str::trim)
                .map(str::is_empty)
                .unwrap_or(true);
            if slot_free {
                row.translated_text = Some(text.to_string());
            }
        }
    }
}

// ---------- 网易逐字 JSON ----------

/// 整段 JSON 数组形式：`[{"t":..,"c":[{"tx":..}],"x":..},..]`。
fn netease_json_rows(raw: &str) -> Vec<ParsedLine> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw.trim()) else {
        return Vec::new();
    };
    let serde_json::Value::Array(items) = value else {
        return Vec::new();
    };

    let mut rows = Vec::new();
    for (order, item) in items.iter().enumerate() {
        let Some(start_i64) = item.get("t").and_then(|v| v.as_i64()) else {
            continue;
        };
        let Some(chars) = item.get("c").and_then(|v| v.as_array()) else {
            continue;
        };
        if chars.is_empty() {
            continue;
        }

        let mut words = Vec::new();
        let mut text = String::new();
        for char_obj in chars {
            let Some(tx) = char_obj.get("tx").and_then(|v| v.as_str()) else {
                continue;
            };
            if tx.is_empty() {
                continue;
            }
            text.push_str(tx);
            words.push(ParsedWord {
                text: tx.to_string(),
                start_ms: start_i64.max(0) as u32,
                end_ms: start_i64.max(0) as u32,
                roman_text: None,
            });
        }
        if text.trim().is_empty() {
            continue;
        }

        let start_ms = start_i64.max(0) as u32;
        let end_ms = item
            .get("x")
            .and_then(|v| v.as_i64())
            .map(|v| v.max(0) as u32)
            .unwrap_or(start_ms);
        let (role, text) = split_role_prefix(&text);
        rows.push(ParsedLine {
            start_ms,
            end_ms: end_ms.max(start_ms),
            text,
            words: Some(words),
            translated_text: None,
            roman_text: None,
            source_format: LineFormat::Yrc,
            source_index: order as f64,
            explicit_role: role,
            speaker: None,
            is_bg: false,
            is_duet: false,
            is_duet_partner: false,
        });
    }
    rows
}

/// 单行 JSON 形式（多见于逐行存放的网易逐字歌词）。
fn netease_single_row(line: &str, order: usize) -> Option<ParsedLine> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let start_i64 = value.get("t").and_then(|v| v.as_i64())?;
    let chars = value.get("c").and_then(|v| v.as_array())?;
    if chars.is_empty() {
        return None;
    }

    let mut words = Vec::new();
    let mut text = String::new();
    for char_obj in chars {
        let Some(tx) = char_obj.get("tx").and_then(|v| v.as_str()) else {
            continue;
        };
        if tx.is_empty() {
            continue;
        }
        text.push_str(tx);
        words.push(ParsedWord {
            text: tx.to_string(),
            start_ms: start_i64.max(0) as u32,
            end_ms: start_i64.max(0) as u32,
            roman_text: None,
        });
    }
    if text.trim().is_empty() {
        return None;
    }

    let start_ms = start_i64.max(0) as u32;
    let end_ms = value
        .get("x")
        .and_then(|v| v.as_i64())
        .map(|v| v.max(0) as u32)
        .unwrap_or(start_ms.saturating_add(500));
    let (role, text) = split_role_prefix(&text);
    Some(ParsedLine {
        start_ms,
        end_ms: end_ms.max(start_ms),
        text,
        words: Some(words),
        translated_text: None,
        roman_text: None,
        source_format: LineFormat::Yrc,
        source_index: order as f64,
        explicit_role: role,
        speaker: None,
        is_bg: false,
        is_duet: false,
        is_duet_partner: false,
    })
}

// ---------- Lyricify Quick Export ----------

/// `[起,止,声道]文本` 行（LQE / LyricifyLines）。
fn lyricify_export_rows(raw: &str) -> Vec<ParsedLine> {
    let mut rows = Vec::new();
    for (order, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix('[') else {
            continue;
        };
        let Some(close) = rest.find(']') else {
            continue;
        };
        let params = &rest[..close];
        let text = &rest[close + 1..];
        let mut sections = params.split(',');
        let (Some(start), Some(end)) = (
            sections.next().and_then(|s| s.trim().parse::<i64>().ok()),
            sections.next().and_then(|s| s.trim().parse::<i64>().ok()),
        ) else {
            continue;
        };
        let _channel: i64 = sections
            .next()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        if text.trim().is_empty() {
            continue;
        }

        let start_ms = start.max(0) as u32;
        let end_ms = end.max(start) as u32;
        let (role, text) = split_role_prefix(text);
        rows.push(ParsedLine {
            start_ms,
            end_ms: end_ms.max(start_ms),
            text,
            words: None,
            translated_text: None,
            roman_text: None,
            source_format: LineFormat::Lrc,
            source_index: order as f64,
            explicit_role: role,
            speaker: None,
            is_bg: false,
            is_duet: false,
            is_duet_partner: false,
        });
    }
    rows
}

// ---------- TTML ----------

fn drop_xml_tags(raw: &str) -> String {
    tidy_line(&FORMAT_RE.xml_tag.replace_all(raw, "").to_string())
}

/// TTML：`<p>` 段落为主行，`ttm:role` 标记的 `<span>` 分流到翻译 / 罗马音。
fn ttml_lines(raw: &str) -> Vec<ParsedLine> {
    let mut rows = Vec::new();

    for (order, caps) in FORMAT_RE.ttml_paragraph.captures_iter(raw).enumerate() {
        let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        let body = caps.get(2).map(|m| m.as_str()).unwrap_or_default();
        let Some(start_ms) = FORMAT_RE
            .ttml_begin
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .and_then(|v| ttml_clock_ms(&v))
        else {
            continue;
        };
        let end_ms = FORMAT_RE
            .ttml_end
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .and_then(|v| ttml_clock_ms(&v))
            .unwrap_or(start_ms.saturating_add(5000));

        let mut translated = None;
        let mut roman = None;
        for span in FORMAT_RE.ttml_span.captures_iter(body) {
            let span_attrs = span.get(1).map(|m| m.as_str()).unwrap_or_default();
            let span_body = span.get(2).map(|m| m.as_str()).unwrap_or_default();
            let role = FORMAT_RE
                .ttml_role
                .captures(span_attrs)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_lowercase());
            let content = drop_xml_tags(span_body);
            match role.as_deref() {
                Some("x-translation") | Some("translation") => {
                    if !content.is_empty() {
                        translated = Some(content);
                    }
                }
                Some("x-roman") | Some("roman") | Some("romanization")
                | Some("transliteration") => {
                    if !content.is_empty() {
                        roman = Some(content);
                    }
                }
                _ => {}
            }
        }

        // 主正文：角色 span 清空、普通 span 换成内部文本，再统一去标签。
        let mut core = body.to_string();
        for span in FORMAT_RE.ttml_span.captures_iter(body) {
            if let Some(whole) = span.get(0) {
                let role = FORMAT_RE
                    .ttml_role
                    .captures(span.get(1).map(|m| m.as_str()).unwrap_or_default())
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_lowercase());
                let replacement = match role.as_deref() {
                    Some("x-translation") | Some("translation") | Some("x-roman")
                    | Some("roman") | Some("romanization") | Some("transliteration") => {
                        String::new()
                    }
                    _ => drop_xml_tags(span.get(2).map(|m| m.as_str()).unwrap_or_default()),
                };
                core = core.replacen(whole.as_str(), &replacement, 1);
            }
        }

        let (role_tag, text) = split_role_prefix(&drop_xml_tags(&core));
        if text.is_empty() && translated.is_none() && roman.is_none() {
            continue;
        }

        rows.push(ParsedLine {
            start_ms,
            end_ms,
            text,
            words: None,
            translated_text: translated,
            roman_text: roman,
            source_format: LineFormat::Ttml,
            source_index: order as f64,
            explicit_role: role_tag,
            speaker: None,
            is_bg: false,
            is_duet: false,
            is_duet_partner: false,
        });
    }

    rows
}

// ---------- 兜底与候选择优 ----------

/// 所有格式都失败时，把纯文本按 3s 一行合成。
fn plain_text_fallback(raw: &str) -> Vec<ParsedLine> {
    const PLAIN_ROW_SPAN_MS: u32 = 3000;
    let mut rows = Vec::new();
    let mut cursor_ms = 0u32;
    for (order, line) in raw.lines().enumerate() {
        let (role, text) = split_role_prefix(line);
        if text.is_empty() {
            continue;
        }
        rows.push(ParsedLine {
            start_ms: cursor_ms,
            end_ms: cursor_ms.saturating_add(PLAIN_ROW_SPAN_MS),
            text,
            words: None,
            translated_text: None,
            roman_text: None,
            source_format: LineFormat::Lrc,
            source_index: order as f64,
            explicit_role: role,
            speaker: None,
            is_bg: false,
            is_duet: false,
            is_duet_partner: false,
        });
        cursor_ms = cursor_ms.saturating_add(PLAIN_ROW_SPAN_MS);
    }
    rows
}

fn order_rows(rows: &mut [ParsedLine]) {
    rows.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then_with(|| source_index_order(left.source_index, right.source_index))
            .then_with(|| left.end_ms.cmp(&right.end_ms))
    });
}

/// 收尾规整：行结束时间不得早于行开始，LRC 默认 5s 结束与下一行起点取大者。
fn normalize_row_ends(rows: &mut [ParsedLine]) {
    order_rows(rows);
    for index in 0..rows.len() {
        let current_start = rows[index].start_ms;
        let next_start = rows.get(index + 1).map(|row| row.start_ms);
        let natural_end = next_start.unwrap_or(current_start.saturating_add(5000));
        if rows[index].source_format == LineFormat::Lrc
            && rows[index].end_ms == current_start.saturating_add(5000)
        {
            rows[index].end_ms = rows[index].end_ms.max(current_start.max(natural_end));
        } else if rows[index].end_ms <= current_start {
            rows[index].end_ms = natural_end.max(current_start);
        }
    }
}

fn push_candidate(sink: &mut Vec<FormatCandidate>, format: LineFormat, mut rows: Vec<ParsedLine>) {
    if rows.is_empty() {
        return;
    }
    normalize_row_ends(&mut rows);
    // 混入 A2 逐字行的候选整体按 EnhancedLrc 记名。
    let effective = if rows
        .iter()
        .any(|row| row.source_format == LineFormat::EnhancedLrc)
    {
        LineFormat::EnhancedLrc
    } else {
        format
    };
    sink.push(FormatCandidate {
        format: effective,
        rows,
    });
}

/// 单行信息量：词级 2 分、翻译 1 分、罗马音 1 分。
fn row_richness(row: &ParsedLine) -> i32 {
    let word_points = if row.words.as_ref().map(|w| !w.is_empty()).unwrap_or(false) {
        2
    } else {
        0
    };
    let translation_points = if row
        .translated_text
        .as_ref()
        .map(|t| !t.is_empty())
        .unwrap_or(false)
    {
        1
    } else {
        0
    };
    let roman_points = if row.roman_text.as_ref().map(|t| !t.is_empty()).unwrap_or(false) {
        1
    } else {
        0
    };
    word_points + translation_points + roman_points
}

fn candidate_richness(rows: &[ParsedLine]) -> i32 {
    rows.iter().map(row_richness).sum()
}

fn format_rank(format: &LineFormat) -> i32 {
    match format {
        LineFormat::EnhancedLrc => 6,
        LineFormat::Ttml => 5,
        LineFormat::Yrc => 4,
        LineFormat::Qrc => 3,
        LineFormat::Lys => 2,
        LineFormat::Eslrc => 1,
        LineFormat::Lrc => 0,
    }
}

fn candidate_ordering(left: &FormatCandidate, right: &FormatCandidate) -> Ordering {
    candidate_richness(&right.rows)
        .cmp(&candidate_richness(&left.rows))
        .then_with(|| right.rows.len().cmp(&left.rows.len()))
        .then_with(|| format_rank(&right.format).cmp(&format_rank(&left.format)))
}

/// 解析总入口：逐格式尝试，产出行数最多 / 信息最富 / 格式优先级最高的候选组。
pub(super) fn dissect_source(raw: &str) -> Vec<ParsedLine> {
    let text = normalize_source(raw);
    let mut candidates: Vec<FormatCandidate> = Vec::new();

    if text.contains("<tt") {
        push_candidate(&mut candidates, LineFormat::Ttml, ttml_lines(&text));
    }

    let lowered = text.to_ascii_lowercase();
    if lowered.contains("[lyricify quick export]") || lowered.contains("[type:lyricifylines]") {
        push_candidate(
            &mut candidates,
            LineFormat::Lrc,
            lyricify_export_rows(&text),
        );
    }

    // 整段十六进制 → QRC 密文（QQ 魔改 3DES + zlib，native_parse 解密）。
    let hex_blob: String = text.split_whitespace().collect();
    if hex_blob.len() > HEX_DECRYPT_MIN_LEN
        && hex_blob.len() % 2 == 0
        && hex_blob.chars().all(|ch| ch.is_ascii_hexdigit())
    {
        push_candidate(
            &mut candidates,
            LineFormat::Qrc,
            source_rows(&parse_qrc(&decrypt_qrc_hex(&hex_blob)), LineFormat::Qrc),
        );
    }

    push_candidate(
        &mut candidates,
        LineFormat::Yrc,
        netease_json_rows(&text),
    );

    push_candidate(
        &mut candidates,
        LineFormat::Yrc,
        source_rows(&parse_yrc(&text), LineFormat::Yrc),
    );

    // QRC XML 之后可能拼接译文 LRC（见 merge_tail_translations 注释）。
    let mut qrc_rows = source_rows(&parse_qrc(&text), LineFormat::Qrc);
    if !qrc_rows.is_empty() {
        if let Some(xml_end) = text.find(QRC_XML_CLOSER) {
            let tail = &text[xml_end + QRC_XML_CLOSER.len()..];
            merge_tail_translations(&mut qrc_rows, tail);
        }
    }
    push_candidate(&mut candidates, LineFormat::Qrc, qrc_rows);

    push_candidate(
        &mut candidates,
        LineFormat::Lys,
        source_rows(&parse_lys(&text), LineFormat::Lys),
    );

    push_candidate(
        &mut candidates,
        LineFormat::Eslrc,
        source_rows(
            &parse_eslrc(&expand_multi_stamp_lines(&text)),
            LineFormat::Eslrc,
        ),
    );

    push_candidate(
        &mut candidates,
        LineFormat::Lrc,
        scan_lrc_text(&text),
    );

    // 稳定排序：总分相同时候选保持尝试顺序。
    candidates.sort_by(candidate_ordering);
    let mut rows = candidates
        .into_iter()
        .next()
        .map(|candidate| candidate.rows)
        .unwrap_or_default();

    if rows.is_empty() {
        rows = plain_text_fallback(&text);
    }

    mark_vocals(&mut rows);
    let offset_ms = read_meta_tags(&text).offset_ms;
    shift_for_offset(&mut rows, offset_ms);
    rows
}
