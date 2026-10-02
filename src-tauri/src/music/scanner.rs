//! 曲库扫描的聚合入口。本文件不含流程逻辑，职责有三块：
//!
//! 1. 用 `#[path]` 把五个子模块挂进编译树，并声明对 `music` 及更外层
//!    可见的名字（这一组转出属于冻结契约，不允许改名或改签名）；
//! 2. 集中存放子模块共用的常量与纯函数：占位文案、歌手字段拆分、
//!    专辑归组键、数值宽度收窄、JSON 列编解码、标签回填等；
//! 3. 承载扫描相关单元测试（夹具数据与断言期望值沿用既有约定）。
//!
//! 子模块分工一览：
//! - `parser`       单文件解码：lofty 标签优先，symphonia 探测兜底
//! - `diff`         磁盘盘点结果与库内快照求差，得到增/改/删
//! - `repository`   把差异分片写入 songs 与歌手两张关联表
//! - `progress`     阶段进度与批量增量事件上报（带节流）
//! - `orchestrator` 串联完整扫描流程并声明 Tauri 命令

use crate::music::types::Song;
use regex::{Regex};
use std::collections::{HashSet};
use std::sync::{OnceLock};

#[path = "scanner/diff.rs"]
mod diff;
#[path = "scanner/orchestrator.rs"]
mod orchestrator;
#[path = "scanner/parser.rs"]
mod parser;
#[path = "scanner/progress.rs"]
mod progress;
#[path = "scanner/repository.rs"]
mod repository;

// ---------- 对外转出面（前端与兄弟模块依赖，冻结） ----------

pub(crate) use self::parser::parse_song_from_file;
pub(crate) use self::repository::apply_scan_changes;
pub use orchestrator::{ // 实现
  get_folder_first_song, parse_audio_files, parse_music_folder, scan_folder_as_playlists,
  scan_folder_recursive, scan_music_folder, scan_single_directory_internal,
};

// ---------- 子模块共享常量 ----------

/// 合辑唱片对外展示的统一署名。
pub(super) const COMPILATION_ARTIST_NAME: &str = "Various Artists";
/// 同目录同专辑分组里，主歌手种类数超过该值就按合辑处理。
pub(super) const COMPILATION_ARTIST_CEILING: usize = 5;
/// 歌手标签缺失时的兜底文案。
pub(super) const ARTIST_FALLBACK_TEXT: &str = "未知歌手";
/// 专辑标签缺失时的兜底文案。
pub(super) const ALBUM_FALLBACK_TEXT: &str = "未知专辑";

/// 一次扫描任务的可调开关。当前只有“最短时长门槛”（单位秒），0 表示不过滤。
#[derive(Default, Debug, Copy, Clone)]
pub(crate) struct ScanOptions { // 实现
  pub(crate) min_duration_secs: u32,
}

impl ScanOptions { // ScanOptions
  /// 命令层传入的可选门槛；不给就按 0 处理。
  pub(crate) fn from_minimum_duration_seconds(limit: Option<u32>) -> Self {
    let min_duration_secs = match limit {
      Some(secs) => secs,
      None => 0,
    };
    Self { min_duration_secs }
  }
}

// ---------- 数值与 JSON 列的编解码 ----------

/// u64 → i64 的饱和收窄：越出 i64 上限时取 i64::MAX。
pub(super) fn narrow_u64_to_i64(raw: u64) -> i64 {
  let ceiling = i64::MAX as u64;
  if raw > ceiling {
    i64::MAX
  } else {
    raw as i64
  }
}

/// `narrow_u64_to_i64` 的可选值版本。
pub(super) fn narrow_u64_opt_to_i64(raw: Option<u64>) -> Option<i64> {
  raw.map(narrow_u64_to_i64)
}

/// 反序列化数据库里以 JSON 文本存储的字符串列表；坏数据按空列表处理。
pub(super) fn json_list_from_column(raw: Option<String>) -> Vec<String> {
  raw
    .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
    .unwrap_or_default()
}

/// 与上面互逆：把字符串列表编码成 JSON 文本（写入数据库列）。
pub(super) fn encode_json_list(items: &[String]) -> Result<String, String> {
  match serde_json::to_string(items) {
    Ok(text) => Ok(text),
    Err(err) => Err(err.to_string()),
  }
}

// ---------- 缺失判定与标签回填 ----------

/// 空串或与占位文案相同，都视作“该字段没有有效值”。
pub(super) fn reads_as_absent(text: &str, fallback_text: &str) -> bool {
  let cleaned = text.trim();
  if cleaned.is_empty() {
    true
  } else {
    cleaned == fallback_text
  }
}

/// 当前值缺失而标签候选有效时，产出用于回填的文本。
///
/// `marker` 给定时，等于占位文案的当前值同样视作缺失。
fn prefer_tag_value(
  current: &str,
  candidate: Option<&str>,
  marker: Option<&str>,
) -> Option<String> {
  let present = current.trim();
  let marker_blocks = marker.map_or(false, |text| present == text);
  if !(present.is_empty() || marker_blocks) {
    return None;
  }

  let trimmed_candidate = candidate.map(str::trim).unwrap_or("");
  if trimmed_candidate.is_empty() {
    None
  } else {
    Some(trimmed_candidate.to_owned())
  }
}

// ---------- 歌手字段 ----------

/// 歌手合并字段的分隔模式：中英文顿号/逗号/分号/斜杠/&，外加 feat. 与 with。
fn artist_split_pattern() -> &'static Regex {
  static PATTERN_TEXT: &str = r"(?i)(?:[;,&/、]|feat\.|\s+with\s+)";
  static CACHED: OnceLock<Regex> = OnceLock::new();
  CACHED.get_or_init(|| Regex::new(PATTERN_TEXT).expect("build artist split pattern"))
}

/// 把 “A; B / feat. C” 一类的合并歌手字段拆成列表：按分隔符切开，
/// 用小写副本判重（保留首次出现的原始大小写），结果保证非空。
pub(super) fn split_into_artist_names(joined: &str) -> Vec<String> {
  let mut seen: HashSet<String> = HashSet::new();
  let mut names: Vec<String> = Vec::new();

  artist_split_pattern()
    .split(joined)
    .map(str::trim)
    .filter(|piece| !piece.is_empty())
    .for_each(|piece| {
      if seen.insert(piece.to_lowercase()) {
        names.push(piece.to_owned());
      }
    });

  // 整段没被切开时，把原文当作唯一歌手，确保至少返回一项。
  if names.is_empty() {
    let whole = joined.trim();
    if !whole.is_empty() {
      names.push(whole.to_owned());
    }
  }

  names
}

/// 曲目的门面歌手：多歌手列表取首位；列表为空时退回单值歌手列。
pub(super) fn display_artist_of(entry: &Song) -> String {
  entry
    .artist_names
    .first()
    .cloned()
    .unwrap_or_else(|| entry.artist.clone())
}

/// 恰好归属一个“真实歌手”时给出该名字，否则 None。
///
/// “真实”的定义：非空、不属于任何已知的未知占位写法、也不是合辑署名。
pub(super) fn exclusive_real_artist(entry: &Song) -> Option<String> {
  let only_name = match entry.artist_names.as_slice() {
    [] => ARTIST_FALLBACK_TEXT.to_string(),
    [single] => single.clone(),
    _ => return None,
  };

  let cleaned = only_name.trim();
  let fake_markers = [
    ARTIST_FALLBACK_TEXT,
    "Unknown Artist",
    "Unknown",
    COMPILATION_ARTIST_NAME,
  ];
  let is_fake = cleaned.is_empty()
    || fake_markers
      .iter()
      .any(|marker| cleaned.eq_ignore_ascii_case(marker));

  if is_fake {
    None
  } else {
    Some(cleaned.to_string())
  }
}

// ---------- 专辑归组 ----------

/// 专辑键的单一分量：修剪后转小写；空值落到指定兜底文案的小写。
pub(super) fn key_component_normalized(raw: &str, fallback_text: &str) -> String {
  let cleaned = raw.trim();
  let chosen = if cleaned.is_empty() {
    fallback_text
  } else {
    cleaned
  };
  chosen.to_ascii_lowercase()
}

/// 专辑归组键：`专辑名::专辑歌手`（两个分量都小写化）。
pub(super) fn album_identity_key(album: &str, album_artist: &str) -> String {
  let album_part = key_component_normalized(album, ALBUM_FALLBACK_TEXT);
  let artist_part = key_component_normalized(album_artist, COMPILATION_ARTIST_NAME);
  album_part + "::" + &artist_part
}

// ---------- 标签回填入口 ----------

/// 用标签文本补齐当前缺失的 歌手/专辑/标题/专辑歌手 四个字段。
///
/// 歌手与专辑把“等于占位文案”也算缺失；标题与专辑歌手只看空串。
pub(super) fn fold_tag_text_into_fields(
  tagged_file: &impl lofty::file::TaggedFileExt,
  artist: &mut String,
  album: &mut String,
  title: &mut String,
  album_artist: &mut String,
) {
  let bag = super::tags::extract_text_metadata(tagged_file);

  if let Some(fill) = prefer_tag_value(artist, bag.artist.as_deref(), Some(ARTIST_FALLBACK_TEXT)) {
    *artist = fill;
  }
  if let Some(fill) = prefer_tag_value(album, bag.album.as_deref(), Some(ALBUM_FALLBACK_TEXT)) {
    *album = fill;
  }
  if let Some(fill) = prefer_tag_value(title, bag.title.as_deref(), None) {
    *title = fill;
  }
  if let Some(fill) = prefer_tag_value(album_artist, bag.album_artist.as_deref(), None) {
    *album_artist = fill;
  }
}

#[cfg(test)] mod tests {
  use super::diff::{build_scan_delta, StoredSongFacts};
  use super::parser::{container_info_absent, text_fields_missing, worker_budget_for_cores};
  use super::repository::{apply_scan_changes, choose_slice_width};
  use super::ScanOptions;
  use crate::music::types::Song;
  use crate::music::utils::normalize_path;
  use rusqlite::{params, Connection};
  use std::collections::HashMap;
  use std::fs;
  use std::path::PathBuf;
  use std::time::{SystemTime, UNIX_EPOCH};

  // ---------- 夹具 ----------

  /// 字段齐全的标准样例。多个用例依赖这里的取值来给出断言期望。
  fn sample_entry(path: &str) -> Song {
    Song {
      id: None,
      path: String::from(path),
      name: PathBuf::from(path)
        .file_name()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| String::from(path)),
      title: String::from("Demo"),
      artist: String::from("Artist"),
      artist_names: vec!["Artist".to_owned()],
      effective_artist_names: vec!["Artist".to_owned()],
      album: String::from("Album"),
      album_artist: String::from("Artist"),
      album_key: String::from("album::artist"),
      is_various_artists_album: false,
      collapse_artist_credits: false,
      duration: 180,
      cover_thumb_path: Some(String::from("C:/covers/demo_thumb_150.jpg")),
      bitrate: 320,
      sample_rate: 48000,
      bit_depth: Some(24),
      format: String::from("flac"),
      container: Some(String::from("flac")),
      codec: Some(String::from("flac")),
      file_size: 1024,
      track_number: None,
      disc_number: None,
      added_at: Some(1),
      file_modified_at: Some(10),
      cue_source_path: None,
      cue_start_offset: None,
      cue_end_offset: None,
      comment: None,
      artist_avatar_bytes: None,
      artist_avatar_path: None,
    }
  }

  /// 与真实库结构一致的内存库：外键开启，级联删除生效。
  fn in_memory_library_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn
      .pragma_update(None, "foreign_keys", "ON")
      .expect("enable foreign keys");
    conn
      .execute_batch(
        "
            CREATE TABLE songs ( 
                id INTEGER PRIMARY KEY, 
                path TEXT NOT NULL UNIQUE, 
                title TEXT,
                artist TEXT, 
                artist_names TEXT, 
                effective_artist_names TEXT, 
                album TEXT,
                album_artist TEXT, 
                album_key TEXT, 
                is_various_artists_album INTEGER DEFAULT 0, 
                collapse_artist_credits INTEGER DEFAULT 0, 
                duration INTEGER, 
                cover_path TEXT, 
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
                comment TEXT 
            );
            CREATE TABLE artists ( 
                id INTEGER PRIMARY KEY, 
                name TEXT NOT NULL COLLATE NOCASE UNIQUE, 
                avatar_path TEXT 
            );
            CREATE TABLE song_artists ( 
                song_id INTEGER NOT NULL, 
                artist_id INTEGER NOT NULL, 
                sort_order INTEGER NOT NULL DEFAULT 0, 
                PRIMARY KEY (song_id, artist_id), 
                FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE, 
                FOREIGN KEY(artist_id) REFERENCES artists(id) ON DELETE CASCADE 
            );
            CREATE INDEX idx_song_artists_artist_id ON song_artists(artist_id); 
            ",
      )
      .expect("create scanner test schema");
    conn
  }

  /// 每个用例独立的临时目录，避免相互污染。
  fn scratch_dir() -> PathBuf {
    let nanos = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos();
    let dir = std::env::temp_dir().join(format!("xianyu_scan_case_{nanos}"));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
  }

  // ---------- 解析线程预算 ----------

  #[test]
  fn worker_budget_matches_core_count_rules() {
    // 单任务：一个线程就够。
    assert_eq!(worker_budget_for_cores(1, 32), 1);
    // 核少：只留一个核心给系统。
    assert_eq!(worker_budget_for_cores(10, 8), 7);
    assert_eq!(worker_budget_for_cores(10, 4), 3);
    // 核多：留两个核心。
    assert_eq!(worker_budget_for_cores(32, 16), 14);
    assert_eq!(worker_budget_for_cores(32, 24), 22);
    // 任务数封顶。
    assert_eq!(worker_budget_for_cores(3, 16), 3);
  }

  // ---------- 元数据残缺判定 ----------

  #[test]
  fn metadata_gaps_force_reparse() {
    let base = sample_entry("/music/demo.flac");
    assert!(!text_fields_missing(&base));
    assert!(!container_info_absent(&base));

    let no_title = {
      let mut entry = base.clone();
      entry.title.clear();
      entry
    };
    assert!(text_fields_missing(&no_title));

    let no_container = {
      let mut entry = base;
      entry.format.clear();
      entry.container = None;
      entry
    };
    assert!(container_info_absent(&no_container));
  }

  // ---------- 差异计算 ----------

  #[test]
  fn vanished_paths_land_in_delete_list() {
    let dir = scratch_dir();
    let gone_file = dir.join("stale.flac");
    let folder_key = dir.to_string_lossy().replace('\\', "/");
    let song_key = gone_file.to_string_lossy().replace('\\', "/");

    let mut snapshot = HashMap::new();
    snapshot.insert(
      song_key.clone(),
      StoredSongFacts {
        song: sample_entry(&song_key),
        mtime_seconds: Some(10),
        size_bytes: 1024,
      },
    );

    let delta =
      build_scan_delta(&folder_key, snapshot, None, ScanOptions::default()).expect("collect diff");

    assert_eq!(delta.songs.len(), 0);
    assert!(delta.to_add.is_empty());
    assert!(delta.to_update.is_empty());
    assert_eq!(delta.to_delete, vec![song_key]);
    assert!(!delta.has_disk_songs);

    fs::remove_dir_all(dir).expect("remove temp dir");
  }

  #[test]
  fn below_floor_tracks_are_purged() {
    let dir = scratch_dir();
    let short_file = dir.join("short.flac");
    fs::write(&short_file, b"fake flac").expect("write short audio placeholder");

    let folder_key = normalize_path(&dir.to_string_lossy());
    let song_key = normalize_path(&short_file.to_string_lossy());
    let meta = fs::metadata(&short_file).expect("read placeholder metadata");
    let mtime_secs = meta
      .modified()
      .ok()
      .and_then(|stamp| stamp.duration_since(UNIX_EPOCH).ok())
      .map(|elapsed| elapsed.as_secs() as i64);

    let mut short_entry = sample_entry(&song_key);
    short_entry.duration = 4;
    short_entry.file_size = meta.len();
    short_entry.file_modified_at = mtime_secs.map(|value| value as u64);

    let mut snapshot = HashMap::new();
    snapshot.insert(
      song_key.clone(),
      StoredSongFacts {
        song: short_entry,
        mtime_seconds: mtime_secs,
        size_bytes: meta.len() as i64,
      },
    );

    let delta = build_scan_delta(
      &folder_key,
      snapshot,
      None,
      ScanOptions {
        min_duration_secs: 10,
      },
    )
    .expect("collect diff");

    assert!(delta.songs.is_empty());
    assert!(delta.to_add.is_empty());
    assert!(delta.to_update.is_empty());
    assert_eq!(delta.to_delete, vec![song_key]);
    assert!(delta.has_disk_songs);

    fs::remove_dir_all(dir).expect("remove temp dir");
  }

  #[test]
  fn cue_sheet_expands_into_virtual_tracks() {
    let dir = scratch_dir();
    let audio = dir.join("album.flac");
    let sheet = dir.join("album.cue");
    let folder_key = dir.to_string_lossy().to_string();

    fs::write(&audio, b"fake flac").expect("write referenced audio");
    fs::write(
      &sheet,
      concat!(
        "TITLE \"Cue Album\"\n",
        "PERFORMER \"Cue Artist\"\n",
        "FILE \"album.flac\" WAVE\n",
        "  TRACK 01 AUDIO\n",
        "    TITLE \"First\"\n",
        "    INDEX 01 00:00:00\n",
        "  TRACK 02 AUDIO\n",
        "    TITLE \"Second\"\n",
        "    INDEX 01 03:00:00\n",
      ),
    )
    .expect("write cue");

    let delta = build_scan_delta(&folder_key, HashMap::new(), None, ScanOptions::default())
      .expect("collect diff");

    assert_eq!(delta.songs.len(), 2);
    assert_eq!(delta.to_add.len(), 2);
    assert!(delta.songs.iter().all(|song| song.path.contains("::track")));

    fs::remove_dir_all(dir).expect("remove temp dir");
  }

  // ---------- 落库 ----------

  #[test]
  fn scan_batches_persist_songs_and_artist_links() {
    let mut conn = in_memory_library_db();
    let seed = sample_entry("/music/first.flac");

    apply_scan_changes(&mut conn, &[seed.clone()], &[], &[], None).expect("insert batch");

    let stored_title: String = conn
      .query_row(
        "SELECT title FROM songs WHERE path = ?1",
        params![seed.path],
        |row| row.get(0),
      )
      .expect("read inserted song");
    let link_total: i64 = conn
      .query_row("SELECT COUNT(*) FROM song_artists", [], |row| row.get(0))
      .expect("count artist links after insert");
    assert_eq!(stored_title, "Demo");
    assert_eq!(link_total, 1);

    // 改标题与歌手名单后重放：行被整行刷新，关联按新名单重建。
    let mut revised = seed.clone();
    revised.title = String::from("Updated Demo");
    revised.artist = String::from("Updated Artist");
    revised.artist_names = vec!["Updated Artist".to_owned(), "Guest".to_owned()];
    revised.effective_artist_names = revised.artist_names.clone();
    revised.album_artist = String::from("Updated Artist");
    revised.album_key = String::from("album::updated artist");

    apply_scan_changes(&mut conn, &[], &[revised.clone()], &[], None).expect("update batch");

    let revised_title: String = conn
      .query_row(
        "SELECT title FROM songs WHERE path = ?1",
        params![revised.path],
        |row| row.get(0),
      )
      .expect("read updated song");
    let link_names: Vec<String> = conn
      .prepare(
        "SELECT artists.name
                 FROM song_artists 
                 JOIN artists ON artists.id = song_artists.artist_id 
                 ORDER BY song_artists.sort_order ASC", 
      )
      .expect("prepare artist query")
      .query_map([], |row| row.get::<_, String>(0))
      .expect("query artist links")
      .filter_map(Result::ok)
      .collect();
    assert_eq!(revised_title, "Updated Demo");
    assert_eq!(
      link_names,
      vec!["Updated Artist".to_owned(), "Guest".to_owned()]
    );

    // 删除后三张表都应清空：song_artists / artists 靠级联收尾。
    apply_scan_changes(
      &mut conn,
      &[],
      &[],
      std::slice::from_ref(&revised.path),
      None,
    )
    .expect("delete batch");

    let songs_left: i64 = conn
      .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
      .expect("count songs after delete");
    let artists_left: i64 = conn
      .query_row("SELECT COUNT(*) FROM artists", [], |row| row.get(0))
      .expect("count artists after delete");
    let links_left: i64 = conn
      .query_row("SELECT COUNT(*) FROM song_artists", [], |row| row.get(0))
      .expect("count links after delete");
    assert_eq!(songs_left, 0);
    assert_eq!(artists_left, 0);
    assert_eq!(links_left, 0);
  }

  #[test]
  fn slice_width_respects_sqlite_variable_cap() {
    assert!(choose_slice_width(0, 6000) <= 999);
  }

  // ---------- 歌手字段拆分 ----------

  /// 便于断言书写的小包装。
  fn split_names(joined: &str) -> Vec<String> {
    super::split_into_artist_names(joined)
  }

  #[test]
  fn splitting_handles_chinese_and_mixed_separators() {
    assert_eq!(
      split_names("周杰伦、林俊杰、王力宏"),
      vec!["周杰伦", "林俊杰", "王力宏"]
    );
    assert_eq!(
      split_names("歌手A、歌手B & 歌手C"),
      vec!["歌手A", "歌手B", "歌手C"]
    );
    assert_eq!(
      split_names("アーティスト1 、 アーティスト2"),
      vec!["アーティスト1", "アーティスト2"]
    );
  }

  #[test]
  fn splitting_keeps_common_english_separators() {
    assert_eq!(
      split_names("Artist A, Artist B & Artist C"),
      vec!["Artist A", "Artist B", "Artist C"]
    );
    assert_eq!(
      split_names("Artist A; Artist B"),
      vec!["Artist A", "Artist B"]
    );
    assert_eq!(
      split_names("Artist A / Artist B"),
      vec!["Artist A", "Artist B"]
    );
    assert_eq!(
      split_names("Artist A feat. Artist B"),
      vec!["Artist A", "Artist B"]
    );
    assert_eq!(
      split_names("Artist A with Artist B"),
      vec!["Artist A", "Artist B"]
    );
  }

  #[test]
  fn splitting_dedupes_and_keeps_solo_intact() {
    assert_eq!(
      split_names("周杰伦、周杰伦、林俊杰"),
      vec!["周杰伦", "林俊杰"]
    );
    assert_eq!(split_names("周杰伦"), vec!["周杰伦"]);
  }

  // ---------- 歌手判定与头像 ----------

  const MINIMAL_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41, 0x54, 0x78, 0xDA, 0x63, 0x60, 0x00, 0x02, 0x00,
    0x00, 0x05, 0x00, 0x01, 0xE7, 0x2A, 0x24, 0x8C, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
    0xAE, 0x42, 0x60, 0x82,
  ];

  #[test]
  fn lone_real_artist_recognition() {
    let mut single = sample_entry("/music/test.flac");
    single.artist_names = vec!["周杰伦".to_owned()];
    assert_eq!(
      super::exclusive_real_artist(&single),
      Some("周杰伦".to_string())
    );

    let mut duo = sample_entry("/music/test.flac");
    duo.artist_names = vec!["周杰伦".to_owned(), "方文山".to_owned()];
    assert!(super::exclusive_real_artist(&duo).is_none());

    let mut masked = sample_entry("/music/test.flac");
    masked.artist_names = vec!["未知歌手".to_owned()];
    assert!(super::exclusive_real_artist(&masked).is_none());
  }

  #[test]
  fn avatar_bytes_pass_format_gate() {
    let dir = scratch_dir();

    // 合法 PNG 应被接受并落成 .png 文件。
    let saved = crate::music::covers::save_artist_avatar_auto(MINIMAL_PNG, &dir);
    assert!(saved.is_some());
    assert!(saved.unwrap().ends_with(".png"));

    // 无关字节串应被拒收。
    let junk = vec![0x11, 0x22, 0x33, 0x44];
    assert!(crate::music::covers::save_artist_avatar_auto(&junk, &dir).is_none());

    let _ = std::fs::remove_dir_all(dir);
  }

  #[test]
  fn existing_avatar_path_is_never_clobbered() {
    let mut conn = in_memory_library_db();
    let mut seeded = sample_entry("/music/test.flac");
    seeded.artist_names = vec!["周杰伦".to_owned()];
    seeded.artist_avatar_path = Some("/cache/avatar.jpg".to_string());

    apply_scan_changes(&mut conn, &[seeded.clone()], &[], &[], None).unwrap();
    let stored: Option<String> = conn
      .query_row(
        "SELECT avatar_path FROM artists WHERE name = '周杰伦'",
        [],
        |row| row.get(0),
      )
      .unwrap();
    assert_eq!(stored, Some("/cache/avatar.jpg".to_string()));

    // 复扫带来新头像路径时，已存在的头像路径必须保持不动。
    let mut refreshed = seeded;
    refreshed.artist_avatar_path = Some("/cache/new_avatar.jpg".to_string());
    apply_scan_changes(&mut conn, &[], &[refreshed], &[], None).unwrap();

    let stored_again: Option<String> = conn
      .query_row(
        "SELECT avatar_path FROM artists WHERE name = '周杰伦'",
        [],
        |row| row.get(0),
      )
      .unwrap();
    assert_eq!(stored_again, Some("/cache/avatar.jpg".to_string()));
  }
}
