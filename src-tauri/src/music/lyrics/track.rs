// 轨道层：把解析行按时间邻近度聚成簇，再以贪心打分把簇生长成轨道，
// 最后为主轨/译文轨/罗马音轨分工并装配出 LyricDocument。

use std::f64::NEG_INFINITY;

use super::model::{
    bounded01, mean_of, source_index_order, AlignedPair, ClassificationConfidence, DominantScript,
    ExplicitLineRole, LyricDocument, LyricDocumentMetadata, LyricIssue, LyricTimingMode,
    LyricTrack, LyricTrackAttachment, LyricTrackLine, LyricTrackRole, LyricTrackScores,
    LyricTrackSourceFormat, PairAlignment, ParsedLine, ParsedLineSourceFormat, ParsedWord,
    RolePoints, TemplatePlan,
};
use super::script::{
    kana_flavored, measure_script, pick_dominant_script, plain_han_profile, track_kana_flavored,
    track_english_likeness, track_romanized_likeness, word_row_share,
};
use super::text::tidy_line;
use super::vocal::is_production_credit;

/// 同簇行起点允许的最大间隔；仍会被前后行距收紧。
const CLUSTER_TOLERANCE_MS: u32 = 50;
/// 单簇最多容纳的行数（主行 + 译文 + 罗马音）。
const CLUSTER_CAPACITY: usize = 3;
/// 对齐漂移的三档窗口：近 / 中 / 远。
const NEAR_WINDOW_MS: u32 = 300;
const MID_WINDOW_MS: u32 = 800;
const FAR_WINDOW_MS: u32 = 1500;
/// 候选行并入既有轨道的最低信任分。
const MATCH_THRESHOLD: f64 = 2.6;

fn track_format_of(source_format: &ParsedLineSourceFormat) -> LyricTrackSourceFormat {
    match source_format {
        ParsedLineSourceFormat::Lrc => LyricTrackSourceFormat::Lrc,
        ParsedLineSourceFormat::EnhancedLrc => LyricTrackSourceFormat::EnhancedLrc,
        ParsedLineSourceFormat::Eslrc => LyricTrackSourceFormat::Eslrc,
        ParsedLineSourceFormat::Yrc => LyricTrackSourceFormat::Yrc,
        ParsedLineSourceFormat::Qrc => LyricTrackSourceFormat::Qrc,
        ParsedLineSourceFormat::Lys => LyricTrackSourceFormat::Lys,
        ParsedLineSourceFormat::Ttml => LyricTrackSourceFormat::Ttml,
    }
}

fn track_timing_of(lines: &[LyricTrackLine]) -> LyricTimingMode {
    let has_words = lines
        .iter()
        .any(|line| line.words.as_ref().map(|words| !words.is_empty()).unwrap_or(false));
    if has_words {
        return LyricTimingMode::Word;
    }
    if !lines.is_empty() {
        return LyricTimingMode::Line;
    }
    LyricTimingMode::None
}

fn track_script_of(lines: &[LyricTrackLine]) -> DominantScript {
    let mut latin = 0u32;
    let mut han = 0u32;
    let mut kana = 0u32;
    let mut hangul = 0u32;
    for line in lines {
        latin += line.script_profile.latin_count;
        han += line.script_profile.han_count;
        kana += line.script_profile.kana_count;
        hangul += line.script_profile.hangul_count;
    }
    pick_dominant_script(latin, han, kana, hangul)
}

/// 把解析行展开成轨道候选：主行之外，翻译与罗马音拆成独立候选行
/// （source_index 加 0.1 / 0.2 偏移以保持同源顺序）。
fn candidate_track_rows(lines: &[ParsedLine]) -> Vec<LyricTrackLine> {
    let mut candidates = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        if !line.text.is_empty() && !is_production_credit(&line.text) {
            candidates.push(LyricTrackLine {
                id: format!("parsed:{index}:main"),
                start_ms: line.start_ms,
                end_ms: line.end_ms.max(line.start_ms),
                text: line.text.clone(),
                words: line.words.clone(),
                source_index: line.source_index,
                explicit_role: line.explicit_role.clone(),
                role_source: Some(if line.explicit_role.is_some() {
                    ClassificationConfidence::Explicit
                } else {
                    ClassificationConfidence::Heuristic
                }),
                cluster_index: None,
                slot_index: None,
                source_format: line.source_format.clone(),
                script_profile: measure_script(&line.text),
                speaker: line.speaker.clone(),
                is_bg: line.is_bg,
                is_duet: line.is_duet,
                is_duet_partner: line.is_duet_partner,
            });
        }

        let translation = line
            .translated_text
            .as_ref()
            .filter(|text| !text.trim().is_empty());
        if let Some(translation) = translation {
            candidates.push(LyricTrackLine {
                id: format!("parsed:{index}:translation"),
                start_ms: line.start_ms,
                end_ms: line.end_ms.max(line.start_ms),
                text: tidy_line(translation),
                words: None,
                source_index: line.source_index + 0.1,
                explicit_role: Some(ExplicitLineRole::Translation),
                role_source: Some(ClassificationConfidence::ParserNative),
                cluster_index: None,
                slot_index: None,
                source_format: line.source_format.clone(),
                script_profile: measure_script(translation),
                speaker: None,
                is_bg: false,
                is_duet: false,
                is_duet_partner: false,
            });
        }

        let roman_from_words = line.words.as_ref().and_then(|words| {
            let roman_words = words
                .iter()
                .filter_map(|word| {
                    word.roman_text
                        .as_ref()
                        .filter(|text| !text.trim().is_empty())
                        .map(|text| ParsedWord {
                            text: text.clone(),
                            start_ms: word.start_ms,
                            end_ms: word.end_ms,
                            roman_text: None,
                        })
                })
                .collect::<Vec<_>>();
            if roman_words.is_empty() {
                None
            } else {
                Some(roman_words)
            }
        });

        let roman_text = line
            .roman_text
            .clone()
            .filter(|text| !text.trim().is_empty())
            .or_else(|| {
                roman_from_words.as_ref().map(|words| {
                    words
                        .iter()
                        .map(|word| word.text.clone())
                        .collect::<String>()
                })
            });

        if let Some(roman_text) = roman_text.filter(|text| !text.trim().is_empty()) {
            candidates.push(LyricTrackLine {
                id: format!("parsed:{index}:roman"),
                start_ms: line.start_ms,
                end_ms: line.end_ms.max(line.start_ms),
                text: tidy_line(&roman_text),
                words: roman_from_words.clone(),
                source_index: line.source_index + 0.2,
                explicit_role: Some(ExplicitLineRole::Roman),
                role_source: Some(ClassificationConfidence::ParserNative),
                cluster_index: None,
                slot_index: None,
                source_format: line.source_format.clone(),
                script_profile: measure_script(&roman_text),
                speaker: None,
                is_bg: false,
                is_duet: false,
                is_duet_partner: false,
            });
        }
    }

    candidates.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then_with(|| source_index_order(left.source_index, right.source_index))
            .then_with(|| left.end_ms.cmp(&right.end_ms))
    });

    candidates
}

/// 容差取固定上限与前后邻居间距的四分之一三者的最小值，
/// 避免在密集段落把不相关的行聚到一起。
fn cluster_tolerance(
    current_start_ms: u32,
    prev_start_ms: Option<u32>,
    next_start_ms: Option<u32>,
) -> u32 {
    let prev_gap = prev_start_ms
        .map(|start| current_start_ms.abs_diff(start))
        .unwrap_or(u32::MAX);
    let next_gap = next_start_ms
        .map(|start| current_start_ms.abs_diff(start))
        .unwrap_or(u32::MAX);

    CLUSTER_TOLERANCE_MS.min(prev_gap / 4).min(next_gap / 4)
}

/// 沿给定方向找第一个跳出容差带的行起点，作为容差计算的参照。
fn boundary_start_beyond_window(
    lines: &[LyricTrackLine],
    origin_index: usize,
    direction: isize,
) -> Option<u32> {
    let origin_start_ms = lines[origin_index].start_ms;
    let mut index = origin_index as isize + direction;

    while index >= 0 && index < lines.len() as isize {
        let candidate = &lines[index as usize];
        if candidate.start_ms.abs_diff(origin_start_ms) > CLUSTER_TOLERANCE_MS {
            return Some(candidate.start_ms);
        }
        index += direction;
    }

    None
}

/// 同脚本但起点略晚的行应保持分轨（避免把相邻的两句主唱并进同一簇）。
fn script_conflict_blocks_merge(group: &[LyricTrackLine], candidate: &LyricTrackLine) -> bool {
    if candidate.start_ms
        == group
            .first()
            .map(|line| line.start_ms)
            .unwrap_or(candidate.start_ms)
    {
        return false;
    }
    if group.iter().any(|line| line.explicit_role.is_some()) || candidate.explicit_role.is_some() {
        return false;
    }

    if kana_flavored(&candidate.script_profile) {
        return group.iter().any(|line| kana_flavored(&line.script_profile));
    }

    if matches!(
        candidate.script_profile.dominant_script,
        DominantScript::Mixed | DominantScript::Other
    ) {
        return false;
    }

    group
        .iter()
        .any(|line| line.script_profile.dominant_script == candidate.script_profile.dominant_script)
}

fn cluster_by_timestamp(lines: &[LyricTrackLine]) -> Vec<Vec<LyricTrackLine>> {
    if lines.is_empty() {
        return Vec::new();
    }

    let mut groups: Vec<Vec<LyricTrackLine>> = Vec::new();
    let mut group_start_index = 0usize;

    for (index, line) in lines.iter().enumerate() {
        let capacity_reached = groups
            .last()
            .is_some_and(|group| group.len() >= CLUSTER_CAPACITY);
        if groups.is_empty() || capacity_reached {
            groups.push(vec![line.clone()]);
            group_start_index = index;
            continue;
        }
        let current_group = groups.last_mut().expect("当前簇存在且未满");

        let tolerance = cluster_tolerance(
            lines[group_start_index].start_ms,
            boundary_start_beyond_window(lines, group_start_index, -1),
            boundary_start_beyond_window(lines, group_start_index, 1),
        );
        let within_tolerance = line.start_ms.abs_diff(current_group[0].start_ms) <= tolerance;

        if within_tolerance && !script_conflict_blocks_merge(current_group, line) {
            current_group.push(line.clone());
            continue;
        }

        groups.push(vec![line.clone()]);
        group_start_index = index;
    }

    groups
}

/// 轨道内显式角色行占多数时的角色倾向。
fn role_hint_of(track: &LyricTrack) -> Option<LyricTrackRole> {
    let translation_count = track
        .lines
        .iter()
        .filter(|line| line.explicit_role == Some(ExplicitLineRole::Translation))
        .count();
    let romanization_count = track
        .lines
        .iter()
        .filter(|line| line.explicit_role == Some(ExplicitLineRole::Roman))
        .count();

    if translation_count == 0 && romanization_count == 0 {
        return None;
    }

    if translation_count >= romanization_count {
        Some(LyricTrackRole::Translation)
    } else {
        Some(LyricTrackRole::Romanization)
    }
}

/// 主轨与候选行的脚本亲和度：同脚本 > 汉字译文 > 一方混合 > 同家族 > 跨家族。
fn script_affinity(track: &LyricTrack, candidate: &LyricTrackLine) -> f64 {
    if track.dominant_script == candidate.script_profile.dominant_script {
        return 4.0;
    }
    if track.dominant_script == DominantScript::Han && plain_han_profile(&candidate.script_profile)
    {
        return 2.8;
    }
    if matches!(
        track.dominant_script,
        DominantScript::Mixed | DominantScript::Other
    ) || matches!(
        candidate.script_profile.dominant_script,
        DominantScript::Mixed | DominantScript::Other
    ) {
        return 1.2;
    }

    let left = super::script::family_of(&track.dominant_script);
    let right = super::script::family_of(&candidate.script_profile.dominant_script);
    if left == right {
        return 0.8;
    }

    -2.2
}

/// 候选行并入既有轨道的信任分；负无穷表示结构性禁止（同簇回并 / 时光倒流 / 角色冲突）。
fn extension_score(
    track: &LyricTrack,
    candidate: &LyricTrackLine,
    cluster_index: usize,
    slot_index: usize,
) -> f64 {
    let Some(last_line) = track.lines.last() else {
        return 0.0;
    };

    if last_line.cluster_index == Some(cluster_index) || candidate.start_ms <= last_line.start_ms {
        return NEG_INFINITY;
    }

    let track_hint = role_hint_of(track);
    let candidate_hint = match candidate.explicit_role {
        Some(ExplicitLineRole::Translation) => Some(LyricTrackRole::Translation),
        Some(ExplicitLineRole::Roman) => Some(LyricTrackRole::Romanization),
        None => None,
    };
    if track_hint.is_some() && candidate_hint.is_some() && track_hint != candidate_hint {
        return NEG_INFINITY;
    }

    let mut score = 0.0;
    if track_hint.is_some() && track_hint == candidate_hint {
        score += 6.0;
    }
    if track_hint.is_none() && candidate_hint.is_some() {
        score += 1.2;
    }

    score += script_affinity(track, candidate);

    let average_slot = mean_of(
        &track
            .lines
            .iter()
            .map(|line| line.slot_index.unwrap_or(0) as f64)
            .collect::<Vec<_>>(),
    );
    score += (-1.8f64).max(2.2 - ((average_slot - slot_index as f64).abs() * 1.35));

    let average_source_index = mean_of(
        &track
            .lines
            .iter()
            .map(|line| line.source_index)
            .collect::<Vec<_>>(),
    );
    score += (-1.0f64).max(1.4 - ((average_source_index - candidate.source_index).abs() * 0.35));

    let cluster_gap =
        cluster_index.saturating_sub(last_line.cluster_index.unwrap_or(cluster_index));
    score += if cluster_gap == 1 { 1.2 } else { 0.4 };

    let time_gap = candidate.start_ms.saturating_sub(last_line.start_ms);
    if time_gap < 120
        && track.dominant_script == candidate.script_profile.dominant_script
        && candidate.explicit_role.is_none()
    {
        score -= 1.4;
    }

    score
}

/// 按簇顺序贪心生长轨道：簇内逐槽位挑最优轨道并入，不达阈值则新开轨道。
fn grow_tracks(groups: Vec<Vec<LyricTrackLine>>) -> Vec<LyricTrack> {
    let mut tracks: Vec<LyricTrack> = Vec::new();

    for (cluster_index, group) in groups.into_iter().enumerate() {
        let mut used_track_ids: Vec<String> = Vec::new();

        for (slot_index, candidate) in group.into_iter().enumerate() {
            let mut best_track_index = None;
            let mut best_score = NEG_INFINITY;

            for (track_index, track) in tracks.iter().enumerate() {
                if used_track_ids.iter().any(|id| id == &track.id) {
                    continue;
                }

                let score = extension_score(track, &candidate, cluster_index, slot_index);
                if score > best_score {
                    best_score = score;
                    best_track_index = Some(track_index);
                }
            }

            if best_track_index.is_none() || best_score < MATCH_THRESHOLD {
                let mut line = candidate.clone();
                line.cluster_index = Some(cluster_index);
                line.slot_index = Some(slot_index);

                let track = LyricTrack {
                    id: format!("track:{}", tracks.len()),
                    role: LyricTrackRole::Unknown,
                    lang: None,
                    timing_mode: track_timing_of(std::slice::from_ref(&line)),
                    source_format: track_format_of(&line.source_format),
                    confidence: 0.0,
                    dominant_script: line.script_profile.dominant_script.clone(),
                    lines: vec![line],
                    attachments: Vec::new(),
                    scores: None,
                };

                used_track_ids.push(track.id.clone());
                tracks.push(track);
                continue;
            }

            let Some(track) = best_track_index.and_then(|idx| tracks.get_mut(idx)) else {
                continue;
            };
            let mut line = candidate.clone();
            line.cluster_index = Some(cluster_index);
            line.slot_index = Some(slot_index);
            track.lines.push(line);
            track.dominant_script = track_script_of(&track.lines);
            track.source_format = aggregated_track_format(&track.lines);
            track.timing_mode = track_timing_of(&track.lines);
            used_track_ids.push(track.id.clone());
        }
    }

    tracks
}

/// 轨道源格式：全体行一致时取该格式，否则记为 Mixed。
fn aggregated_track_format(lines: &[LyricTrackLine]) -> LyricTrackSourceFormat {
    let mut formats = lines
        .iter()
        .map(|line| track_format_of(&line.source_format))
        .collect::<Vec<_>>();
    formats.dedup();

    if formats.len() == 1 {
        formats[0].clone()
    } else {
        LyricTrackSourceFormat::Mixed
    }
}

/// 对齐质量随漂移衰减：300ms 内满分，800ms / 1500ms 两档递减。
fn pair_quality(drift_ms: i64) -> f64 {
    let abs_drift = drift_ms.unsigned_abs() as u32;
    if abs_drift <= NEAR_WINDOW_MS {
        1.0
    } else if abs_drift <= MID_WINDOW_MS {
        0.72
    } else if abs_drift <= FAR_WINDOW_MS {
        0.42
    } else {
        0.0
    }
}

/// 双指针行对齐：主轨逐行在辅助轨中找漂移最小且落在远窗内的搭档。
pub(super) fn align_tracks(main_track: &LyricTrack, aux_track: &LyricTrack) -> PairAlignment {
    let main_lines = &main_track.lines;
    let aux_lines = &aux_track.lines;
    let mut pairs = Vec::new();
    let mut main_row = 0usize;
    let mut aux_row = 0usize;

    while main_row < main_lines.len() && aux_row < aux_lines.len() {
        let main_line = &main_lines[main_row];
        let mut best_aux_row = None;
        let mut best_drift = i64::MAX;

        for index in aux_row..aux_lines.len() {
            let drift = aux_lines[index].start_ms as i64 - main_line.start_ms as i64;
            if drift.unsigned_abs() as u32 > FAR_WINDOW_MS
                && aux_lines[index].start_ms > main_line.start_ms
            {
                break;
            }
            if drift.unsigned_abs() as u32 > FAR_WINDOW_MS {
                continue;
            }
            if drift.abs() < best_drift.abs() {
                best_drift = drift;
                best_aux_row = Some(index);
            }
        }

        if let Some(found_index) = best_aux_row {
            pairs.push(AlignedPair {
                main_row,
                aux_row: found_index,
                drift_ms: best_drift,
                quality: pair_quality(best_drift),
            });
            main_row += 1;
            aux_row = found_index + 1;
            continue;
        }

        if aux_lines[aux_row].start_ms + FAR_WINDOW_MS < main_line.start_ms {
            aux_row += 1;
        } else {
            main_row += 1;
        }
    }

    let main_coverage = pairs.len() as f64 / main_lines.len().max(1) as f64;
    let aux_coverage = pairs.len() as f64 / aux_lines.len().max(1) as f64;
    let weighted = mean_of(&pairs.iter().map(|pair| pair.quality).collect::<Vec<_>>())
        * main_coverage.min(aux_coverage);

    PairAlignment {
        pairs,
        main_coverage,
        aux_coverage,
        weighted,
    }
}

/// 辅助轨相对主轨的译文/罗马音倾向分。
fn role_points_for_aux(
    main_track: &LyricTrack,
    candidate_track: &LyricTrack,
    alignment: &PairAlignment,
) -> RolePoints {
    let hint = role_hint_of(candidate_track);
    let englishness = track_english_likeness(candidate_track);
    let romanization = track_romanized_likeness(candidate_track);

    let mut translation = alignment.weighted * 0.6;
    let mut roman = alignment.weighted * 0.6;

    if candidate_track.dominant_script != main_track.dominant_script {
        translation += 0.16;
    }
    if candidate_track.dominant_script == DominantScript::Han
        && main_track.dominant_script != DominantScript::Han
    {
        translation += 0.18;
    }
    if candidate_track.dominant_script == DominantScript::Latin && englishness > 0.28 {
        translation += 0.18;
    }
    translation += englishness * 0.22;
    translation -= romanization * 0.3;
    if candidate_track.dominant_script == main_track.dominant_script {
        translation -= 0.18;
    }

    if main_track.dominant_script != DominantScript::Latin
        && candidate_track.dominant_script == DominantScript::Latin
    {
        roman += 0.32;
    } else if main_track.dominant_script == DominantScript::Latin {
        roman -= 0.55;
    } else {
        roman -= 0.15;
    }
    roman += romanization * 0.38;
    roman -= englishness * 0.38;
    if candidate_track.dominant_script != DominantScript::Latin {
        roman -= 0.28;
    }

    if hint == Some(LyricTrackRole::Translation) {
        translation += 0.85;
    }
    if hint == Some(LyricTrackRole::Romanization) {
        roman += 0.85;
    }

    let has_direct_grouped_pair = alignment.pairs.iter().any(|pair| {
        main_track.lines[pair.main_row].cluster_index.is_some()
            && main_track.lines[pair.main_row].cluster_index
                == candidate_track.lines[pair.aux_row].cluster_index
    });
    if alignment.pairs.len() == 1 && !has_direct_grouped_pair && hint.is_none() {
        translation *= 0.5;
        roman *= 0.4;
    }

    RolePoints {
        main: 0.0,
        translation: bounded01(translation),
        romanization: bounded01(roman),
    }
}

/// 主轨与辅助轨对上的行中，来自同一解析源（source_index 同整数部分）的占比。
fn same_row_origin_ratio(
    main_track: &LyricTrack,
    aux_track: &LyricTrack,
    alignment: &PairAlignment,
    role_source: Option<ClassificationConfidence>,
) -> f64 {
    if alignment.pairs.is_empty() {
        return 0.0;
    }

    let matched_pairs = alignment
        .pairs
        .iter()
        .filter(|pair| {
            let main_line = &main_track.lines[pair.main_row];
            let aux_line = &aux_track.lines[pair.aux_row];
            if role_source.is_some() && aux_line.role_source != role_source {
                return false;
            }

            main_line.source_index.floor() as i64 == aux_line.source_index.floor() as i64
        })
        .count();

    matched_pairs as f64 / alignment.pairs.len() as f64
}

/// 主轨候选的综合分：行数规模、词覆盖、槽位靠前、对齐支撑与模板亲缘共同决定。
fn main_track_score(
    candidate_track: &LyricTrack,
    tracks: &[LyricTrack],
    alignments: &[Vec<PairAlignment>],
    track_index: usize,
) -> f64 {
    let max_line_count = tracks
        .iter()
        .map(|track| track.lines.len())
        .max()
        .unwrap_or(1) as f64;
    let max_slot = tracks
        .iter()
        .flat_map(|track| track.lines.iter().map(|line| line.slot_index.unwrap_or(0)))
        .max()
        .unwrap_or(0) as f64;
    let hint = role_hint_of(candidate_track);
    let average_slot = mean_of(
        &candidate_track
            .lines
            .iter()
            .map(|line| line.slot_index.unwrap_or(0) as f64)
            .collect::<Vec<_>>(),
    );
    let average_source_index = mean_of(
        &candidate_track
            .lines
            .iter()
            .map(|line| line.source_index)
            .collect::<Vec<_>>(),
    );
    let word_coverage = word_row_share(candidate_track);

    let mut score = 0.0;
    score += (candidate_track.lines.len() as f64 / max_line_count) * 3.0;
    score += word_coverage * 1.4;
    score += if max_slot > 0.0 {
        (1.0 - (average_slot / max_slot)) * 1.2
    } else {
        1.0
    };

    if matches!(
        hint,
        Some(LyricTrackRole::Translation | LyricTrackRole::Romanization)
    ) {
        score -= 4.0;
    }

    let has_romanized_latin_sibling = tracks.iter().enumerate().any(|(other_index, track)| {
        if other_index == track_index {
            return false;
        }
        let alignment = &alignments[track_index][other_index];
        alignment.weighted >= 0.35
            && track.dominant_script == DominantScript::Latin
            && track_romanized_likeness(track) >= 0.35
    });
    let has_japanese_like_sibling = tracks.iter().enumerate().any(|(other_index, track)| {
        other_index != track_index
            && alignments[track_index][other_index].weighted >= 0.35
            && track_kana_flavored(track)
    });
    let has_any_romanized_latin_track = tracks.iter().any(|track| {
        track.dominant_script == DominantScript::Latin && track_romanized_likeness(track) >= 0.35
    });
    let has_any_japanese_like_track = tracks.iter().any(|track| track_kana_flavored(track));

    let mut attachment_support = 0.0;
    for (other_index, track) in tracks.iter().enumerate() {
        if other_index == track_index {
            continue;
        }
        let alignment = &alignments[track_index][other_index];
        if alignment.weighted < 0.28 {
            continue;
        }
        let points = role_points_for_aux(candidate_track, track, alignment);
        attachment_support += points.translation.max(points.romanization);
    }
    score += attachment_support.min(3.0);

    score += tracks
        .iter()
        .enumerate()
        .filter(|(other_index, _)| *other_index != track_index)
        .map(|(other_index, track)| {
            let alignment = &alignments[track_index][other_index];
            if alignment.weighted < 0.28 {
                0.0
            } else {
                same_row_origin_ratio(
                    candidate_track,
                    track,
                    alignment,
                    Some(ClassificationConfidence::ParserNative),
                ) * 3.2
            }
        })
        .sum::<f64>()
        .min(2.0);

    if candidate_track.dominant_script != DominantScript::Latin && has_romanized_latin_sibling {
        score += 3.2;
    }

    if (has_japanese_like_sibling && has_romanized_latin_sibling)
        || (has_any_japanese_like_track && has_any_romanized_latin_track)
    {
        score += (1.2 - average_slot) * 1.8;
        if track_kana_flavored(candidate_track) {
            score += 4.8;
        } else if candidate_track.dominant_script == DominantScript::Han {
            score -= 5.2;
            if average_source_index > 1.15 {
                score -= 1.2;
            }
        }
    }

    if candidate_track.dominant_script == DominantScript::Latin
        && track_english_likeness(candidate_track) < 0.28
        && track_romanized_likeness(candidate_track) >= 0.28
        && tracks.iter().enumerate().any(|(other_index, track)| {
            other_index != track_index
                && alignments[track_index][other_index].weighted >= 0.45
                && track.dominant_script != DominantScript::Latin
        })
    {
        score -= 4.2;
    }

    score
}

/// 角色确定后的置信度换算。
fn confidence_for_role(role: &LyricTrackRole, points: &RolePoints) -> f64 {
    match role {
        LyricTrackRole::Main => bounded01(points.main / 6.0),
        LyricTrackRole::Translation => points.translation,
        LyricTrackRole::Romanization => points.romanization,
        LyricTrackRole::Secondary => points.translation.max(points.romanization) * 0.7,
        LyricTrackRole::AlternateMain => bounded01(points.main / 6.0),
        _ => 0.25,
    }
}

/// 中文译文轨：纯汉字主导且不带假名。
fn is_chinese_translation_track(track: &LyricTrack) -> bool {
    track.dominant_script == DominantScript::Han && !track_kana_flavored(track)
}

/// 罗马音轨：拉丁主导且罗马音风味压过英文风味。
fn is_romanization_candidate(track: &LyricTrack) -> bool {
    track.dominant_script == DominantScript::Latin
        && track_romanized_likeness(track) >= (track_english_likeness(track) + 0.05).max(0.34)
}

/// 「日文主轨 + 汉译 + 罗马音」三轨模板。
fn template_japanese_with_pair(
    tracks: &[LyricTrack],
    alignments: &[Vec<PairAlignment>],
) -> Option<TemplatePlan> {
    let japanese_candidates = tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| track_kana_flavored(track))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let han_candidates = tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| is_chinese_translation_track(track))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let latin_candidates = tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| is_romanization_candidate(track))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();

    let mut best_resolution = None;
    let mut best_score = NEG_INFINITY;

    for japanese_index in japanese_candidates {
        for han_index in &han_candidates {
            if *han_index == japanese_index {
                continue;
            }
            let translation_alignment = &alignments[japanese_index][*han_index];
            if translation_alignment.weighted < 0.42 {
                continue;
            }

            for latin_index in &latin_candidates {
                if *latin_index == japanese_index || *latin_index == *han_index {
                    continue;
                }
                let roman_alignment = &alignments[japanese_index][*latin_index];
                if roman_alignment.weighted < 0.42 {
                    continue;
                }

                let latin_track = &tracks[*latin_index];
                let score = translation_alignment.weighted
                    + roman_alignment.weighted
                    + (tracks[japanese_index].lines.len() as f64
                        / latin_track.lines.len().max(1) as f64)
                        .min(1.0)
                    + word_row_share(&tracks[japanese_index]) * 0.4
                    + if role_hint_of(latin_track) == Some(LyricTrackRole::Romanization) {
                        0.35
                    } else {
                        0.0
                    };

                if score > best_score {
                    let mut roles = vec![None; tracks.len()];
                    roles[japanese_index] = Some(LyricTrackRole::Main);
                    roles[*han_index] = Some(LyricTrackRole::Translation);
                    roles[*latin_index] = Some(LyricTrackRole::Romanization);
                    best_score = score;
                    best_resolution = Some(TemplatePlan {
                        display_index: japanese_index,
                        roles,
                    });
                }
            }
        }
    }

    best_resolution
}

/// 「主轨 + 译文轨」双轨模板。
fn template_main_with_translation(
    tracks: &[LyricTrack],
    alignments: &[Vec<PairAlignment>],
) -> Option<TemplatePlan> {
    let translation_candidates = tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| is_chinese_translation_track(track))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();

    let mut best_resolution = None;
    let mut best_score = NEG_INFINITY;

    for (main_index, main_track) in tracks.iter().enumerate() {
        let has_japanese_like_sibling = tracks.iter().enumerate().any(|(other_index, track)| {
            other_index != main_index
                && alignments[main_index][other_index].weighted >= 0.4
                && track_kana_flavored(track)
        });

        if is_chinese_translation_track(main_track)
            || (has_japanese_like_sibling && is_romanization_candidate(main_track))
        {
            continue;
        }

        for translation_index in &translation_candidates {
            if *translation_index == main_index {
                continue;
            }
            let alignment = &alignments[main_index][*translation_index];
            if alignment.weighted < 0.42 {
                continue;
            }

            let score = alignment.weighted
                + (main_track.lines.len() as f64
                    / tracks[*translation_index].lines.len().max(1) as f64)
                    .min(1.0)
                + word_row_share(main_track) * 0.35
                + if role_hint_of(&tracks[*translation_index]) == Some(LyricTrackRole::Translation)
                {
                    0.2
                } else {
                    0.0
                };

            if score > best_score {
                let mut roles = vec![None; tracks.len()];
                roles[main_index] = Some(LyricTrackRole::Main);
                roles[*translation_index] = Some(LyricTrackRole::Translation);
                best_score = score;
                best_resolution = Some(TemplatePlan {
                    display_index: main_index,
                    roles,
                });
            }
        }
    }

    best_resolution
}

fn resolve_template(
    tracks: &[LyricTrack],
    alignments: &[Vec<PairAlignment>],
) -> Option<TemplatePlan> {
    if tracks.is_empty() {
        return None;
    }

    if tracks.len() == 1 {
        return Some(TemplatePlan {
            display_index: 0,
            roles: vec![Some(LyricTrackRole::Main)],
        });
    }

    template_japanese_with_pair(tracks, alignments)
        .or_else(|| template_main_with_translation(tracks, alignments))
}

/// 把解析行装配成歌词文档：聚类 → 生长 → 对齐 → 模板/主轨评分 → 角色与附件。
pub fn build_lyric_document(parsed_lines: &[ParsedLine]) -> Option<LyricDocument> {
    let candidate_lines = candidate_track_rows(parsed_lines);
    if candidate_lines.is_empty() {
        return None;
    }

    let groups = cluster_by_timestamp(&candidate_lines);
    let mut tracks = grow_tracks(groups);
    if tracks.is_empty() {
        return None;
    }

    let alignments = (0..tracks.len())
        .map(|main_index| {
            (0..tracks.len())
                .map(|aux_index| {
                    if main_index == aux_index {
                        PairAlignment::default()
                    } else {
                        align_tracks(&tracks[main_index], &tracks[aux_index])
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    let template_resolution = resolve_template(&tracks, &alignments);
    let display_track_index = template_resolution
        .as_ref()
        .map(|resolution| resolution.display_index)
        .unwrap_or_else(|| {
            let mut best_track_index = 0usize;
            let mut best_track_score = NEG_INFINITY;

            for (track_index, track) in tracks.iter().enumerate() {
                let score = main_track_score(track, &tracks, &alignments, track_index);
                if score > best_track_score {
                    best_track_score = score;
                    best_track_index = track_index;
                }
            }

            best_track_index
        });

    for track_index in 0..tracks.len() {
        let main_score = main_track_score(&tracks[track_index], &tracks, &alignments, track_index);
        let template_role = template_resolution
            .as_ref()
            .and_then(|resolution| resolution.roles[track_index].clone());
        if track_index == display_track_index {
            let points = RolePoints {
                main: main_score,
                translation: 0.0,
                romanization: 0.0,
            };
            tracks[track_index].role = LyricTrackRole::Main;
            tracks[track_index].confidence = confidence_for_role(&LyricTrackRole::Main, &points);
            tracks[track_index].scores = Some(LyricTrackScores {
                main: points.main,
                translation: points.translation,
                romanization: points.romanization,
            });
            continue;
        }

        let alignment = &alignments[display_track_index][track_index];
        let mut points = role_points_for_aux(
            &tracks[display_track_index],
            &tracks[track_index],
            alignment,
        );
        points.main = main_score;

        let role = if let Some(role) = template_role {
            role
        } else if alignment.weighted < 0.25 {
            if tracks[track_index].lines.len() as f64
                >= tracks[display_track_index].lines.len() as f64 * 0.6
                && tracks[track_index].dominant_script == tracks[display_track_index].dominant_script
            {
                LyricTrackRole::AlternateMain
            } else {
                LyricTrackRole::Unknown
            }
        } else if points.translation >= 0.58 || points.romanization >= 0.58 {
            if points.translation >= points.romanization {
                LyricTrackRole::Translation
            } else {
                LyricTrackRole::Romanization
            }
        } else {
            LyricTrackRole::Secondary
        };

        tracks[track_index].role = role;
        tracks[track_index].confidence = confidence_for_role(&tracks[track_index].role, &points);
        tracks[track_index].scores = Some(LyricTrackScores {
            main: points.main,
            translation: points.translation,
            romanization: points.romanization,
        });
    }

    let display_track_id = tracks[display_track_index].id.clone();
    let attachments = tracks
        .iter()
        .enumerate()
        .filter(|(track_index, track)| {
            *track_index != display_track_index
                && matches!(
                    track.role,
                    LyricTrackRole::Translation
                        | LyricTrackRole::Romanization
                        | LyricTrackRole::Secondary
                )
        })
        .map(|(track_index, track)| LyricTrackAttachment {
            track_id: track.id.clone(),
            role: track.role.clone(),
            confidence: track.confidence,
            line_match_ratio: alignments[display_track_index][track_index].main_coverage,
        })
        .collect::<Vec<_>>();

    let issues = if tracks.len() > 1 && attachments.is_empty() {
        vec![LyricIssue {
            code: "lyrics.unattached_tracks".to_string(),
            message: "Detected multiple lyric tracks but could not confidently attach any secondary track to the display main track.".to_string(),
            severity: "warning".to_string(),
        }]
    } else {
        Vec::new()
    };
    tracks[display_track_index].attachments = attachments;

    let mut source_formats = candidate_lines
        .iter()
        .map(|line| line.source_format.clone())
        .collect::<Vec<_>>();
    source_formats.sort_by_key(|format| format!("{format:?}"));
    source_formats.dedup();

    let document_confidence = mean_of(
        &tracks
            .iter()
            .map(|track| track.confidence)
            .collect::<Vec<_>>(),
    );

    Some(LyricDocument {
        metadata: LyricDocumentMetadata {
            total_lines: candidate_lines.len(),
            source_formats,
        },
        tracks,
        issues,
        confidence: document_confidence,
        display_track_id: Some(display_track_id),
    })
}
