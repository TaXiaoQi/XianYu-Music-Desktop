// 弦予曲库查询门面（原创重写版）。
// 本文件只面向缓存表 songs / library_folders 提供读取与目录维护能力：
//   · 根目录的登记、移除、统计与目录树展开；
//   · 全量曲目读取、双桶搜索、歌手 / 专辑目录、视图路径清单与排序。
// 磁盘遍历一律交给 scanner 链，这里不做任何文件系统扫描。
// 契约提醒：文中所有 SQL 语句、对外错误文案、emit 事件与 serde 字段名
// 均为既定契约，逐字冻结，重写时不得改动。

mod catalog;
mod common;
mod folders;
mod scan;
mod search;
mod songs;
mod tree;

use serde::Deserialize;

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

// ---------- 命令 ----------
pub use catalog::{
  get_library_album_catalog, get_library_artist_catalog, get_library_song_paths_by_album,
  get_library_song_paths_by_artist,
};
pub use folders::{add_library_folder, get_library_folders, remove_library_folder};
pub use scan::scan_library;
pub use search::search_library_songs;
pub use songs::{get_library_song_paths_for_all_view, get_library_songs_cached};
pub use tree::{
  get_folder_children, get_library_hierarchy, get_library_song_paths_for_folder_view,
};

// 供下方单元测试引用的内部辅助（仅测试构建引入）。
#[cfg(test)]
use common::read_song_cache;
#[cfg(test)]
use folders::delete_folder_subtree;
#[cfg(test)]
use tree::{compare_folder_rows, leading_track_digits, FolderRow};

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
