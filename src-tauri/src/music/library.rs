// 弦予曲库查询门面（原创重写版）。
// 本文件只面向缓存表 songs / library_folders 提供读取与目录维护能力：
//   · 根目录的登记、移除、统计与目录树展开；
//   · 全量曲目读取、双桶搜索、歌手 / 专辑目录、视图路径清单与排序。
// 磁盘遍历一律交给 scanner 链，这里不做任何文件系统扫描。
// 契约提醒：文中所有 SQL 语句、对外错误文案、emit 事件与 serde 字段名
// 均为既定契约，逐字冻结，重写时不得改动。

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;
use tauri::{AppHandle, State};
use unicode_normalization::UnicodeNormalization;

use super::scanner::{scan_folder_recursive, scan_single_directory_internal, ScanOptions};
use super::types::{LibrarySong, LibraryFolder, FolderNode, ArtistCatalogItem, AlbumCatalogItem};
use super::utils::{ // 实现
  clamp_i64_to_u32, descendant_like_patterns, i64_to_u64_opt, i64_to_u8_opt, legacy_unc_path,
  normalize_path,
};
use crate::database::{DbState};
use crate::security::path_validator;

// ---------- 前端依赖的排序模式（serde 命名冻结） ----------

/// 「全部歌曲」视图支持的排序方式。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")] // 实现
pub enum LibrarySongSortMode { // LibrarySongSortMode
  Title,
  Artist,
  AddedAt,
  AddedAtAsc,
  FileModifiedAt,
  FileModifiedAtAsc,
}

/// 「文件夹」视图支持的排序方式。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")] // 实现
pub enum FolderSongSortMode { // FolderSongSortMode
  Title,
  Name,
  Artist,
  AddedAt,
  AddedAtAsc,
  TrackNumber,
}

// ---------- SQL 片段（语句内容逐字冻结；常量名仅本文件私有） ----------

const ALL_VIEW_BASE_SQL: &str = "SELECT songs.path
             FROM songs
             WHERE 1 = 1";

const ARTIST_EXISTS_CLAUSE: &str = " AND EXISTS (
                    SELECT 1
                    FROM song_artists
                    JOIN artists ON artists.id = song_artists.artist_id
                    WHERE song_artists.song_id = songs.id
                      AND artists.name = ? COLLATE NOCASE
                )";

const ALBUM_MATCH_CLAUSE: &str = " AND LOWER(
                    COALESCE(
                      NULLIF(TRIM(songs.album_key), ''),
                      COALESCE(NULLIF(TRIM(songs.album), ''), 'Unknown') || '::' ||
                      COALESCE(NULLIF(TRIM(songs.album_artist), ''), NULLIF(TRIM(songs.artist), ''), 'Unknown')
                    )
                ) = LOWER(?)";

const TEXT_LIKE_CLAUSE: &str = " AND (
                    LOWER(COALESCE(songs.title, '')) LIKE ?
                    OR LOWER(COALESCE(songs.artist, '')) LIKE ?
                    OR LOWER(COALESCE(songs.album, '')) LIKE ?
                    OR LOWER(COALESCE(songs.album_artist, '')) LIKE ?
                    OR LOWER(COALESCE(songs.path, '')) LIKE ?
                    OR EXISTS (
                        SELECT 1
                        FROM song_artists
                        JOIN artists ON artists.id = song_artists.artist_id
                        WHERE song_artists.song_id = songs.id
                          AND LOWER(artists.name) LIKE ?
                    )
                )";

// 缓存曲目整行投影；列序与 song_from_row 内的下标严格对应，动一处必动另一处。
// 下标 17/18/19（container/codec/file_size）暂不进模型，映射时跳过。
const SONG_CACHE_COLUMNS: &str = "id, path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, cover_thumb_path, bitrate, sample_rate, bit_depth, format, container, codec, file_size, track_number, disc_number, added_at, file_modified_at, cue_source_path, cue_start_offset, cue_end_offset, source_type, remote_source_id, comment";

/// 登记目录时目录不可达的对外错误文案（契约，逐字保留）。
const FOLDER_ACCESS_DENIED_TEXT: &str = "无法访问音乐文件夹，请检查局域网连接、共享路径和访问权限";

// ---------- 数据库执行底座 ----------

// rusqlite 错误统一折算成字符串，收敛散落的闭包写法。
fn db_err(err: rusqlite::Error) -> String {
  err.to_string()
}

// 预编译语句的小包装，出错时同样折算成字符串。
fn prepare<'a>(
  conn: &'a rusqlite::Connection,
  sql: &str,
) -> Result<rusqlite::Statement<'a>, String> {
  conn.prepare(sql).map_err(db_err)
}

// 取结果集第 0 列的字符串值；单行取值失败与空值都按「跳过」处理，
// 与旧的 filter_map(ok) 语义一致。
fn string_column(
  stmt: &mut rusqlite::Statement<'_>,
  params: impl rusqlite::Params,
) -> Result<Vec<String>, String> { // 实现
  let mut values = Vec::new();
  let mut rows = stmt.query(params).map_err(db_err)?;
  while let Some(row) = rows.next().map_err(db_err)? {
    if let Ok(maybe_text) = row.get::<_, Option<String>>(0) {
      if let Some(text) = maybe_text {
        values.push(text);
      }
    }
  }
  Ok(values)
}

// 在后台线程持有连接执行一次任务；锁中毒与任务错误都折算成字符串错误。
async fn run_with_db<T, F>(db_state: &DbState, task: F) -> Result<T, String>
where
  T: Send + 'static,
  F: FnOnce(&mut rusqlite::Connection) -> Result<T, String> + Send + 'static,
{
  let pooled = db_state.conn.clone();
  tauri::async_runtime::spawn_blocking(move || {
    let mut guard = pooled.lock().map_err(|e| e.to_string())?;
    task(&mut guard)
  })
  .await
  .map_err(|e| e.to_string())?
}

// ---------- 行编码：缓存曲目行 → LibrarySong ----------

// JSON 字符串列表列 → Vec<String>；空值或坏 JSON 一律按空列表处理。
fn decode_name_list(raw: Option<String>) -> Vec<String> {
  raw
    .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
    .unwrap_or_default()
}

// songs 表整行 → LibrarySong；列下标见 SONG_CACHE_COLUMNS。
fn song_from_row(row: &rusqlite::Row) -> rusqlite::Result<LibrarySong> {
  Ok(LibrarySong {
    id: row.get(0)?,
    name: file_display_name(&row.get::<_, String>(1)?),
    path: row.get(1)?,
    title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
    artist: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
    artist_names: decode_name_list(row.get(4)?),
    effective_artist_names: decode_name_list(row.get(5)?),
    album: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
    album_artist: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
    album_key: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
    is_various_artists_album: row.get::<_, Option<i64>>(9)?.unwrap_or(0) != 0,
    collapse_artist_credits: row.get::<_, Option<i64>>(10)?.unwrap_or(0) != 0,
    duration: clamp_i64_to_u32(row.get::<_, Option<i64>>(11)?.unwrap_or(0)),
    cover_thumb_path: row.get(12)?,
    bitrate: clamp_i64_to_u32(row.get::<_, Option<i64>>(13)?.unwrap_or(0)),
    sample_rate: clamp_i64_to_u32(row.get::<_, Option<i64>>(14)?.unwrap_or(0)),
    bit_depth: i64_to_u8_opt(row.get(15)?),
    format: row.get::<_, Option<String>>(16)?.unwrap_or_default(),
    track_number: row.get(20)?,
    disc_number: row.get(21)?,
    added_at: i64_to_u64_opt(row.get(22)?),
    file_modified_at: i64_to_u64_opt(row.get(23)?),
    cue_source_path: row.get(24)?,
    cue_start_offset: row.get::<_, Option<i64>>(25)?.map(|value| value as u32),
    cue_end_offset: row.get::<_, Option<i64>>(26)?.map(|value| value as u32),
    source_type: row
      .get::<_, Option<String>>(27)?
      .unwrap_or_else(|| "local".to_string()),
    remote_source_id: row.get(28)?,
    comment: row.get(29)?,
  })
}

// 读取全部缓存曲目，按展示文件名升序（稳定排序）。
fn read_song_cache(conn: &rusqlite::Connection) -> Result<Vec<LibrarySong>, String> {
  let sql = format!("SELECT {} FROM songs", SONG_CACHE_COLUMNS);
  let mut stmt = conn.prepare(&sql).map_err(db_err)?;
  let mut rows = stmt.query([]).map_err(db_err)?;

  let mut catalog: Vec<LibrarySong> = Vec::new();
  while let Some(row) = rows.next().map_err(db_err)? {
    if let Ok(song) = song_from_row(row) {
      catalog.push(song);
    }
  }
  catalog.sort_by(|earlier, later| earlier.name.cmp(&later.name));
  Ok(catalog)
}

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

// ---------- 路径与文本小工具 ----------

// 文件名标签：取不到文件名时原样返回整条路径。
fn file_display_name(path: &str) -> String {
  Path::new(path)
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_else(|| path.to_string())
}

// 空标题回退为文件名，作为展示标题。
fn title_or_file_name(title: &str, path: &str) -> String {
  match title.trim().is_empty() {
    true => file_display_name(path),
    false => title.to_owned(),
  }
}

// 统一成正斜杠并剥掉结尾斜杠，便于父目录比较。
fn forward_slash_form(path: &str) -> String {
  path.replace('\\', "/").trim_end_matches('/').to_string()
}

// song_path 是 folder_path 本身或其后代（两种分隔符都认）。
fn path_within_root(candidate: &str, root: &str) -> bool {
  if candidate == root {
    return true;
  }
  for separator in ['\\', '/'] {
    let mut prefix = String::from(root);
    prefix.push(separator);
    if candidate.starts_with(&prefix) {
      return true;
    }
  }
  false
}

// 直接子项判定：去掉文件名后的父目录与给定目录完全一致。
// 注意子路径不剥结尾斜杠，与旧判定保持一致。
fn is_immediate_child(parent: &str, candidate: &str) -> bool {
  let flattened = candidate.replace('\\', "/");
  let Some(boundary) = flattened.rfind('/') else {
    return false;
  };
  flattened[..boundary] == forward_slash_form(parent)
}

// "1/12" / "Disc 2" / "02" 等文本里取首个数字串。
fn leading_track_digits(label: &Option<String>) -> Option<i32> {
  let text = label.as_deref()?;
  let start = text.find(|ch: char| ch.is_ascii_digit())?;
  let rest = &text[start..];
  let stop = rest
    .find(|ch: char| !ch.is_ascii_digit())
    .unwrap_or(rest.len());
  rest[..stop].parse::<i32>().ok()
}

// 数值排序键：有值排前、无值排后，等值再比数值本身。
fn sort_key_for_number(value: Option<i32>) -> (bool, i32) {
  (value.is_none(), value.unwrap_or_default())
}

// ---------- 文件夹视图的行结构与过滤、排序 ----------

// 文件夹视图查询的中间行；字段贴合展示语义，不做完整 LibrarySong 映射。
#[derive(Debug)]
struct FolderRow {
  path: String,
  title: String,
  artist: String,
  album: String,
  album_artist: String,
  raw_artist_names: Vec<String>,
  effective_names: Vec<String>,
  added_stamp: Option<u64>,
  track_no: Option<String>,
  disc_no: Option<String>,
}

// 展示用艺人名候选：生效艺人名 > 原始艺人名列表 > 单一 artist 字段。
fn artist_pool(row: &FolderRow) -> Vec<String> {
  if !row.effective_names.is_empty() {
    return row.effective_names.clone();
  }
  if !row.raw_artist_names.is_empty() {
    return row.raw_artist_names.clone();
  }
  vec![row.artist.clone()]
}

// 文件夹视图的文本过滤：文件名/标题/歌手/专辑/专辑歌手/多路艺人名任一命中。
// 入针为空（含纯空白）时全部放行。
fn passes_folder_query(row: &FolderRow, needle: Option<&str>) -> bool {
  let Some(raw_needle) = needle else {
    return true;
  };
  let term = raw_needle.trim().to_lowercase();
  if term.is_empty() {
    return true;
  }

  let mut candidates: Vec<String> = vec![
    file_display_name(&row.path),
    row.title.clone(),
    row.artist.clone(),
    row.album.clone(),
    row.album_artist.clone(),
  ];
  candidates.extend(artist_pool(row));
  candidates
    .iter()
    .any(|text| text.to_lowercase().contains(&term))
}

// 文件夹视图比较器：碟号先于轨号，均空排后，末位按展示标题/路径稳定收尾。
fn compare_folder_rows(left: &FolderRow, right: &FolderRow, mode: &FolderSongSortMode) -> Ordering {
  let title_key = |row: &FolderRow| title_or_file_name(&row.title, &row.path).to_lowercase();
  let added_key = |row: &FolderRow| row.added_stamp.unwrap_or_default();

  match mode {
    FolderSongSortMode::Title => title_key(left).cmp(&title_key(right)),
    FolderSongSortMode::Name => {
      let left_name = file_display_name(&left.path).to_lowercase();
      let right_name = file_display_name(&right.path).to_lowercase();
      left_name.cmp(&right_name)
    }
    FolderSongSortMode::Artist => left
      .artist
      .to_lowercase()
      .cmp(&right.artist.to_lowercase())
      .then_with(|| title_key(left).cmp(&title_key(right))),
    FolderSongSortMode::AddedAt => added_key(right)
      .cmp(&added_key(left))
      .then_with(|| title_key(left).cmp(&title_key(right))),
    FolderSongSortMode::AddedAtAsc => added_key(left)
      .cmp(&added_key(right))
      .then_with(|| title_key(left).cmp(&title_key(right))),
    FolderSongSortMode::TrackNumber => sort_key_for_number(leading_track_digits(&left.disc_no))
      .cmp(&sort_key_for_number(leading_track_digits(&right.disc_no)))
      .then_with(|| {
        sort_key_for_number(leading_track_digits(&left.track_no))
          .cmp(&sort_key_for_number(leading_track_digits(&right.track_no)))
      })
      .then_with(|| title_key(left).cmp(&title_key(right)))
      .then_with(|| left.path.cmp(&right.path)),
  }
}

// ---------- 根目录移除（事务内完成） ----------

// 删除文件夹记录并清掉不属于其余根目录后代的曲目，最后清理孤儿歌手。
fn delete_folder_subtree(
  conn: &mut rusqlite::Connection,
  folder_path: &str,
) -> Result<Vec<String>, String> { // 实现
  let tx = conn.transaction().map_err(db_err)?;

  // 旧版写入的 UNC 别名一并删除。
  let legacy_alias = legacy_unc_path(folder_path).unwrap_or_else(|| folder_path.to_string());
  tx.execute(
    "DELETE FROM library_folders WHERE path = ?1 OR path = ?2",
    rusqlite::params![folder_path, legacy_alias],
  )
  .map_err(db_err)?;

  // 剩余根目录（归一化后参与归属判断）。
  let mut surviving_roots: Vec<String> = Vec::new();
  {
    let mut stmt = tx
      .prepare("SELECT path FROM library_folders")
      .map_err(db_err)?;
    let mut rows = stmt.query([]).map_err(db_err)?;
    while let Some(row) = rows.next().map_err(db_err)? {
      if let Ok(raw) = row.get::<_, String>(0) {
        surviving_roots.push(normalize_path(&raw));
      }
    }
  }

  let (forward_like, backward_like) = descendant_like_patterns(folder_path);
  let mut doomed_paths: Vec<String> = Vec::new();
  {
    let mut stmt = tx
      .prepare(
        "SELECT path
                 FROM songs
                 WHERE path = ?1 
                    OR path LIKE ?2 ESCAPE '^' 
                    OR path LIKE ?3 ESCAPE '^'", 
      )
      .map_err(db_err)?;
    let mut rows = stmt
      .query(rusqlite::params![folder_path, forward_like, backward_like])
      .map_err(db_err)?;
    while let Some(row) = rows.next().map_err(db_err)? {
      if let Ok(raw) = row.get::<_, String>(0) {
        doomed_paths.push(raw);
      }
    }
  }

  // 其余根目录还罩得住的曲目留下，罩不住的删除。
  let mut removed: Vec<String> = Vec::new();
  for path in doomed_paths {
    let still_covered = surviving_roots
      .iter()
      .any(|root| path_within_root(&path, root));
    if !still_covered {
      removed.push(path);
    }
  }

  {
    let mut stmt = tx
      .prepare("DELETE FROM songs WHERE path = ?1")
      .map_err(db_err)?;
    for path in &removed {
      stmt
        .execute([path])
        .map_err(|e| format!("delete failed for '{}': {}", path, e))?;
    }
  }

  // 孤儿歌手清理；失败不阻断流程。
  let _ = tx.execute(
    "DELETE FROM artists
         WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)",
    [],
  );

  tx.commit().map_err(db_err)?;
  Ok(removed)
}

// ---------- 「全部歌曲」视图的排序子句 ----------

// 排序子句按模式拼接（与前端排序语义一一对应，SQL 逐字冻结）。
fn order_clause(mode: &LibrarySongSortMode) -> &'static str {
  match mode {
    LibrarySongSortMode::Title => {
      " ORDER BY COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC"
    }
    LibrarySongSortMode::Artist => {
      " ORDER BY COALESCE(NULLIF(TRIM(songs.artist), ''), 'Unknown') COLLATE NOCASE ASC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC"
    }
    LibrarySongSortMode::AddedAt => {
      " ORDER BY COALESCE(songs.added_at, 0) DESC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC"
    }
    LibrarySongSortMode::AddedAtAsc => {
      " ORDER BY COALESCE(songs.added_at, 0) ASC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC"
    }
    LibrarySongSortMode::FileModifiedAt => {
      " ORDER BY COALESCE(songs.file_modified_at, 0) DESC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC"
    }
    LibrarySongSortMode::FileModifiedAtAsc => {
      " ORDER BY COALESCE(songs.file_modified_at, 0) ASC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC"
    }
  }
}

// 过滤参数的统一整形：去空白后为空则视为未提供。
fn trimmed_nonempty(input: Option<String>) -> Option<String> {
  input
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

// ---------- 目录项的标签辅助 ----------

// 目录条目的排序标签：取不到名字时退化为完整路径。
fn dir_entry_label(path: &Path) -> String {
  path
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

// ---------- 命令 ----------

/// 曲库根目录清单（按加入时间倒序），附带各自名下的曲目数。
#[tauri::command] // 实现
pub async fn get_library_folders( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<LibraryFolder>, String> { // 实现
  run_with_db(&db_state, |conn| {
    let mut folder_stmt = prepare(
      conn,
      "SELECT path FROM library_folders ORDER BY added_at DESC",
    )?;
    let root_paths: Vec<String> = string_column(&mut folder_stmt, [])?
      .into_iter()
      .map(|raw| normalize_path(&raw))
      .collect();

    let mut song_stmt = prepare(conn, "SELECT path FROM songs")?;
    let song_paths = string_column(&mut song_stmt, [])?;

    let mut folders = Vec::with_capacity(root_paths.len());
    for root in root_paths {
      let mut owned_count = 0usize;
      for song in &song_paths {
        if path_within_root(song, &root) {
          owned_count += 1;
        }
      }
      folders.push(LibraryFolder {
        path: root,
        song_count: owned_count,
      });
    }
    Ok(folders)
  })
  .await
}

/// 登记曲库根目录；目录必须真实可访问，旧式 UNC 别名一并清除。
#[tauri::command] // 实现
pub async fn add_library_folder(path: String, db_state: State<'_, DbState>) -> Result<(), String> { // 实现
  let validated = path_validator::validate_path(&path, None)?;
  let normalized = normalize_path(&validated.to_string_lossy());
  let pooled = db_state.conn.clone();

  let outcome = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
    let root = PathBuf::from(&normalized);
    if !root.is_dir() || std::fs::read_dir(&root).is_err() {
      return Err(FOLDER_ACCESS_DENIED_TEXT.to_string());
    }

    let guard = pooled.lock().map_err(|e| e.to_string())?;
    if let Some(alias) = legacy_unc_path(&normalized) {
      guard
        .execute("DELETE FROM library_folders WHERE path = ?1", [alias])
        .map_err(|e| e.to_string())?;
    }

    let added_at_stamp = SystemTime::now()
      .duration_since(SystemTime::UNIX_EPOCH)
      .unwrap_or_default()
      .as_secs()
      .to_string();
    guard
      .execute(
        "INSERT OR REPLACE INTO library_folders (path, added_at) VALUES (?1, ?2)",
        [&normalized, &added_at_stamp],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  })
  .await;

  outcome.map_err(|e| e.to_string())??;
  Ok(())
}

/// 移除曲库根目录；其独占的曲目与孤儿歌手一并清理。
#[tauri::command] // 实现
pub async fn remove_library_folder( // 实现
  path: String,
  db_state: State<'_, DbState>,
) -> Result<(), String> { // 实现
  let validated = path_validator::validate_path(&path, None)?;
  let normalized = normalize_path(&validated.to_string_lossy());

  run_with_db(&db_state, move |conn| {
    delete_folder_subtree(conn, &normalized)?;
    Ok(())
  })
  .await
}

/// 全量缓存曲目（按文件名排序）。
#[tauri::command] // 实现
pub async fn get_library_songs_cached( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySong>, String> { // 实现
  run_with_db(&db_state, |conn| read_song_cache(conn)).await
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

// 歌手目录行 → ArtistCatalogItem。
fn artist_catalog_entry(row: &rusqlite::Row) -> rusqlite::Result<ArtistCatalogItem> {
  let artist_id: i64 = row.get(0)?;
  let artist_name: String = row.get(1)?;
  let song_total: i64 = row.get(2)?;
  let lead_path: String = row.get(3)?;
  let avatar: Option<String> = row.get(4)?;
  Ok(ArtistCatalogItem {
    id: artist_id,
    name: artist_name,
    count: clamp_i64_to_u32(song_total),
    first_song_path: lead_path,
    avatar_path: avatar,
  })
}

/// 歌手目录：按歌手聚合曲目数与代表作路径。
#[tauri::command] // 实现
pub async fn get_library_artist_catalog( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<ArtistCatalogItem>, String> { // 实现
  run_with_db(&db_state, |conn| {
    let mut stmt = prepare(
      conn,
      "SELECT artists.id,
                        artists.name, 
                        COUNT(song_artists.song_id) AS song_count, 
                        COALESCE((
                            SELECT songs.path 
                            FROM song_artists AS nested_song_artists 
                            JOIN songs ON songs.id = nested_song_artists.song_id 
                            WHERE nested_song_artists.artist_id = artists.id 
                            ORDER BY songs.added_at DESC, songs.id ASC 
                            LIMIT 1
                        ), ''),
                        artists.avatar_path 
                 FROM artists 
                 JOIN song_artists ON song_artists.artist_id = artists.id 
                 GROUP BY artists.id, artists.name 
                 ORDER BY artists.name COLLATE NOCASE ASC", 
    )?;

    let mut rows = stmt.query([]).map_err(db_err)?;
    let mut roster = Vec::new();
    while let Some(row) = rows.next().map_err(db_err)? {
      if let Ok(entry) = artist_catalog_entry(row) {
        roster.push(entry);
      }
    }
    Ok(roster)
  })
  .await
}

// 专辑目录行 → AlbumCatalogItem；无 album_key 时用「album::artist」小写合成键。
fn album_catalog_entry(row: &rusqlite::Row) -> rusqlite::Result<AlbumCatalogItem> {
  let raw_key: String = row.get(0)?;
  let album_name: String = row.get(1)?;
  let album_owner: String = row.get(2)?;
  let song_total: i64 = row.get(3)?;
  let lead_path: String = row.get(4)?;

  let identity = match raw_key.trim().is_empty() {
    true => format!(
      "{}::{}",
      album_name.to_ascii_lowercase(),
      album_owner.to_ascii_lowercase()
    ),
    false => raw_key,
  };
  Ok(AlbumCatalogItem {
    key: identity,
    name: album_name,
    count: clamp_i64_to_u32(song_total),
    artist: album_owner,
    first_song_path: lead_path,
  })
}

/// 专辑目录：按专辑三元组聚合曲目数与首曲路径。
#[tauri::command] // 实现
pub async fn get_library_album_catalog( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<AlbumCatalogItem>, String> { // 实现
  run_with_db(&db_state, |conn| {
        let mut stmt = prepare(
            conn,
            "SELECT
                    COALESCE(NULLIF(TRIM(album_key), ''), '') AS album_key, 
                    COALESCE(NULLIF(TRIM(album), ''), 'Unknown') AS album_name, 
                    COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown') AS album_artist_name, 
                    COUNT(*) AS song_count, 
                    COALESCE((
                        SELECT nested.path 
                        FROM songs AS nested 
                        WHERE (
                            COALESCE(NULLIF(TRIM(nested.album_key), ''), '') = COALESCE(NULLIF(TRIM(songs.album_key), ''), '') 
                            AND COALESCE(NULLIF(TRIM(nested.album), ''), 'Unknown') = COALESCE(NULLIF(TRIM(songs.album), ''), 'Unknown') 
                            AND COALESCE(NULLIF(TRIM(nested.album_artist), ''), NULLIF(TRIM(nested.artist), ''), 'Unknown') 
                                = COALESCE(NULLIF(TRIM(songs.album_artist), ''), NULLIF(TRIM(songs.artist), ''), 'Unknown') 
                        )
                        ORDER BY nested.added_at DESC, nested.id ASC 
                        LIMIT 1
                    ), '') AS first_song_path 
                 FROM songs
                 GROUP BY
                    COALESCE(NULLIF(TRIM(album_key), ''), ''), 
                    COALESCE(NULLIF(TRIM(album), ''), 'Unknown'), 
                    COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown') 
                 ORDER BY album_name COLLATE NOCASE ASC, album_artist_name COLLATE NOCASE ASC", 
        )?;

        let mut rows = stmt.query([]).map_err(db_err)?;
        let mut shelf = Vec::new();
        while let Some(row) = rows.next().map_err(db_err)? {
            if let Ok(entry) = album_catalog_entry(row) {
                shelf.push(entry);
            }
        }
        Ok(shelf)
    })
    .await
}

/// 某位歌手名下的全部曲目路径（标题排序）。
#[tauri::command] // 实现
pub async fn get_library_song_paths_by_artist( // 实现
  artist_name: String,
  db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> { // 实现
  run_with_db(&db_state, move |conn| {
    let mut stmt = prepare(
      conn,
      "SELECT songs.path
             FROM songs
             JOIN song_artists ON song_artists.song_id = songs.id
             JOIN artists ON artists.id = song_artists.artist_id
             WHERE artists.name = ?1 COLLATE NOCASE
             GROUP BY songs.id, songs.path
             ORDER BY COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
    )?;
    string_column(&mut stmt, [artist_name])
  })
  .await
}

/// 某张专辑（合成键）名下的全部曲目路径（标题排序）。
#[tauri::command] // 实现
pub async fn get_library_song_paths_by_album( // 实现
  album_key: String,
  db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> { // 实现
  run_with_db(&db_state, move |conn| {
    let mut stmt = prepare(
      conn,
      "SELECT path
             FROM songs
             WHERE LOWER(
                COALESCE(
                  NULLIF(TRIM(album_key), ''),
                  COALESCE(NULLIF(TRIM(album), ''), 'Unknown') || '::' ||
                  COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown')
                )
             ) = LOWER(?1)
             ORDER BY COALESCE(NULLIF(TRIM(title), ''), path) COLLATE NOCASE ASC",
    )?;
    string_column(&mut stmt, [album_key])
  })
  .await
}

/// 「全部歌曲」视图的路径清单：可叠加歌手/专辑/文本过滤与六种排序。
#[tauri::command] // 实现
pub async fn get_library_song_paths_for_all_view( // 实现
  query: Option<String>,
  artist_filter: Option<String>,
  album_filter: Option<String>,
  sort_mode: LibrarySongSortMode,
  db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> { // 实现
  run_with_db(&db_state, move |conn| {
    let mut sql = String::from(ALL_VIEW_BASE_SQL);
    let mut args: Vec<String> = Vec::new();

    if let Some(artist_name) = trimmed_nonempty(artist_filter) {
      sql.push_str(ARTIST_EXISTS_CLAUSE);
      args.push(artist_name);
    }

    if let Some(album_key) = trimmed_nonempty(album_filter) {
      sql.push_str(ALBUM_MATCH_CLAUSE);
      args.push(album_key);
    }

    if let Some(search_term) = query
      .map(|value| value.trim().to_lowercase())
      .filter(|value| !value.is_empty())
    {
      let like = format!("%{}%", search_term);
      sql.push_str(TEXT_LIKE_CLAUSE);
      // 文本过滤子句里有 6 个 LIKE 占位，同一个词填满。
      for _ in 0..6 {
        args.push(like.clone());
      }
    }

    sql.push_str(order_clause(&sort_mode));

    let mut stmt = prepare(conn, &sql)?;
    string_column(&mut stmt, rusqlite::params_from_iter(args.iter()))
  })
  .await
}

/// 「文件夹」视图的路径清单：仅直接子项，支持文本过滤与六种排序。
#[tauri::command] // 实现
pub async fn get_library_song_paths_for_folder_view( // 实现
  folder_path: String,
  query: Option<String>,
  sort_mode: FolderSongSortMode,
  db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> { // 实现
  let validated = path_validator::validate_path(&folder_path, None)?;
  let normalized_folder = normalize_path(&validated.to_string_lossy());

  run_with_db(&db_state, move |conn| {
        let (forward_like, backward_like) =
            descendant_like_patterns(&normalized_folder);
        let mut stmt = prepare(
            conn,
            "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist, added_at, track_number, disc_number
                 FROM songs
                 WHERE path = ?1 
                    OR path LIKE ?2 ESCAPE '^' 
                    OR path LIKE ?3 ESCAPE '^'", 
        )?;

        let mapped = stmt
            .query_map(
                rusqlite::params![normalized_folder, forward_like, backward_like], // 实现
                |row| {
                    Ok(FolderRow {
                        path: row.get::<_, String>(0)?, // 实现
                        title: row.get::<_, Option<String>>(1)?.unwrap_or_default(), // 实现
                        artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(), // 实现
                        raw_artist_names: decode_name_list(row.get::<_, Option<String>>(3)?),
                        effective_names: decode_name_list(row.get::<_, Option<String>>(4)?),
                        album: row.get::<_, Option<String>>(5)?.unwrap_or_default(), // 实现
                        album_artist: row.get::<_, Option<String>>(6)?.unwrap_or_default(), // 实现
                        added_stamp: i64_to_u64_opt(row.get::<_, Option<i64>>(7)?),
                        track_no: row.get::<_, Option<String>>(8)?,
                        disc_no: row.get::<_, Option<String>>(9)?,
                    })
                },
            )
            .map_err(db_err)?;

        let mut visible: Vec<FolderRow> = Vec::new();
        for fetched in mapped {
            // 单行取数失败按跳过处理，与旧的 filter_map(ok) 语义一致。
            let Ok(row) = fetched else {
                continue;
            };
            if !is_immediate_child(&normalized_folder, &row.path) {
                continue;
            }
            if !passes_folder_query(&row, query.as_deref()) {
                continue;
            }
            visible.push(row);
        }

        visible.sort_by(|left, right| compare_folder_rows(left, right, &sort_mode));

        Ok(visible.into_iter().map(|row| row.path).collect())
    })
    .await
}

/// 触发全库扫描：逐根目录扫描后返回缓存曲目全量。
#[tauri::command] // 实现
pub async fn scan_library( // 实现
  minimum_duration_seconds: Option<u32>,
  app: AppHandle,
  db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySong>, String> { // 实现
  let pooled = db_state.conn.clone();
  let scan_opts = ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds);

  let outcome = tauri::async_runtime::spawn_blocking(move || {
    // 先取全部根目录，随后逐个触发扫描（扫描器自行处理增量与错误）。
    let root_paths: Vec<String> = {
      let guard = pooled.lock().map_err(|e| e.to_string())?;
      let mut stmt = guard
        .prepare("SELECT path FROM library_folders")
        .map_err(db_err)?;
      let mut rows = stmt.query([]).map_err(db_err)?;
      let mut found = Vec::new();
      while let Some(row) = rows.next().map_err(db_err)? {
        if let Ok(raw) = row.get::<_, String>(0) {
          found.push(raw);
        }
      }
      found
    };

    let grand_total = root_paths.len();
    for (index, root) in root_paths.into_iter().enumerate() {
      // 扫描错误不阻断后续根目录，与旧实现一致。
      let _ = scan_single_directory_internal(
        root,
        pooled.clone(),
        Some(app.clone()),
        index + 1,
        grand_total.max(1),
        scan_opts,
      );
    }

    let guard = pooled.lock().map_err(|e| e.to_string())?;
    read_song_cache(&guard)
  })
  .await
  .map_err(|e| e.to_string())??;

  Ok(outcome)
}

/// 全库目录树：逐个根目录展开成 FolderNode 层级。
#[tauri::command] // 实现
pub async fn get_library_hierarchy( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<FolderNode>, String> { // 实现
  run_with_db(&db_state, |conn| {
    let mut stmt = prepare(
      conn,
      "SELECT path FROM library_folders ORDER BY added_at DESC",
    )?;
    let roots = string_column(&mut stmt, [])?;

    let mut tree: Vec<FolderNode> = Vec::new();
    for root in roots {
      match scan_folder_recursive(PathBuf::from(&root), 0, 1, conn) {
        Some(node) => tree.push(node),
        None => continue,
      }
    }
    Ok(tree)
  })
  .await
}

/// 某目录下的直接子目录（按名称排序），不递归。
#[tauri::command] // 实现
pub async fn get_folder_children( // 实现
  folder_path: String,
  db_state: State<'_, DbState>,
) -> Result<Vec<FolderNode>, String> { // 实现
  let validated = path_validator::validate_path(&folder_path, None)?;
  let normalized_folder = normalize_path(&validated.to_string_lossy());

  run_with_db(&db_state, move |conn| {
    let root_dir = PathBuf::from(&normalized_folder);
    let entries = std::fs::read_dir(&root_dir).map_err(|e| e.to_string())?;

    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
      let child = entry.path();
      if child.is_dir() {
        subdirs.push(child);
      }
    }

    subdirs.sort_unstable_by(|left, right| dir_entry_label(left).cmp(&dir_entry_label(right)));

    let mut children: Vec<FolderNode> = Vec::new();
    for subdir in subdirs {
      match scan_folder_recursive(subdir, 0, 0, conn) {
        Some(node) => children.push(node),
        None => continue,
      }
    }
    Ok(children)
  })
  .await
}

// ---------- 单元测试 ----------
// 说明：夹具（建表 SQL、种子数据）与断言期望值保留原样；测试本体为本文件原创。

#[cfg(test)] // 实现
mod library_tests {
  use super::*;
  use rusqlite::Connection;

  // 最小两表结构：文件夹 + 简化曲目表。
  fn make_two_table_db(conn: &Connection) {
    conn
      .execute(
        "CREATE TABLE library_folders (
                path TEXT PRIMARY KEY, 
                added_at INTEGER 
            )",
        [],
      )
      .expect("create library_folders");
    conn
      .execute(
        "CREATE TABLE songs (
                id INTEGER PRIMARY KEY, 
                path TEXT NOT NULL UNIQUE, 
                title TEXT,
                artist TEXT, 
                album TEXT
            )",
        [],
      )
      .expect("create songs");
  }

  // 与 SONG_CACHE_COLUMNS 全列对齐的曲目表。
  fn make_full_column_db(conn: &Connection) {
    conn
      .execute(
        "CREATE TABLE songs (
                id INTEGER PRIMARY KEY, 
                path TEXT NOT NULL UNIQUE, 
                title TEXT,
                artist TEXT, 
                artist_names TEXT, 
                effective_artist_names TEXT, 
                album TEXT,
                album_artist TEXT, 
                album_key TEXT, 
                is_various_artists_album INTEGER, 
                collapse_artist_credits INTEGER, 
                duration INTEGER, 
                cover_thumb_path TEXT, 
                bitrate INTEGER, 
                sample_rate INTEGER, 
                bit_depth INTEGER, 
                format TEXT, 
                container TEXT, 
                codec TEXT,
                file_size INTEGER, 
                track_number TEXT, 
                disc_number TEXT, 
                added_at INTEGER, 
                file_modified_at INTEGER, 
                cue_source_path TEXT, 
                cue_start_offset INTEGER, 
                cue_end_offset INTEGER, 
                source_type TEXT, 
                remote_source_id TEXT, 
                comment TEXT 
            )",
        [],
      )
      .expect("create cached song schema");
  }

  // 按给定路径种一首曲目。
  fn plant_song(conn: &Connection, path: &str) {
    conn
      .execute(
        "INSERT INTO songs (path, title, artist, album) VALUES (?1, 'Title', 'Artist', 'Album')",
        [path],
      )
      .expect("insert song");
  }

  #[test]
  fn delete_folder_subtree_keeps_songs_covered_by_other_roots() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    make_two_table_db(&conn);
    conn
      .execute(
        "INSERT INTO library_folders (path, added_at) VALUES (?1, 1), (?2, 2)",
        ["/library/a", "/library/ab"],
      )
      .expect("insert library folders");
    plant_song(&conn, "/library/a/root.flac");
    plant_song(&conn, "/library/a/sub/nested.flac");
    plant_song(&conn, "/library/ab/kept.flac");

    let removed = delete_folder_subtree(&mut conn, "/library/a").expect("remove folder");
    assert_eq!(removed.len(), 2);

    let mut remaining_songs: Vec<String> = Vec::new();
    {
      let mut stmt = conn
        .prepare("SELECT path FROM songs ORDER BY path")
        .expect("prepare remaining songs");
      let mut rows = stmt.query([]).expect("query remaining songs");
      while let Some(row) = rows.next().expect("row remaining songs") {
        remaining_songs.push(row.get::<_, String>(0).expect("song path"));
      }
    }
    let mut remaining_folders: Vec<String> = Vec::new();
    {
      let mut stmt = conn
        .prepare("SELECT path FROM library_folders ORDER BY path")
        .expect("prepare remaining folders");
      let mut rows = stmt.query([]).expect("query remaining folders");
      while let Some(row) = rows.next().expect("row remaining folders") {
        remaining_folders.push(row.get::<_, String>(0).expect("folder path"));
      }
    }

    assert_eq!(remaining_songs, vec!["/library/ab/kept.flac"]);
    assert_eq!(remaining_folders, vec!["/library/ab"]);
  }

  #[test]
  fn read_song_cache_keeps_comment_column() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    make_full_column_db(&conn);
    conn
      .execute(
        "INSERT INTO songs (path, title, artist, album, comment)
             VALUES (?1, 'Title', 'Artist', 'Album', 'Live version')", 
        ["/library/song.flac"],
      )
      .expect("insert cached song");

    let songs = read_song_cache(&conn).expect("load cached songs");

    assert_eq!(songs.len(), 1);
    assert_eq!(songs[0].comment.as_deref(), Some("Live version"));
  }

  #[test]
  fn leading_track_digits_reads_typical_labels() {
    assert_eq!(leading_track_digits(&Some("02".to_string())), Some(2));
    assert_eq!(leading_track_digits(&Some("1/12".to_string())), Some(1));
    assert_eq!(leading_track_digits(&Some("Disc 2".to_string())), Some(2));
    assert_eq!(leading_track_digits(&Some("A".to_string())), None);
    assert_eq!(leading_track_digits(&None), None);
  }

  #[test]
  fn track_number_mode_sorts_disc_then_track_then_title() {
    let row_of = |path: &str, title: &str, track: Option<&str>, disc: Option<&str>| FolderRow {
      path: path.to_owned(),
      title: title.to_owned(),
      artist: "Artist".to_owned(),
      album: "Album".to_owned(),
      album_artist: "Artist".to_owned(),
      raw_artist_names: Vec::new(),
      effective_names: Vec::new(),
      added_stamp: None,
      track_no: track.map(str::to_owned),
      disc_no: disc.map(str::to_owned),
    };

    let mut rows = vec![
      row_of("/a/song1.flac", "Song 1", Some("1"), Some("2")),
      row_of("/a/song2.flac", "Song 2", Some("2"), Some("1")),
      row_of("/a/song3.flac", "Song 3", Some("1"), Some("1")),
      row_of("/a/song4.flac", "Song 4", None, Some("1")),
    ];

    rows.sort_by(|left, right| compare_folder_rows(left, right, &FolderSongSortMode::TrackNumber));

    assert_eq!(rows[0].path, "/a/song3.flac");
    assert_eq!(rows[1].path, "/a/song2.flac");
    assert_eq!(rows[2].path, "/a/song4.flac");
    assert_eq!(rows[3].path, "/a/song1.flac");
  }
}
