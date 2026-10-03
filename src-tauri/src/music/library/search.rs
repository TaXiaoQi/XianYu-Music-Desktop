// 曲库内搜索：归一化文本后的双桶（强/弱结果）检索。

use tauri::State;
use unicode_normalization::UnicodeNormalization;

use crate::database::{DbState};
use crate::music::types::LibrarySong;

use super::common::{db_err, run_with_db, song_from_row, SONG_CACHE_COLUMNS};

// ---------- 搜索归一化与双桶检索 ----------

// 简繁折叠前先剥离的变音符号区间（U+0300..=U+036F）。
const COMBINING_MARK_RANGE: std::ops::RangeInclusive<char> = '\u{0300}'..='\u{036f}';

// 搜索归一化：NFKC 折叠 → 小写 → NFKD 去附加符 → 简繁折叠。
fn fold_text_for_search(raw: &str) -> String {
  let width_folded: String = raw.chars().nfkc().collect();
  let lowered = width_folded.to_lowercase();
  let accent_free: String = lowered
    .chars()
    .nfkd()
    .filter(|ch| !COMBINING_MARK_RANGE.contains(ch))
    .collect();
  fast2s::convert(&accent_free)
}

// 搜索域：标题/歌手/专辑/专辑歌手/路径 + 两组艺人名列表，全部走同一归一化。
fn build_search_corpus(song: &LibrarySong) -> Vec<String> {
  let base_fields = [
    song.title.as_str(),
    song.artist.as_str(),
    song.album.as_str(),
    song.album_artist.as_str(),
    song.path.as_str(),
  ];
  let mut corpus: Vec<String> = base_fields
    .iter()
    .map(|text| fold_text_for_search(text))
    .collect();
  let name_lists = song
    .artist_names
    .iter()
    .chain(song.effective_artist_names.iter());
  for name in name_lists {
    corpus.push(fold_text_for_search(name));
  }
  corpus
}

// 空针恒命中；否则任一搜索域直接包含或去空格后包含即命中。
fn text_hit(corpus: &[String], needle: &str) -> bool {
  if needle.is_empty() {
    return true;
  }
  corpus.iter().any(|field| {
    let squeezed = field.replace(' ', "");
    field.contains(needle) || squeezed.contains(needle)
  })
}

// 双桶搜索：整串命中的进强结果桶，其余进弱结果桶，强桶恒排前；
// 攒满 limit 条即停（与旧实现一样先入桶后判满）。
fn two_tier_search(
  conn: &rusqlite::Connection,
  raw_query: &str,
  cap: usize,
) -> Result<Vec<LibrarySong>, String> { // 实现
  let folded_query = fold_text_for_search(raw_query);
  let tokens: Vec<&str> = folded_query.split_whitespace().collect();
  if tokens.is_empty() {
    return Ok(Vec::new());
  }
  let glued = folded_query.replace(' ', "");

  let sql = format!("SELECT {} FROM songs", SONG_CACHE_COLUMNS);
  let mut stmt = conn.prepare(&sql).map_err(db_err)?;
  let mut rows = stmt.query([]).map_err(db_err)?;

  let mut strong: Vec<LibrarySong> = Vec::new();
  let mut weak: Vec<LibrarySong> = Vec::new();

  while let Some(row) = rows.next().map_err(db_err)? {
    let song = match song_from_row(row) {
      Ok(song) => song,
      Err(_) => continue,
    };
    let corpus = build_search_corpus(&song);
    if !tokens.iter().all(|token| text_hit(&corpus, token)) {
      continue;
    }
    if text_hit(&corpus, &glued) {
      strong.push(song);
    } else {
      weak.push(song);
    }
    if strong.len() + weak.len() >= cap {
      break;
    }
  }

  strong.append(&mut weak);
  Ok(strong)
}

/// 曲库内搜索：双桶排序，整串命中优先。
#[tauri::command] // 实现
pub async fn search_library_songs(
  query: String,
  limit: Option<usize>,
  db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySong>, String> { // 实现
  let cap = limit.unwrap_or(200);
  run_with_db(&db_state, move |conn| two_tier_search(conn, &query, cap)).await
}
