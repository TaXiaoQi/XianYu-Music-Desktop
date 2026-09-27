// 歌词领域的数据模型与通用数值小工具。
// 本文件中的公开类型属于前后端冻结契约：类型名、字段名与 serde 改写规则一律保持原样。

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ParsedLineSourceFormat {
    Lrc,
    EnhancedLrc,
    Eslrc,
    Yrc,
    Qrc,
    Lys,
    Ttml,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExplicitLineRole {
    Translation,
    Roman,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ClassificationConfidence {
    Explicit,
    ParserNative,
    Heuristic,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DominantScript {
    Latin,
    Han,
    Kana,
    Hangul,
    Mixed,
    Other,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LyricTrackRole {
    Main,
    Translation,
    Romanization,
    Secondary,
    AlternateMain,
    #[allow(dead_code)]
    Background,
    #[allow(dead_code)]
    Metadata,
    Unknown,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LyricTimingMode {
    Line,
    Word,
    #[allow(dead_code)]
    Syllable,
    None,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LyricTrackSourceFormat {
    Mixed,
    Lrc,
    EnhancedLrc,
    Eslrc,
    Yrc,
    Qrc,
    Lys,
    Ttml,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ParsedWord {
    pub text: String,
    pub start_ms: u32,
    pub end_ms: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roman_text: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLine {
    pub start_ms: u32,
    pub end_ms: u32,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<ParsedWord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translated_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roman_text: Option<String>,
    pub source_format: ParsedLineSourceFormat,
    pub source_index: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explicit_role: Option<ExplicitLineRole>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    pub is_bg: bool,
    pub is_duet: bool,
    pub is_duet_partner: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LineScriptProfile {
    pub latin_count: u32,
    pub han_count: u32,
    pub kana_count: u32,
    pub hangul_count: u32,
    pub dominant_script: DominantScript,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricTrackLine {
    pub id: String,
    pub start_ms: u32,
    pub end_ms: u32,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<ParsedWord>>,
    pub source_index: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explicit_role: Option<ExplicitLineRole>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_source: Option<ClassificationConfidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_index: Option<usize>,
    pub source_format: ParsedLineSourceFormat,
    pub script_profile: LineScriptProfile,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    pub is_bg: bool,
    pub is_duet: bool,
    pub is_duet_partner: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricTrackAttachment {
    pub track_id: String,
    pub role: LyricTrackRole,
    pub confidence: f64,
    pub line_match_ratio: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct LyricTrackScores {
    pub main: f64,
    pub translation: f64,
    pub romanization: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricTrack {
    pub id: String,
    pub role: LyricTrackRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    pub timing_mode: LyricTimingMode,
    pub source_format: LyricTrackSourceFormat,
    pub confidence: f64,
    pub dominant_script: DominantScript,
    pub lines: Vec<LyricTrackLine>,
    pub attachments: Vec<LyricTrackAttachment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scores: Option<LyricTrackScores>,
}

#[derive(Serialize, Clone, Debug)]
pub struct LyricIssue {
    pub code: String,
    pub message: String,
    pub severity: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricDocumentMetadata {
    pub total_lines: usize,
    pub source_formats: Vec<ParsedLineSourceFormat>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricDocument {
    pub metadata: LyricDocumentMetadata,
    pub tracks: Vec<LyricTrack>,
    pub issues: Vec<LyricIssue>,
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_track_id: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLine {
    pub start_ms: u32,
    pub end_ms: u32,
    pub main_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_words: Option<Vec<ParsedWord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roman_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roman_words: Option<Vec<ParsedWord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_texts: Option<Vec<String>>,
    pub confidence: ClassificationConfidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    pub is_bg: bool,
    pub is_duet: bool,
    pub is_duet_partner: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct LyricWordPayload {
    pub text: String,
    pub start: f64,
    pub end: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub romaji: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricLinePayload {
    pub time: f64,
    pub end_time: f64,
    pub text: String,
    pub translation: String,
    pub romaji: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<LyricWordPayload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub romaji_words: Option<Vec<LyricWordPayload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    pub is_bg: bool,
    pub is_duet: bool,
    pub is_duet_partner: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LyricsMeta {
    pub offset_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub re: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ve: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StructuredLyricsPayload {
    pub raw_lyrics: String,
    pub meta: LyricsMeta,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<LyricDocument>,
    pub semantic_lines: Vec<SemanticLine>,
    pub display_lines: Vec<LyricLinePayload>,
}

// ---------- 模块内部记账结构（不进入公开 API） ----------

/// 某一种文本格式解析出的整组候选行。
pub(super) struct FormatCandidate {
    pub(super) format: ParsedLineSourceFormat,
    pub(super) rows: Vec<ParsedLine>,
}

/// 主轨与辅助轨之间一对成功对齐的行。
#[derive(Clone, Debug)]
pub(super) struct AlignedPair {
    pub(super) main_row: usize,
    pub(super) aux_row: usize,
    pub(super) drift_ms: i64,
    pub(super) quality: f64,
}

/// 两条轨道之间的完整对齐结果。
#[derive(Clone, Debug, Default)]
pub(super) struct PairAlignment {
    pub(super) pairs: Vec<AlignedPair>,
    pub(super) main_coverage: f64,
    pub(super) aux_coverage: f64,
    pub(super) weighted: f64,
}

/// 某条辅助轨被视作翻译轨 / 罗马音轨的加权得分。
#[derive(Clone, Debug, Default)]
pub(super) struct RolePoints {
    pub(super) main: f64,
    pub(super) translation: f64,
    pub(super) romanization: f64,
}

/// 布局模板命中后的分工方案。
pub(super) struct TemplatePlan {
    pub(super) display_index: usize,
    pub(super) roles: Vec<Option<LyricTrackRole>>,
}

// ---------- 通用小工具 ----------

pub(super) fn bounded01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

pub(super) fn mean_of(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

/// source_index 参与排序时的安全比较（理论上不会出现 NaN，稳妥起见按相等处理）。
pub(super) fn source_index_order(left: f64, right: f64) -> std::cmp::Ordering {
    left.partial_cmp(&right)
        .unwrap_or(std::cmp::Ordering::Equal)
}
