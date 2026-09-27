// 演唱者标注：制作人员名单识别、对唱说话人前缀、背景和声拆分。

use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;

use super::model::ParsedLine;

struct VocalPatterns {
    credit: Regex,
    non_speaker: Regex,
    speaker_prefix: Regex,
    parenthetical: Regex,
}

static VOCAL: LazyLock<VocalPatterns> = LazyLock::new(|| VocalPatterns {
    credit: Regex::new(
        r"(?i)^(?:(?:作)?词|(?:作)?詞|曲|作曲|编曲|編曲|词曲|詞曲|(?:作)?[词詞]\s*[/、&＆]\s*曲|原唱|演唱|主唱|领唱|領唱|和音|和声|和聲|歌手|歌词|歌詞|制作|製作|出品|发行|發行|策划|策劃|统筹|統籌|监制|監製|导演|導演|混音|母带|母帶|录音|錄音|翻译|翻譯|譯|字幕|后期|後期|压制|壓制|来源|來源|出处|封面|美工|鸣谢|鳴謝|感谢|感謝|宣传|宣傳|赞助|贊助|吉他|贝斯|貝斯|贝司|貝司|鼓|键盘|鍵盤|钢琴|鋼琴|提琴|二胡|琵琶|古筝|古箏|笛子|箫|簫|口琴|萨克斯|薩克斯|小号|小號|长笛|長笛|竖琴|豎琴|lyrics?|lyricist|compos(?:er|ed)|music|arrang(?:er|ement|ed)|produc(?:er|ed|tion)|mix(?:ed|ing)?|master(?:ed|ing)?|record(?:ed|ing)?|vocal(?:s|ist)?|guitar|bass|drums?|piano|keyboard|violin|cello|viola|strings|brass|flute|trumpet|sax(?:ophone)?|translator|subtitle|cover|artwork|design|copyright|staff|pv|mv|movie|video|animation|illustration|illustrator|thanks|written|wrote)[^:：\r\n]{0,4}\s*[:：]",
    ).unwrap(),
    non_speaker: Regex::new(
        r"(?i)^(?:作词|作詞|作曲|填词|填詞|制作|出品|发行|發行|策划|策劃|监制|監製|混音|母带|母帶|录音|錄音|和声|和聲|翻唱|原曲|歌名|歌曲|专辑|專輯|标题|標題|调教|調教|调声|調聲|曲绘|曲繪|绘图|繪圖|画师|畫師|视频|視頻|映像|动画|動畫|演唱|主唱|领唱|領唱|和音|歌词|歌詞|词曲|詞曲|原唱|翻译|翻譯|字幕|后期|後期|压制|壓制|来源|來源|封面|美工|吉他|贝斯|貝斯|鼓|键盘|鍵盤|钢琴|鋼琴|提琴|笛子|口琴|artist|album|title|producer|mix|master(?:ing)?|staff|pv|mv|movie|video|animation|illustration|illustrator|lyrics?|lyricist|composer|music|arranger|vocal(?:s|ist)?|guitar|bass|drums?|piano|keyboard|violin|cello|viola|strings|brass|flute|trumpet|sax(?:ophone)?|translator|subtitle|cover|artwork|design|copyright|thanks)$",
    ).unwrap(),
    speaker_prefix: Regex::new(r"^\s*([^:：\r\n]{1,24}?)\s*[:：]\s*").unwrap(),
    parenthetical: Regex::new(r"[（(]([^()（）\r\n]+)[)）]").unwrap(),
});

/// 日文假名出现与否（不含半角片假名区，供括注判定用）。
pub(super) fn kana_present(text: &str) -> bool {
    text.chars()
        .any(|ch| matches!(ch as u32, 0x3040..=0x30ff | 0x31f0..=0x31ff))
}

/// 谚文出现与否。
pub(super) fn hangul_present(text: &str) -> bool {
    text.chars().any(|ch| matches!(ch as u32, 0xac00..=0xd7af))
}

/// 形如 "作词：xxx" 的制作名单行（这类行不是歌词，也不当作对唱）。
pub(super) fn is_production_credit(text: &str) -> bool {
    VOCAL.credit.is_match(text.trim())
}

/// 识别 "角色名：" 形式的说话人前缀；制作名单与 URL 协议头不算。
pub(super) fn split_speaker_prefix(text: &str) -> (Option<String>, String) {
    let trimmed = text.trim();
    if trimmed.is_empty() || is_production_credit(trimmed) {
        return (None, trimmed.to_string());
    }

    let Some(caps) = VOCAL.speaker_prefix.captures(trimmed) else {
        return (None, trimmed.to_string());
    };
    let name = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
    if name.is_empty()
        || name.eq_ignore_ascii_case("http")
        || name.eq_ignore_ascii_case("https")
    {
        return (None, trimmed.to_string());
    }
    if VOCAL.non_speaker.is_match(name) {
        return (None, trimmed.to_string());
    }

    let consumed = caps.get(0).map(|m| m.len()).unwrap_or(0);
    let remainder = trimmed[consumed..].trim().to_string();
    (Some(name.to_string()), remainder)
}

/// 整行被一对括号（圆/方）完整包住时，取出内部文本。
fn unwrap_enclosed(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let inner = if trimmed.starts_with('(') && trimmed.ends_with(')') {
        &trimmed[1..trimmed.len() - 1]
    } else if trimmed.starts_with('[') && trimmed.ends_with(']') {
        &trimmed[1..trimmed.len() - 1]
    } else {
        return None;
    };
    let inner = inner.trim();
    if inner.is_empty() {
        None
    } else {
        Some(inner.to_string())
    }
}

/// 括注内容是否是和声 / 背伴类的演唱提示。
fn is_backing_note(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_lowercase();
    if lower.contains("和声")
        || lower.contains("伴唱")
        || lower.contains("合唱")
        || lower.contains("合声")
        || lower.contains("backup")
        || lower.contains("background")
        || lower.contains("harmony")
    {
        return true;
    }

    const LABELS: [&str; 21] = [
        "翻译", "译文", "注音", "罗马音", "罗马字", "音译", "旁白", "独白", "对白", "白", "男",
        "女", "合", "主", "伴", "os", "intro", "outro", "间奏", "前奏", "尾奏",
    ];
    trimmed.chars().count() <= 6 && !LABELS.contains(&lower.as_str())
}

/// 把行内的和声括注挖出来，返回（主唱文本、和声文本）；无有效括注时返回 None。
fn carve_backing_vocal(text: &str) -> Option<(String, String)> {
    let mut main_fragments: Vec<&str> = Vec::new();
    let mut backing_bits: Vec<&str> = Vec::new();
    let mut cursor = 0usize;
    let mut carved = false;

    for caps in VOCAL.parenthetical.captures_iter(text) {
        let whole = caps.get(0).unwrap();
        let content = caps.get(1).unwrap().as_str().trim();
        if content.is_empty() || !is_backing_note(content) {
            continue;
        }
        if kana_present(content) || hangul_present(content) {
            continue;
        }
        carved = true;
        main_fragments.push(&text[cursor..whole.start()]);
        backing_bits.push(content);
        cursor = whole.end();
    }
    if !carved {
        return None;
    }
    main_fragments.push(&text[cursor..]);

    let main_text = main_fragments
        .concat()
        .replace('\u{a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let backing_text = backing_bits.join(" ");
    if main_text.trim().is_empty() || backing_text.trim().is_empty() {
        return None;
    }
    Some((main_text, backing_text))
}

/// 判断整篇歌词是否存在对唱证据：
/// 要么说话人前缀 >= 2 处且不破坏"前缀只在行首块出现"的豁免，要么出现 >= 2 种不同和声括注。
fn duet_evidence(rows: &[ParsedLine]) -> bool {
    let mut speaker_count = 0usize;
    let mut plain_row_seen = false;
    let mut prefix_after_plain = false;
    let mut backing_set: HashSet<String> = HashSet::new();

    for row in rows {
        if row.is_bg {
            continue;
        }
        let (speaker, _) = split_speaker_prefix(&row.text);
        if speaker.is_some() {
            speaker_count += 1;
            if plain_row_seen {
                prefix_after_plain = true;
            }
        } else if !row.text.trim().is_empty() {
            plain_row_seen = true;
        }
        for caps in VOCAL.parenthetical.captures_iter(&row.text) {
            let content = caps.get(1).unwrap().as_str().trim();
            if is_backing_note(content) && !kana_present(content) && !hangul_present(content) {
                backing_set.insert(content.to_string());
            }
        }
    }

    (speaker_count >= 2 && (!plain_row_seen || prefix_after_plain)) || backing_set.len() >= 2
}

/// 三段式标注：
/// 1) 整行括号包裹 → 背景和声行（剥壳）；
/// 2) 有对唱证据时，说话人前缀落位；
/// 3) 有对唱证据时，把行内 "主唱 (和声)" 拆成主行 + 伴唱搭档行。
pub(super) fn mark_vocals(rows: &mut Vec<ParsedLine>) {
    for row in rows.iter_mut() {
        if let Some(inner) = unwrap_enclosed(&row.text) {
            row.is_bg = true;
            row.text = inner;
        }
    }

    let duet = duet_evidence(rows);
    if duet {
        for row in rows.iter_mut() {
            let (speaker, remainder) = split_speaker_prefix(&row.text);
            if let Some(speaker) = speaker {
                row.speaker = Some(speaker);
                row.text = remainder;
                row.is_duet = true;
            }
        }
    } else {
        return;
    }

    let mut split_rows = Vec::with_capacity(rows.len());
    for mut row in rows.drain(..) {
        if !row.is_bg {
            if let Some((main_text, backing_text)) = carve_backing_vocal(&row.text) {
                row.text = main_text;
                let mut partner = row.clone();
                partner.text = backing_text;
                partner.is_bg = true;
                partner.is_duet_partner = true;
                partner.is_duet = false;
                partner.speaker = None;
                split_rows.push(row);
                split_rows.push(partner);
                continue;
            }
        }
        split_rows.push(row);
    }
    *rows = split_rows;
}
