// 语义层：把轨道文档折算成逐行语义视图（主文本 + 译文 + 罗马音 + 附加文本），
// 并提供对外的载荷装配入口。硬角色簇（同簇 2-3 行）走确定性组装，其余走对齐挂载。

use std::cmp::Ordering;
use std::collections::BTreeMap;

use super::format::dissect_source;
use super::model::{
    source_index_order, AlignedPair, ClassificationConfidence, DominantScript, LyricDocument,
    LyricLinePayload, LyricTrack, LyricTrackLine, LyricTrackRole, LyricWordPayload, ParsedWord,
    PairAlignment, SemanticLine, StructuredLyricsPayload,
};
use super::script::{
    english_likeness, english_phrase_like, family_of, kana_flavored, measure_script,
    native_english_text, plain_han_profile, romanized_likeness, track_kana_flavored,
};
use super::text::{read_meta_tags, tidy_line};
use super::track::{align_tracks, build_lyric_document};

/// 行组内多来源角色置信度取最高档：显式 > 解析器原生 > 启发式。
fn pick_confidence(lines: &[Option<&LyricTrackLine>]) -> ClassificationConfidence {
    if lines.iter().any(|line| {
        line.and_then(|value| value.role_source.clone()) == Some(ClassificationConfidence::Explicit)
    }) {
        return ClassificationConfidence::Explicit;
    }
    if lines.iter().any(|line| {
        line.and_then(|value| value.role_source.clone())
            == Some(ClassificationConfidence::ParserNative)
    }) {
        return ClassificationConfidence::ParserNative;
    }
    ClassificationConfidence::Heuristic
}

/// 一对主行/辅行是否值得挂载：近邻漂移、同簇、解析器原生角色、或整体高覆盖。
fn pair_is_attachable(
    main_track: &LyricTrack,
    aux_track: &LyricTrack,
    alignment: &PairAlignment,
    pair: &AlignedPair,
) -> bool {
    let main_line = &main_track.lines[pair.main_row];
    let aux_line = &aux_track.lines[pair.aux_row];

    if pair.drift_ms.unsigned_abs() as u32 <= 50 {
        return true;
    }
    if main_line.cluster_index.is_some() && main_line.cluster_index == aux_line.cluster_index {
        return true;
    }
    if matches!(
        aux_line.role_source,
        Some(ClassificationConfidence::Explicit | ClassificationConfidence::ParserNative)
    ) {
        return true;
    }

    alignment.main_coverage >= 0.75 && alignment.aux_coverage >= 0.75 && pair.drift_ms.unsigned_abs() as u32 <= 300
}

/// 罗马音逐字：主行逐字自带罗马音时直接摘取；否则整段取自罗马音行。
fn roman_words_for(
    main_line: &LyricTrackLine,
    roman_line: Option<&LyricTrackLine>,
) -> Option<Vec<ParsedWord>> {
    if let Some(main_words) = &main_line.words {
        if main_words.iter().any(|word| {
            word.roman_text
                .as_ref()
                .map(|text| !text.is_empty())
                .unwrap_or(false)
        }) {
            let roman_words = main_words
                .iter()
                .filter_map(|word| {
                    word.roman_text
                        .as_ref()
                        .filter(|text| !text.is_empty())
                        .map(|text| ParsedWord {
                            text: text.clone(),
                            start_ms: word.start_ms,
                            end_ms: word.end_ms,
                            roman_text: None,
                        })
                })
                .collect::<Vec<_>>();
            if !roman_words.is_empty() {
                return Some(roman_words);
            }
        }
    }

    // 逐词级精确对齐在此并不增值（两种取法产物一致），按原样保留罗马音行逐字。
    main_line.words.as_ref()?;
    let roman_words = roman_line?.words.as_ref()?;
    Some(roman_words.clone())
}

/// 附加文本去重追加；空串直接忽略。
fn append_distinct_secondary(secondary_texts: &mut Option<Vec<String>>, text: String) {
    if text.is_empty() {
        return;
    }
    let values = secondary_texts.get_or_insert_with(Vec::new);
    if !values.iter().any(|value| value == &text) {
        values.push(text);
    }
}

/// 该行能否充当日文主行的罗马音。
fn romaji_slot_accepts(
    main_line: &LyricTrackLine,
    candidate_track: &LyricTrack,
    candidate_line: &LyricTrackLine,
) -> bool {
    if matches!(
        candidate_track.role,
        LyricTrackRole::Romanization | LyricTrackRole::Secondary
    ) && candidate_line.explicit_role == Some(super::model::ExplicitLineRole::Roman)
    {
        return true;
    }
    if candidate_track.role == LyricTrackRole::Romanization {
        return true;
    }
    if candidate_line.script_profile.dominant_script != DominantScript::Latin {
        return false;
    }
    if main_line.script_profile.dominant_script == DominantScript::Latin
        && !kana_flavored(&main_line.script_profile)
    {
        return false;
    }

    let englishness = english_likeness(&candidate_line.text);
    let romanization = romanized_likeness(&candidate_line.text);

    romanization >= englishness
        || (candidate_line.source_index < main_line.source_index
            && romanization + 0.08 >= englishness)
}

/// 角色修复候选轨：角色未定或属于次级/备选主轨。
fn is_repair_role_track(track: &LyricTrack) -> bool {
    matches!(
        track.role,
        LyricTrackRole::Unknown | LyricTrackRole::Secondary | LyricTrackRole::AlternateMain
    )
}

/// 该行能否充当主行的译文。
fn translation_slot_accepts(
    main_line: &LyricTrackLine,
    candidate_track: &LyricTrack,
    candidate_line: &LyricTrackLine,
) -> bool {
    if matches!(
        candidate_track.role,
        LyricTrackRole::Translation | LyricTrackRole::Secondary
    ) && candidate_line.explicit_role == Some(super::model::ExplicitLineRole::Translation)
    {
        return true;
    }
    if candidate_track.role == LyricTrackRole::Translation {
        return true;
    }
    if main_line.script_profile.dominant_script == DominantScript::Latin {
        return candidate_line.script_profile.dominant_script != DominantScript::Latin
            || (candidate_line.source_index > main_line.source_index
                && plain_han_profile(&candidate_line.script_profile));
    }
    if candidate_line.script_profile.dominant_script == DominantScript::Latin {
        return false;
    }
    if candidate_line.source_index > main_line.source_index {
        return true;
    }

    candidate_line.script_profile.dominant_script == DominantScript::Han
        && kana_flavored(&main_line.script_profile)
}

/// 日文假名辅助行在主行为纯拉丁时可以升格为主行。
fn kana_aux_promotable(current_main_line: &LyricTrackLine, candidate_line: &LyricTrackLine) -> bool {
    current_main_line.script_profile.dominant_script == DominantScript::Latin
        && kana_flavored(&candidate_line.script_profile)
        && current_main_line.cluster_index.is_some()
        && current_main_line.cluster_index == candidate_line.cluster_index
}

/// 把一条辅轨行并入语义行：优先罗马音位，其次译文位，最后进附加文本。
fn absorb_auxiliary(
    semantic_line: &mut SemanticLine,
    main_line: &LyricTrackLine,
    candidate_track: &LyricTrack,
    candidate_line: &LyricTrackLine,
) {
    if candidate_line.text == semantic_line.main_text {
        return;
    }

    if semantic_line.roman_text.is_none()
        && romaji_slot_accepts(main_line, candidate_track, candidate_line)
    {
        semantic_line.roman_text = Some(candidate_line.text.clone());
        semantic_line.roman_words = roman_words_for(main_line, Some(candidate_line));
        return;
    }

    if semantic_line.translation_text.is_none()
        && translation_slot_accepts(main_line, candidate_track, candidate_line)
    {
        semantic_line.translation_text = Some(candidate_line.text.clone());
        return;
    }

    append_distinct_secondary(
        &mut semantic_line.secondary_texts,
        candidate_line.text.clone(),
    );
}

/// 孤立簇中主行候选的评分：脚本亲和、词级、来源位次与显示轨身份共同决定。
#[allow(clippy::too_many_lines)]
fn orphan_main_score(
    document: &LyricDocument,
    main_track: &LyricTrack,
    candidate_track: &LyricTrack,
    candidate_line: &LyricTrackLine,
    group: &[(usize, usize, LyricTrackLine)],
) -> f64 {
    let mut sorted_source_indexes = group
        .iter()
        .map(|(_, _, line)| line.source_index)
        .collect::<Vec<_>>();
    sorted_source_indexes.sort_by(|left, right| source_index_order(*left, *right));
    let median_source_index = sorted_source_indexes[sorted_source_indexes.len() / 2];

    let englishness = english_likeness(&candidate_line.text);
    let romanization = romanized_likeness(&candidate_line.text);
    let has_japanese_like_peer = group
        .iter()
        .any(|(_, _, line)| kana_flavored(&line.script_profile));
    let has_latin_peer = group
        .iter()
        .any(|(_, _, line)| line.script_profile.dominant_script == DominantScript::Latin);
    let has_han_peer = group
        .iter()
        .any(|(_, _, line)| line.script_profile.dominant_script == DominantScript::Han);
    let has_non_romaji_english_latin_peer = group.iter().any(|(_, _, line)| {
        line.script_profile.dominant_script == DominantScript::Latin
            && native_english_text(&line.text)
    });
    let first_non_latin_source_index = group
        .iter()
        .filter(|(_, _, line)| line.script_profile.dominant_script != DominantScript::Latin)
        .map(|(_, _, line)| line.source_index)
        .min_by(|left, right| source_index_order(*left, *right));

    let mut score = 0.0;
    score += (2.8 - ((candidate_line.source_index - median_source_index).abs() * 2.2)).max(-1.4);
    score += if candidate_line.explicit_role.is_none() {
        1.0
    } else {
        -1.0
    };
    score += if candidate_line
        .words
        .as_ref()
        .map(|words| !words.is_empty())
        .unwrap_or(false)
    {
        0.8
    } else {
        0.0
    };
    score += if family_of(&candidate_line.script_profile.dominant_script)
        == family_of(&main_track.dominant_script)
    {
        0.9
    } else {
        0.0
    };

    match candidate_track.role {
        LyricTrackRole::Main | LyricTrackRole::AlternateMain => score += 1.2,
        LyricTrackRole::Unknown | LyricTrackRole::Secondary => score += 0.4,
        LyricTrackRole::Translation | LyricTrackRole::Romanization => score -= 0.6,
        LyricTrackRole::Background | LyricTrackRole::Metadata => score -= 2.4,
    }

    if track_kana_flavored(main_track) && kana_flavored(&candidate_line.script_profile) {
        score += 2.2;
    }
    if has_japanese_like_peer {
        if kana_flavored(&candidate_line.script_profile) {
            score += 2.2;
        } else if candidate_line.script_profile.dominant_script == DominantScript::Han {
            score -= 2.2;
        }
    }
    if candidate_line.script_profile.dominant_script == DominantScript::Latin {
        if englishness >= romanization + 0.12 {
            score += 1.8;
        } else if romanization >= englishness + 0.08 {
            score -= 1.4;
        }
        if has_han_peer && english_phrase_like(&candidate_line.text) {
            score += 3.2;
        }
        if has_han_peer
            && !has_japanese_like_peer
            && native_english_text(&candidate_line.text)
        {
            score += 4.2;
        }
    } else if has_latin_peer {
        if let Some(first_non_latin_source_index) = first_non_latin_source_index {
            if (candidate_line.source_index - first_non_latin_source_index).abs() < 0.01 {
                score += 2.4;
            } else {
                score -= 1.4;
            }
        }
        if candidate_line.script_profile.dominant_script == DominantScript::Han
            && !has_japanese_like_peer
            && has_non_romaji_english_latin_peer
        {
            score -= 2.4;
        }
    }
    if candidate_line.script_profile.dominant_script == DominantScript::Han
        && track_kana_flavored(main_track)
        && has_japanese_like_peer
    {
        score -= 0.8;
    }
    if document
        .display_track_id
        .as_ref()
        .map(|track_id| track_id == &candidate_track.id)
        .unwrap_or(false)
    {
        score += 0.8;
    }

    score
}

/// 从孤立簇构建语义行：先按评分挑主行，再把其余行并入罗马音/译文/附加位。
fn semantic_from_orphans(
    document: &LyricDocument,
    main_track: &LyricTrack,
    group: &[(usize, usize, LyricTrackLine)],
) -> SemanticLine {
    let scored = group
        .iter()
        .map(|(track_index, _, line)| {
            orphan_main_score(document, main_track, &document.tracks[*track_index], line, group)
        })
        .collect::<Vec<_>>();
    let main_candidate = group
        .iter()
        .enumerate()
        .max_by(|(left_index, _), (right_index, _)| {
            scored[*left_index]
                .partial_cmp(&scored[*right_index])
                .unwrap_or(Ordering::Equal)
        })
        .map(|(_, entry)| entry.clone());

    let (main_track_index, _main_row, main_line) = match main_candidate {
        Some(entry) => entry,
        None => {
            return SemanticLine {
                start_ms: 0,
                end_ms: 0,
                main_text: String::new(),
                main_words: None,
                translation_text: None,
                roman_text: None,
                roman_words: None,
                secondary_texts: None,
                confidence: ClassificationConfidence::Heuristic,
                speaker: None,
                is_bg: false,
                is_duet: false,
                is_duet_partner: false,
            }
        }
    };

    let mut semantic_line = SemanticLine {
        start_ms: main_line.start_ms,
        end_ms: main_line.end_ms,
        main_text: main_line.text.clone(),
        main_words: main_line.words.clone(),
        translation_text: None,
        roman_text: None,
        roman_words: None,
        secondary_texts: None,
        confidence: pick_confidence(&[Some(&main_line)]),
        speaker: main_line.speaker.clone(),
        is_bg: main_line.is_bg,
        is_duet: main_line.is_duet,
        is_duet_partner: main_line.is_duet_partner,
    };

    for (track_index, _row, candidate_line) in group.iter() {
        if *track_index == main_track_index && candidate_line.id == main_line.id {
            continue;
        }
        absorb_auxiliary(
            &mut semantic_line,
            &main_line,
            &document.tracks[*track_index],
            candidate_line,
        );
    }

    semantic_line.confidence = pick_confidence(
        &group
            .iter()
            .map(|(_, _, line)| Some(line))
            .collect::<Vec<_>>(),
    );
    semantic_line
}

/// 展示角色仲裁：英文短语行 / 日文化译文行可以升为主行。
fn choose_display_roles<'a>(
    main_line: &'a LyricTrackLine,
    translation_line: Option<&'a LyricTrackLine>,
    roman_line: Option<&'a LyricTrackLine>,
) -> (
    &'a LyricTrackLine,
    Option<&'a LyricTrackLine>,
    Option<&'a LyricTrackLine>,
) {
    if let Some(translation_line) = translation_line {
        if translation_line.script_profile.dominant_script == DominantScript::Latin
            && main_line.script_profile.dominant_script != DominantScript::Latin
            && english_phrase_like(&translation_line.text)
        {
            return (translation_line, Some(main_line), None);
        }
    }

    if let Some(roman_line) = roman_line {
        if roman_line.script_profile.dominant_script == DominantScript::Latin
            && main_line.script_profile.dominant_script != DominantScript::Latin
            && english_phrase_like(&roman_line.text)
        {
            return (roman_line, Some(main_line), None);
        }
    }

    if main_line.script_profile.dominant_script == DominantScript::Han {
        if let Some(translation_line) = translation_line {
            if kana_flavored(&translation_line.script_profile) {
                return (translation_line, Some(main_line), roman_line);
            }
        }
    }

    (main_line, translation_line, roman_line)
}

/// 展示角色善后：主文本非拉丁、缺译文且罗马音是英文短语时，把罗马音升为主行。
fn rebalance_display_roles(mut line: SemanticLine) -> SemanticLine {
    let main_is_latin =
        measure_script(&line.main_text).dominant_script == DominantScript::Latin;
    let translation_is_missing = line
        .translation_text
        .as_ref()
        .map(|text| text.trim().is_empty())
        .unwrap_or(true);
    let romaji_is_english_phrase = line
        .roman_text
        .as_ref()
        .map(|text| english_phrase_like(text))
        .unwrap_or(false);

    if !main_is_latin && translation_is_missing && romaji_is_english_phrase {
        if let Some(english_text) = line.roman_text.take() {
            line.translation_text = Some(line.main_text.clone());
            line.main_text = english_text;
            line.main_words = line.roman_words.take();
        }
    }

    line
}

fn han_only_row(line: &LyricTrackLine) -> bool {
    line.script_profile.han_count > 0
        && line.script_profile.latin_count == 0
        && line.script_profile.kana_count == 0
        && line.script_profile.hangul_count == 0
}

fn han_latin_mixed_row(line: &LyricTrackLine) -> bool {
    line.script_profile.han_count > 0
        && line.script_profile.latin_count > 0
        && line.script_profile.kana_count == 0
        && line.script_profile.hangul_count == 0
}

fn latin_only_row(line: &LyricTrackLine) -> bool {
    line.script_profile.latin_count > 0
        && line.script_profile.han_count == 0
        && line.script_profile.kana_count == 0
        && line.script_profile.hangul_count == 0
}

fn semantic_from_roles(
    main_line: &LyricTrackLine,
    translation_line: Option<&LyricTrackLine>,
    roman_line: Option<&LyricTrackLine>,
) -> SemanticLine {
    SemanticLine {
        start_ms: main_line.start_ms,
        end_ms: main_line.end_ms,
        main_text: main_line.text.clone(),
        main_words: main_line.words.clone(),
        translation_text: translation_line.map(|line| line.text.clone()),
        roman_text: roman_line.map(|line| line.text.clone()),
        roman_words: roman_words_for(main_line, roman_line),
        secondary_texts: None,
        confidence: pick_confidence(&[Some(main_line), translation_line, roman_line]),
        speaker: main_line.speaker.clone(),
        is_bg: main_line.is_bg,
        is_duet: main_line.is_duet,
        is_duet_partner: main_line.is_duet_partner,
    }
}

/// 硬角色装配：簇内 1-3 行按槽位顺序静态分工，同文行去重。
fn assemble_fixed_roles_from_cluster(
    group: &[(usize, usize, LyricTrackLine)],
) -> Option<SemanticLine> {
    let mut rows = group
        .iter()
        .map(|(_, _, line)| line)
        .collect::<Vec<&LyricTrackLine>>();
    rows.sort_by(|left, right| {
        left.slot_index
            .unwrap_or(usize::MAX)
            .cmp(&right.slot_index.unwrap_or(usize::MAX))
            .then_with(|| source_index_order(left.source_index, right.source_index))
            .then_with(|| left.start_ms.cmp(&right.start_ms))
    });

    match rows.as_slice() {
        [main_line] => Some(semantic_from_roles(main_line, None, None)),
        [first_line, second_line] => {
            let (main_line, translation_line) =
                if han_only_row(first_line) && !han_only_row(second_line) {
                    (*second_line, *first_line)
                } else if han_only_row(second_line) && !han_only_row(first_line) {
                    (*first_line, *second_line)
                } else if han_latin_mixed_row(first_line) && latin_only_row(second_line) {
                    (*second_line, *first_line)
                } else if han_latin_mixed_row(second_line) && latin_only_row(first_line) {
                    (*first_line, *second_line)
                } else {
                    (*first_line, *second_line)
                };

            if tidy_line(&main_line.text) == tidy_line(&translation_line.text) {
                Some(semantic_from_roles(main_line, None, None))
            } else {
                Some(semantic_from_roles(main_line, Some(translation_line), None))
            }
        }
        [roman_line, main_line, translation_line] => {
            let translation = if tidy_line(&main_line.text) == tidy_line(&translation_line.text) {
                None
            } else {
                Some(*translation_line)
            };
            Some(semantic_from_roles(
                main_line,
                translation,
                Some(roman_line),
            ))
        }
        _ => None,
    }
}

/// 硬角色路径：全部行都已聚簇、且每个簇不超过 3 行时，按簇静态装配。
fn fixed_role_document(document: &LyricDocument) -> Option<Vec<SemanticLine>> {
    let mut grouped_lines = BTreeMap::<usize, Vec<(usize, usize, LyricTrackLine)>>::new();
    let mut clustered_line_count = 0usize;
    let total_line_count = document
        .tracks
        .iter()
        .map(|track| track.lines.len())
        .sum::<usize>();

    for (track_index, track) in document.tracks.iter().enumerate() {
        for (line_index, line) in track.lines.iter().enumerate() {
            let Some(cluster_index) = line.cluster_index else {
                continue;
            };
            clustered_line_count += 1;
            grouped_lines
                .entry(cluster_index)
                .or_default()
                .push((track_index, line_index, line.clone()));
        }
    }

    if grouped_lines.is_empty()
        || clustered_line_count != total_line_count
        || !grouped_lines
            .values()
            .any(|group| matches!(group.len(), 2 | 3))
        || grouped_lines.values().any(|group| group.len() > 3)
    {
        return None;
    }

    let mut semantic_lines = grouped_lines
        .values()
        .map(|group| assemble_fixed_roles_from_cluster(group))
        .collect::<Option<Vec<_>>>()?;

    semantic_lines.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then_with(|| left.end_ms.cmp(&right.end_ms))
    });
    Some(semantic_lines)
}

fn romaji_text_of(line: &SemanticLine) -> String {
    if let Some(text) = line.roman_text.as_ref() {
        return text.clone();
    }
    line.roman_words
        .as_ref()
        .map(|words| {
            words
                .iter()
                .map(|word| word.text.clone())
                .collect::<String>()
        })
        .unwrap_or_default()
}

/// 把轨道文档折算成语义行：优先硬角色簇，否则按译文/罗马音/修复轨逐行挂载，
/// 未挂上的行按簇合并成孤立语义行，最后按时间排序并去重。
pub fn lyric_document_to_semantic_lines(document: &LyricDocument) -> Vec<SemanticLine> {
    if let Some(semantic_lines) = fixed_role_document(document) {
        return semantic_lines;
    }

    let display_track_id = document.display_track_id.clone().unwrap_or_default();
    let Some(main_track) = document
        .tracks
        .iter()
        .find(|track| track.id == display_track_id)
        .or_else(|| {
            document
                .tracks
                .iter()
                .find(|track| track.role == LyricTrackRole::Main)
        })
    else {
        return Vec::new();
    };

    let alignments = document
        .tracks
        .iter()
        .map(|track| align_tracks(main_track, track))
        .collect::<Vec<_>>();

    let translation_tracks = document
        .tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| track.role == LyricTrackRole::Translation)
        .collect::<Vec<_>>();
    let roman_tracks = document
        .tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| track.role == LyricTrackRole::Romanization)
        .collect::<Vec<_>>();
    let secondary_tracks = document
        .tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| is_repair_role_track(track))
        .collect::<Vec<_>>();

    let mut attached_line_keys: Vec<(usize, usize)> = Vec::new();
    let mut semantic_lines = Vec::new();
    let mut semantic_line_clusters = Vec::new();

    for (main_index, main_line) in main_track.lines.iter().enumerate() {
        let translation_entry = translation_tracks.iter().find_map(|(track_index, track)| {
            alignments[*track_index]
                .pairs
                .iter()
                .find(|pair| {
                    pair.main_row == main_index
                        && pair_is_attachable(
                            main_track,
                            track,
                            &alignments[*track_index],
                            pair,
                        )
                })
                .map(|pair| (*track_index, pair.aux_row))
        });
        let roman_entry = roman_tracks.iter().find_map(|(track_index, track)| {
            alignments[*track_index]
                .pairs
                .iter()
                .find(|pair| {
                    pair.main_row == main_index
                        && pair_is_attachable(
                            main_track,
                            track,
                            &alignments[*track_index],
                            pair,
                        )
                })
                .map(|pair| (*track_index, pair.aux_row))
        });

        let translation_line = translation_entry.and_then(|(track_index, aux_index)| {
            attached_line_keys.push((track_index, aux_index));
            document.tracks[track_index].lines.get(aux_index)
        });
        let roman_line = roman_entry.and_then(|(track_index, aux_index)| {
            attached_line_keys.push((track_index, aux_index));
            document.tracks[track_index].lines.get(aux_index)
        });
        let (mut display_main_line, display_translation_line, mut display_roman_line) =
            choose_display_roles(main_line, translation_line, roman_line);

        let mut fallback_translation_line: Option<&LyricTrackLine> = None;
        let mut secondary_texts = Vec::new();
        for (track_index, track) in &secondary_tracks {
            let Some(pair) = alignments[*track_index].pairs.iter().find(|pair| {
                pair.main_row == main_index
                    && pair_is_attachable(main_track, track, &alignments[*track_index], pair)
            }) else {
                continue;
            };
            attached_line_keys.push((*track_index, pair.aux_row));

            let Some(line) = track.lines.get(pair.aux_row) else {
                continue;
            };

            if display_translation_line.is_none()
                && fallback_translation_line.is_none()
                && line.script_profile.dominant_script == DominantScript::Han
                && translation_slot_accepts(display_main_line, track, line)
            {
                fallback_translation_line = Some(line);
            } else if kana_aux_promotable(display_main_line, line) {
                display_roman_line = Some(display_main_line);
                display_main_line = line;
            } else if display_roman_line.is_none()
                && romaji_slot_accepts(display_main_line, track, line)
            {
                display_roman_line = Some(line);
            } else {
                secondary_texts.push(line.text.clone());
            }
        }
        let resolved_translation_line = display_translation_line.or(fallback_translation_line);

        semantic_lines.push(rebalance_display_roles(SemanticLine {
            start_ms: display_main_line.start_ms,
            end_ms: display_main_line.end_ms,
            main_text: display_main_line.text.clone(),
            main_words: display_main_line.words.clone(),
            translation_text: resolved_translation_line.map(|line| line.text.clone()),
            roman_text: display_roman_line.map(|line| line.text.clone()),
            roman_words: roman_words_for(display_main_line, display_roman_line),
            secondary_texts: if secondary_texts.is_empty() {
                None
            } else {
                Some(secondary_texts)
            },
            confidence: pick_confidence(&[
                Some(display_main_line),
                resolved_translation_line,
                display_roman_line,
            ]),
            speaker: display_main_line.speaker.clone(),
            is_bg: display_main_line.is_bg,
            is_duet: display_main_line.is_duet,
            is_duet_partner: display_main_line.is_duet_partner,
        }));
        semantic_line_clusters.push(main_line.cluster_index);
    }

    let mut orphan_groups = BTreeMap::<Option<usize>, Vec<(usize, usize, LyricTrackLine)>>::new();
    for (track_index, track) in document.tracks.iter().enumerate() {
        if track.id == main_track.id {
            continue;
        }

        for (line_index, line) in track.lines.iter().enumerate() {
            if attached_line_keys.contains(&(track_index, line_index)) {
                continue;
            }

            orphan_groups
                .entry(line.cluster_index)
                .or_default()
                .push((track_index, line_index, line.clone()));
        }
    }

    for (cluster_index, group) in orphan_groups {
        if let Some(existing_index) = cluster_index.and_then(|cluster| {
            semantic_line_clusters
                .iter()
                .position(|value| *value == Some(cluster))
        }) {
            let existing_main_text = semantic_lines[existing_index].main_text.clone();
            let existing_main_line = document
                .tracks
                .iter()
                .flat_map(|track| track.lines.iter())
                .find(|line| line.cluster_index == cluster_index && line.text == existing_main_text)
                .cloned();

            if let Some(existing_main_line) = existing_main_line {
                for (track_index, _line_index, line) in group {
                    absorb_auxiliary(
                        &mut semantic_lines[existing_index],
                        &existing_main_line,
                        &document.tracks[track_index],
                        &line,
                    );
                }
                continue;
            }
        }

        semantic_lines.push(rebalance_display_roles(semantic_from_orphans(
            document,
            main_track,
            &group,
        )));
    }

    semantic_lines.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then_with(|| left.end_ms.cmp(&right.end_ms))
    });
    semantic_lines
        .into_iter()
        .fold(Vec::<SemanticLine>::new(), |mut acc, line| {
            let is_duplicate = acc
                .last()
                .map(|previous| {
                    previous.start_ms == line.start_ms
                        && previous.end_ms == line.end_ms
                        && previous.main_text == line.main_text
                })
                .unwrap_or(false);
            if !is_duplicate {
                acc.push(line);
            }
            acc
        })
}

/// 语义行 → 前端行载荷：逐词罗马音按起止时间精确匹配回填。
pub fn semantic_line_to_lyric_line(line: &SemanticLine) -> LyricLinePayload {
    let words = line
        .main_words
        .as_ref()
        .map(|main_words| {
            main_words
                .iter()
                .map(|word| {
                    let timed_romaji = line.roman_words.as_ref().and_then(|roman_words| {
                        roman_words.iter().find(|roman_word| {
                            roman_word.start_ms == word.start_ms
                                && roman_word.end_ms == word.end_ms
                        })
                    });

                    LyricWordPayload {
                        text: word.text.clone(),
                        start: word.start_ms as f64 / 1000.0,
                        end: word.end_ms as f64 / 1000.0,
                        romaji: timed_romaji
                            .map(|roman_word| roman_word.text.clone())
                            .or_else(|| word.roman_text.clone())
                            .filter(|text| !text.is_empty()),
                    }
                })
                .collect::<Vec<_>>()
        })
        .filter(|words| !words.is_empty());

    LyricLinePayload {
        time: line.start_ms as f64 / 1000.0,
        end_time: line.end_ms as f64 / 1000.0,
        text: line.main_text.clone(),
        translation: line.translation_text.clone().unwrap_or_default(),
        romaji: romaji_text_of(line),
        words,
        romaji_words: line
            .roman_words
            .as_ref()
            .map(|roman_words| {
                roman_words
                    .iter()
                    .map(|word| LyricWordPayload {
                        text: word.text.clone(),
                        start: word.start_ms as f64 / 1000.0,
                        end: word.end_ms as f64 / 1000.0,
                        romaji: None,
                    })
                    .collect::<Vec<_>>()
            })
            .filter(|words| !words.is_empty()),
        secondary: line.secondary_texts.clone(),
        speaker: line.speaker.clone(),
        is_bg: line.is_bg,
        is_duet: line.is_duet,
        is_duet_partner: line.is_duet_partner,
    }
}

/// 对外入口：原始歌词文本 → 解析 → 轨道文档 → 语义行 → 展示行载荷。
pub fn build_structured_lyrics_payload(raw_lyrics: String) -> StructuredLyricsPayload {
    let parsed_lines = dissect_source(&raw_lyrics);
    let meta = read_meta_tags(&raw_lyrics);
    let document = build_lyric_document(&parsed_lines);
    let semantic_lines = document
        .as_ref()
        .map(lyric_document_to_semantic_lines)
        .unwrap_or_default();
    let display_lines = semantic_lines
        .iter()
        .map(semantic_line_to_lyric_line)
        .collect::<Vec<_>>();

    StructuredLyricsPayload {
        raw_lyrics,
        meta,
        document,
        semantic_lines,
        display_lines,
    }
}
