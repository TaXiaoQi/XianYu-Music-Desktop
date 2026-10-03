// 「全部歌曲」视图：全量缓存曲目与可叠加过滤排序的路径清单。

use tauri::State;

use crate::database::{DbState};
use crate::music::types::LibrarySong;

use super::common::{prepare, read_song_cache, run_with_db, string_column};
use super::LibrarySongSortMode;

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

/// 全量缓存曲目（按文件名排序）。
#[tauri::command] // 实现
pub async fn get_library_songs_cached( // 实现
  db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySong>, String> { // 实现
  run_with_db(&db_state, |conn| read_song_cache(conn)).await
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
