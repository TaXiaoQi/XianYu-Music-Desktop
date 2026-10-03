// 文件夹视图与目录树：直接子项路径清单、全库层级展开与子目录浏览。

use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::database::{DbState};
use crate::music::scanner::scan_folder_recursive;
use crate::music::types::FolderNode;
use crate::music::utils::{ // 实现
  descendant_like_patterns, i64_to_u64_opt, normalize_path,
};
use crate::security::path_validator;

use super::common::{db_err, decode_name_list, file_display_name, prepare, run_with_db, string_column};
use super::FolderSongSortMode;

// ---------- 路径与文本小工具 ----------

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
pub(super) fn leading_track_digits(label: &Option<String>) -> Option<i32> {
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
pub(super) struct FolderRow {
  pub(super) path: String,
  pub(super) title: String,
  pub(super) artist: String,
  pub(super) album: String,
  pub(super) album_artist: String,
  pub(super) raw_artist_names: Vec<String>,
  pub(super) effective_names: Vec<String>,
  pub(super) added_stamp: Option<u64>,
  pub(super) track_no: Option<String>,
  pub(super) disc_no: Option<String>,
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
pub(super) fn compare_folder_rows(left: &FolderRow, right: &FolderRow, mode: &FolderSongSortMode) -> Ordering {
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

// ---------- 目录项的标签辅助 ----------

// 目录条目的排序标签：取不到名字时退化为完整路径。
fn dir_entry_label(path: &Path) -> String {
  path
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_else(|| path.to_string_lossy().into_owned())
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
