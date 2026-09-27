// 歌词后端门面。
// 职责分层：text（文本预处理与时间戳）→ format（各格式候选解析）→ vocal（演唱标注）→
// script（文字画像与风格打分）→ track（轨道聚类与角色分工）→ semantic（语义行与对外载荷）。
// model 中的公开类型是前后端冻结契约：类型名、字段名与 serde 改写规则一律保持原样。

mod format;
#[cfg(test)]
mod tests;
mod model;
mod script;
mod semantic;
mod text;
mod track;
mod vocal;

// ---------- 数据契约（字段名冻结） ----------
// music 模块在 crate 内私有，再导出面中部分名称暂无 crate 内消费者；
// 冻结契约要求保留完整公开类型与入口，显式放宽未用导入检查。
#[allow(unused_imports)]
pub use model::{
    ClassificationConfidence, DominantScript, ExplicitLineRole, LineScriptProfile, LyricDocument,
    LyricDocumentMetadata, LyricIssue, LyricLinePayload, LyricTimingMode, LyricTrack,
    LyricTrackAttachment, LyricTrackLine, LyricTrackRole, LyricTrackScores, LyricTrackSourceFormat,
    LyricWordPayload, LyricsMeta, ParsedLine, ParsedLineSourceFormat, ParsedWord, SemanticLine,
    StructuredLyricsPayload,
};

// ---------- 解析与装配入口 ----------
#[allow(unused_imports)]
pub use semantic::{
    build_structured_lyrics_payload, lyric_document_to_semantic_lines, semantic_line_to_lyric_line,
};
#[allow(unused_imports)]
pub use track::build_lyric_document;
