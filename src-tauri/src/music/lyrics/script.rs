// 文字体系识别（拉丁 / 汉字 / 假名 / 谚文）与拉丁文本风格打分：
// 区分"英语原句"与"罗马音转写"，是翻译轨 / 罗马音轨判定的核心依据。

use regex::Regex;
use std::sync::LazyLock;

use super::model::{bounded01, mean_of, DominantScript, LineScriptProfile, LyricTrack};

/// 单个字符所属的文字体系（判定区间互斥，顺序无关）。
#[derive(Clone, Copy, PartialEq, Eq)]
enum Glyph {
    Latin,
    Han,
    Kana,
    Hangul,
}

fn glyph_of(ch: char) -> Option<Glyph> {
    let code = ch as u32;
    if ch.is_ascii_alphabetic()
        || matches!(
            code,
            0x00C0..=0x00FF | 0x0100..=0x017F | 0x0180..=0x024F | 0x1E00..=0x1EFF
        )
    {
        Some(Glyph::Latin)
    } else if matches!(code, 0x3040..=0x30FF | 0x31F0..=0x31FF | 0xFF66..=0xFF9F) {
        Some(Glyph::Kana)
    } else if matches!(code, 0xAC00..=0xD7AF | 0x1100..=0x11FF | 0x3130..=0x318F) {
        Some(Glyph::Hangul)
    } else if matches!(code, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF) {
        Some(Glyph::Han)
    } else {
        None
    }
}

/// 依出现频次选出主导文字；两家占比接近时判为混合。
pub(super) fn pick_dominant_script(latin: u32, han: u32, kana: u32, hangul: u32) -> DominantScript {
    let total = latin + han + kana + hangul;
    if total == 0 {
        return DominantScript::Other;
    }

    // 固定顺序 + 稳定排序：计票相同时保持 拉丁 > 汉字 > 假名 > 谚文 的既有优先级。
    let mut ranking = [
        (DominantScript::Latin, latin),
        (DominantScript::Han, han),
        (DominantScript::Kana, kana),
        (DominantScript::Hangul, hangul),
    ];
    ranking.sort_by(|left, right| right.1.cmp(&left.1));

    let leader = ranking[0].0.clone();
    let leader_votes = ranking[0].1;
    let runner_up_votes = ranking[1].1;

    if runner_up_votes > 0 && (leader_votes as f64 / total as f64) < 0.7 {
        return DominantScript::Mixed;
    }

    leader
}

pub(super) fn measure_script(text: &str) -> LineScriptProfile {
    let mut latin = 0u32;
    let mut han = 0u32;
    let mut kana = 0u32;
    let mut hangul = 0u32;

    for ch in text.chars() {
        match glyph_of(ch) {
            Some(Glyph::Latin) => latin += 1,
            Some(Glyph::Han) => han += 1,
            Some(Glyph::Kana) => kana += 1,
            Some(Glyph::Hangul) => hangul += 1,
            None => {}
        }
    }

    let dominant_script = pick_dominant_script(latin, han, kana, hangul);
    LineScriptProfile {
        latin_count: latin,
        han_count: han,
        kana_count: kana,
        hangul_count: hangul,
        dominant_script,
    }
}

/// 行内出现假名即视作日语风（谚文缺席为前提）。
pub(super) fn kana_flavored(profile: &LineScriptProfile) -> bool {
    profile.kana_count > 0 && profile.hangul_count == 0
}

/// 文字家族归类：假名随汉字归入 CJK 家族。
pub(super) fn family_of(script: &DominantScript) -> &'static str {
    match script {
        DominantScript::Latin => "latin",
        DominantScript::Han | DominantScript::Kana | DominantScript::Mixed => "cjk",
        DominantScript::Hangul => "hangul",
        DominantScript::Other => "other",
    }
}

/// 纯汉字画像：有汉字且无假名、无谚文，常见于中文翻译行。
pub(super) fn plain_han_profile(profile: &LineScriptProfile) -> bool {
    profile.han_count > 0 && profile.kana_count == 0 && profile.hangul_count == 0
}

pub(super) fn track_kana_flavored(track: &LyricTrack) -> bool {
    track.lines.iter().any(|row| kana_flavored(&row.script_profile))
}

/// 轨道内带词级时间戳的行占比。
pub(super) fn word_row_share(track: &LyricTrack) -> f64 {
    let with_words = track
        .lines
        .iter()
        .filter(|row| row.words.as_ref().map(|words| !words.is_empty()).unwrap_or(false))
        .count();
    with_words as f64 / track.lines.len().max(1) as f64
}

// ---------- 拉丁文本风格打分 ----------

struct StylePatterns {
    contraction: Regex,
    digraph: Regex,
    consonant_cluster: Regex,
    romanization: Regex,
}

static STYLE: LazyLock<StylePatterns> = LazyLock::new(|| StylePatterns {
    contraction: Regex::new(r"(?i)\b(i'm|you're|we're|it's|i'll|don't|can't)\b").unwrap(),
    digraph: Regex::new(r"(th|gh|ph|wh|ck|ee|oo)").unwrap(),
    consonant_cluster: Regex::new(r"(str|scr|dr|st|mp?t)").unwrap(),
    romanization: Regex::new(
        r"(?i)(shi|chi|tsu?|kyo|ryo|ryu|nya|hya|gya|sha|sya|jya|ja|yeo|gye|sarang|geudae|uri|nani|kimo|kimi|watashi|boku|anata|kara|made|desu|xiang|zh|ch|sh|ang|eng|ing|ong|iao|ian|uan|uang|yuan|yin|ying|xin|meng)",
    ).unwrap(),
});

/// 按英文分词规则切词：小写化，仅保留字母与词中撇号。
pub(super) fn latin_tokens(text: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut pending = String::new();

    for ch in text.chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_ascii_alphabetic() || (ch == '\'' && !pending.is_empty()) {
            pending.push(ch);
        } else if !pending.is_empty() {
            tokens.push(std::mem::take(&mut pending));
        }
    }
    if !pending.is_empty() {
        tokens.push(pending);
    }

    tokens
}

/// 英文常见词命中密度（含缩写形式加成）。
pub(super) fn english_likeness(text: &str) -> f64 {
    let tokens = latin_tokens(text);
    if tokens.is_empty() {
        return 0.0;
    }

    const ENGLISH_HINTS: [&str; 32] = [
        "a", "all", "am", "and", "are", "be", "care", "do", "for", "had", "have", "hello", "i",
        "in", "is", "it", "know", "love", "me", "my", "not", "of", "on", "that", "the", "there",
        "to", "want", "we", "with", "you", "your",
    ];
    let hits = tokens
        .iter()
        .filter(|token| ENGLISH_HINTS.contains(&token.as_str()))
        .count() as f64;
    let contraction_bonus = if STYLE.contraction.is_match(text) { 0.15 } else { 0.0 };

    bounded01((hits / tokens.len() as f64) * 0.85 + contraction_bonus)
}

/// 罗马音 / 拼音风格的音节特征密度。
pub(super) fn romanized_likeness(text: &str) -> f64 {
    if measure_script(text).dominant_script != DominantScript::Latin {
        return 0.0;
    }

    let tokens = latin_tokens(text);
    if tokens.is_empty() {
        return 0.0;
    }

    let roman_hits = tokens
        .iter()
        .filter(|token| STYLE.romanization.is_match(token))
        .count() as f64
        / tokens.len() as f64;
    let short_token_ratio = tokens.iter().filter(|token| token.len() <= 4).count() as f64
        / tokens.len() as f64;
    let open_ending_ratio = tokens
        .iter()
        .filter(|token| {
            token.ends_with(['a', 'e', 'i', 'o', 'u'])
                || token.ends_with('n')
                || token.ends_with("ng")
        })
        .count() as f64
        / tokens.len() as f64;
    let vowel_ratio = mean_of(
        &tokens
            .iter()
            .map(|token| {
                let vowels = token
                    .chars()
                    .filter(|ch| matches!(ch, 'a' | 'e' | 'i' | 'o' | 'u'))
                    .count() as f64;
                if token.is_empty() {
                    0.0
                } else {
                    vowels / token.len() as f64
                }
            })
            .collect::<Vec<_>>(),
    );
    let scarcity_penalty = match tokens.len() {
        1 => 0.25,
        2 => 0.1,
        _ => 0.0,
    };
    let englishness = english_likeness(text);

    bounded01(
        (roman_hits * 0.45)
            + (short_token_ratio * 0.2)
            + (open_ending_ratio * if tokens.len() >= 3 { 0.14 } else { 0.06 })
            + (vowel_ratio * 0.22)
            + if tokens.iter().any(|token| token.len() == 1) {
                0.08
            } else {
                0.0
            }
            - scarcity_penalty
            - (englishness * 0.62),
    )
}

/// 四词以上、均长达标且高频英文虚词命中的整句，更像英语原句。
pub(super) fn english_phrase_like(text: &str) -> bool {
    let tokens = latin_tokens(text);
    if tokens.len() < 4 {
        return false;
    }

    let mean_len =
        tokens.iter().map(|token| token.len() as f64).sum::<f64>() / tokens.len() as f64;
    const PHRASE_HINTS: [&str; 13] = [
        "can", "give", "hey", "i", "kiss", "last", "love", "me", "more", "one", "than", "you",
        "your",
    ];
    let hits = tokens
        .iter()
        .filter(|token| PHRASE_HINTS.contains(&token.as_str()))
        .count();

    mean_len >= 3.0 && hits >= 2 && romanized_likeness(text) < 0.42
}

/// 拉丁文本身处非罗马音语境时的英语原句特征（缩写、v 字母、英文二合音、词尾辅音等）。
pub(super) fn native_english_text(text: &str) -> bool {
    if measure_script(text).dominant_script != DominantScript::Latin {
        return false;
    }

    let tokens = latin_tokens(text);
    if tokens.is_empty() {
        return false;
    }

    const ENGLISH_HINTS: [&str; 14] = [
        "be", "believe", "but", "dream", "dreamt", "i", "leave", "need", "needing", "so", "still",
        "wait", "you", "yet",
    ];
    let lowered = text.to_lowercase();
    let romanization = romanized_likeness(text);
    let englishness = english_likeness(text);
    let hint_hits = tokens
        .iter()
        .filter(|token| ENGLISH_HINTS.contains(&token.as_str()))
        .count();

    if STYLE.contraction.is_match(text) {
        return true;
    }
    if tokens.iter().any(|token| token.contains('v')) {
        return true;
    }
    if STYLE.digraph.is_match(&lowered) {
        return romanization < 0.52 || hint_hits > 0;
    }
    if STYLE.consonant_cluster.is_match(&lowered) {
        return romanization < 0.52 || hint_hits > 0;
    }

    let closed_syllable_ending = tokens.iter().any(|token| {
        token.len() > 1
            && token
                .chars()
                .next_back()
                .map(|last| {
                    matches!(
                        last,
                        'd' | 't' | 'l' | 'p' | 'm' | 'k' | 'g' | 'f' | 's' | 'z' | 'r'
                    )
                })
                .unwrap_or(false)
    });

    closed_syllable_ending && (hint_hits >= 2 || englishness >= romanization + 0.12)
}

pub(super) fn track_english_likeness(track: &LyricTrack) -> f64 {
    mean_of(
        &track
            .lines
            .iter()
            .map(|row| english_likeness(&row.text))
            .collect::<Vec<_>>(),
    )
}

pub(super) fn track_romanized_likeness(track: &LyricTrack) -> f64 {
    mean_of(
        &track
            .lines
            .iter()
            .map(|row| romanized_likeness(&row.text))
            .collect::<Vec<_>>(),
    )
}

// ---------- 罗马化音译行的逐行判定（与 TS 侧 classifier.ts 互为镜像） ----------

/// 音译与汉字通常按音节一对一：音译词数与该行汉字数之比应落在此区间；
/// 翻译与原文长度无关，因此仅靠长度无法区分，需配合下面的音译特征判定。
pub(super) const MIN_ROMAN_TOKEN_HAN_RATIO: f64 = 0.45;
pub(super) const MAX_ROMAN_TOKEN_HAN_RATIO: f64 = 2.2;

/// 英文功能词：出现即强烈暗示该拉丁行是英文，而非 CJK 歌词的罗马化音译。
const ENGLISH_FUNCTION_WORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "but", "if", "is", "are", "was", "were", "be", "been", "am",
    "do", "does", "did", "have", "has", "had", "i", "you", "he", "she", "it", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "their", "our", "its", "to", "of",
    "in", "on", "at", "for", "with", "from", "by", "as", "not", "that", "this", "these", "those",
    "will", "would", "can", "could", "should", "when", "where", "what", "who", "how", "all",
    "just", "only", "than", "then", "there", "here",
];

/// 典型英文词形结尾；粤拼/拼音不会以这些字母组合结尾，出现即判定为英文而非音译。
fn has_english_morphology(token: &str) -> bool {
    if token.len() <= 3 {
        return false;
    }
    ["ing", "tion", "sion", "ness", "ment", "ly", "ed"]
        .iter()
        .any(|suffix| token.ends_with(suffix))
}

/// 该拉丁行是否「像」粤拼/港式罗马化音译，而非英文：必须带音译特征
/// （声调数字 / 声母 / 韵母 / 韵尾），且不含英文功能词、不含典型英文词形。
pub(super) fn looks_like_romanized_latin(text: &str) -> bool {
    let tokens = latin_tokens(text);
    if tokens.is_empty() {
        return false;
    }

    if tokens
        .iter()
        .any(|token| ENGLISH_FUNCTION_WORDS.contains(&token.as_str()))
    {
        return false;
    }
    if tokens.iter().any(|token| has_english_morphology(token)) {
        return false;
    }

    if text.chars().any(|ch| ch.is_ascii_digit()) {
        // 声调数字，如 nei5 / soeng1
        return true;
    }
    let lower = text.to_lowercase();
    if lower.contains("eo") || lower.contains("oe") || lower.contains("yu") {
        return true;
    }
    // 粤拼/港式罗马化特征：j-/y- 声母、-ng/-k/-t 韵尾是弱特征（法语/英语单词 et、out
    // 也会命中），至少两个音节同时命中才判音译，避免「拉丁主行 + 中文翻译」被误交换。
    tokens
        .iter()
        .filter(|token| {
            token.starts_with('j')
                || token.starts_with('y')
                || token.ends_with("ng")
                || token.ends_with('k')
                || token.ends_with('t')
        })
        .count()
        >= 2
}
