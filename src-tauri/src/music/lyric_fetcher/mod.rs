// 歌词抓取域模块入口：由单体 lyric_fetcher.rs 按音源/职责纯搬家拆分而来。
// 对外路径保持拆分前不变：LyricSongInfo / LyricResult / decode_html_entities /
// decrypt_plugin_lyric / fetch_lyric_from_source。

mod common;
mod kugou;
mod kw;
mod migu;
mod netease;
mod orchestrator;
mod qq;

pub use common::{LyricResult, LyricSongInfo};
pub(crate) use common::http_fetch_text;
pub(crate) use common::decode_html_entities;
pub use orchestrator::fetch_lyric_from_source;
pub use qq::decrypt_plugin_lyric;
