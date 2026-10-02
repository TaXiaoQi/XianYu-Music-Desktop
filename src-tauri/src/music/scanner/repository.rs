//! 差异落库子模块。接手 diff 阶段给出的 新增/更新/删除 三份清单，
//! 按分片、分事务写入 songs 表，并同步维护 artists 与 song_artists。
//!
//! 分片规则：空库且一次插入量可观（首次灌库）放宽分片；其余走小分片。
//! 所有分片尺寸都刻意压在 SQLite 变量数上限之下，绝不触碰边界。

use super::progress::ScanProgressReporter as ScanPipe;
use super::{encode_json_list, narrow_u64_opt_to_i64, narrow_u64_to_i64, ARTIST_FALLBACK_TEXT};
use crate::music::types::Song;
use rusqlite::params;
use rusqlite::params_from_iter;
use std::collections::HashMap;

/// 首次灌库（空库）时每个分片的行数，贴近但不触碰变量数上限。
const BULK_SEED_SLICE_ROWS: usize = 900;
/// 常规写入时每个分片的行数。
const REGULAR_SLICE_ROWS: usize = 100;

// 下面两条大 SQL 属于冻结面：列顺序与 ?N 占位符必须逐字节保持原样。
// 注意 UPDATE 语句的占位符编号怪癖：路径参数排在第 23 位（WHERE path = ?23），
// cue 三字段与 comment 依次占用 ?24~?27。

const SQL_SONGS_UPSERT: &str = "INSERT INTO songs (
                path,
                title,
                artist,
                artist_names, 
                effective_artist_names, 
                album,
                album_artist, 
                album_key,
                is_various_artists_album, 
                collapse_artist_credits, 
                duration,
                cover_thumb_path, 
                bitrate,
                sample_rate, 
                bit_depth,
                format,
                container,
                codec,
                file_size,
                track_number, 
                disc_number, 
                added_at,
                file_modified_at, 
                cue_source_path, 
                cue_start_offset, 
                cue_end_offset, 
                comment
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27) 
             ON CONFLICT(path) DO UPDATE SET 
                title = excluded.title, 
                artist = excluded.artist, 
                artist_names = excluded.artist_names, 
                effective_artist_names = excluded.effective_artist_names, 
                album = excluded.album, 
                album_artist = excluded.album_artist, 
                album_key = excluded.album_key, 
                is_various_artists_album = excluded.is_various_artists_album, 
                collapse_artist_credits = excluded.collapse_artist_credits, 
                duration = excluded.duration, 
                cover_thumb_path = excluded.cover_thumb_path, 
                bitrate = excluded.bitrate, 
                sample_rate = excluded.sample_rate, 
                bit_depth = excluded.bit_depth, 
                format = excluded.format, 
                container = excluded.container, 
                codec = excluded.codec, 
                file_size = excluded.file_size, 
                track_number = excluded.track_number, 
                disc_number = excluded.disc_number, 
                added_at = excluded.added_at, 
                file_modified_at = excluded.file_modified_at, 
                cue_source_path = excluded.cue_source_path, 
                cue_start_offset = excluded.cue_start_offset, 
                cue_end_offset = excluded.cue_end_offset, 
                comment = excluded.comment";

const SQL_SONGS_UPDATE: &str = "UPDATE songs
             SET title = ?1, 
                 artist = ?2, 
                 artist_names = ?3, 
                 effective_artist_names = ?4, 
                 album = ?5,
                 album_artist = ?6, 
                 album_key = ?7, 
                  is_various_artists_album = ?8, 
                  collapse_artist_credits = ?9, 
                  duration = ?10, 
                  cover_thumb_path = ?11, 
                  bitrate = ?12, 
                  sample_rate = ?13, 
                  bit_depth = ?14, 
                  format = ?15, 
                  container = ?16, 
                  codec = ?17, 
                  file_size = ?18, 
                  track_number = ?19, 
                  disc_number = ?20, 
                  added_at = ?21, 
                  file_modified_at = ?22, 
                  cue_source_path = ?24, 
                  cue_start_offset = ?25, 
                  cue_end_offset = ?26, 
                  comment = ?27 
              WHERE path = ?23";

/// 依库内已有行数与待插入量挑分片宽度：
/// 空库且待插入不少于 500 首 → 900 行；其余一律 100 行。
pub(super) fn choose_slice_width(existing_rows: i64, additions: usize) -> usize {
  let bulk_seed = existing_rows == 0 && additions >= 500;
  if bulk_seed {
    BULK_SEED_SLICE_ROWS
  } else {
    REGULAR_SLICE_ROWS
  }
}

/// 一首曲目的列值整备产物：JSON 编码、u64 收窄、布尔转整型都已完成，
/// 供插入与更新两条 SQL 共用，避免两边各写一套转换逻辑。
struct PreparedRow {
  names_json: String,
  shown_json: String,
  size_i64: i64,
  added_i64: Option<i64>,
  mtime_i64: Option<i64>,
  various_i64: i64,
  folded_i64: i64,
  depth_i64: Option<i64>,
  cue_from_i64: Option<i64>,
  cue_to_i64: Option<i64>,
}

/// 按 songs 表的列约定整备一首曲目的全部派生值。
fn prepare_row(song: &Song) -> Result<PreparedRow, String> {
  Ok(PreparedRow {
    names_json: encode_json_list(&song.artist_names)?,
    shown_json: encode_json_list(&song.effective_artist_names)?,
    size_i64: narrow_u64_to_i64(song.file_size),
    added_i64: narrow_u64_opt_to_i64(song.added_at),
    mtime_i64: narrow_u64_opt_to_i64(song.file_modified_at),
    various_i64: i64::from(song.is_various_artists_album),
    folded_i64: i64::from(song.collapse_artist_credits),
    depth_i64: song.bit_depth.map(i64::from),
    cue_from_i64: song.cue_start_offset.map(i64::from),
    cue_to_i64: song.cue_end_offset.map(i64::from),
  })
}

/// 按 SQL_SONGS_UPSERT 的列序绑定参数并执行。
fn run_insert(
  stmt: &mut rusqlite::Statement<'_>,
  song: &Song,
  row: &PreparedRow,
) -> Result<usize, rusqlite::Error> {
  stmt.execute(params![
    // ?1~?27 与 SQL_SONGS_UPSERT 的列序一一对应（两两成组便于核对）。
    &song.path,
    &song.title,
    &song.artist,
    &row.names_json,
    &row.shown_json,
    &song.album,
    &song.album_artist,
    &song.album_key,
    row.various_i64,
    row.folded_i64,
    song.duration as i64,
    &song.cover_thumb_path,
    song.bitrate as i64,
    song.sample_rate as i64,
    row.depth_i64,
    &song.format,
    &song.container,
    &song.codec,
    row.size_i64,
    &song.track_number,
    &song.disc_number,
    row.added_i64,
    row.mtime_i64,
    &song.cue_source_path,
    row.cue_from_i64,
    row.cue_to_i64,
    &song.comment
  ])
}

/// 按 SQL_SONGS_UPDATE 的列序绑定参数并执行；路径占位符位于第 23 位。
fn run_update(
  stmt: &mut rusqlite::Statement<'_>,
  song: &Song,
  row: &PreparedRow,
) -> Result<usize, rusqlite::Error> {
  stmt.execute(params![
    // ?1~?22、?24~?27 依 SET 子句排列，?23 是 WHERE 的路径（错位分组防呆）。
    &song.title,
    &song.artist,
    &row.names_json,
    &row.shown_json,
    &song.album,
    &song.album_artist,
    &song.album_key,
    row.various_i64,
    row.folded_i64,
    song.duration as i64,
    &song.cover_thumb_path,
    song.bitrate as i64,
    song.sample_rate as i64,
    row.depth_i64,
    &song.format,
    &song.container,
    &song.codec,
    row.size_i64,
    &song.track_number,
    &song.disc_number,
    row.added_i64,
    row.mtime_i64,
    &song.path,
    &song.cue_source_path,
    row.cue_from_i64,
    row.cue_to_i64,
    &song.comment
  ])
}

/// 打开一个写事务；失败统一转成字符串错误上抛。
fn open_write_tx<'conn>(
  conn: &'conn mut rusqlite::Connection,
) -> Result<rusqlite::Transaction<'conn>, String> {
  conn.transaction().map_err(|err| err.to_string())
}

/// 分片写入的两种形态：Upsert 落新增，Refresh 落更新。
#[derive(Clone, Copy)]
enum SliceMode {
  Upsert,
  Refresh,
}

impl SliceMode {
  fn sql(self) -> &'static str {
    match self {
      SliceMode::Upsert => SQL_SONGS_UPSERT,
      SliceMode::Refresh => SQL_SONGS_UPDATE,
    }
  }
}

/// 拿到歌手行 id：名字（小写）先查名册缓存，未命中就补插一行再回查。
fn resolve_artist_id(
  tx: &rusqlite::Transaction<'_>,
  roster: &mut HashMap<String, i64>,
  name: &str,
) -> Result<i64, String> {
  let lookup_key = name.to_lowercase();
  if let Some(&hit) = roster.get(&lookup_key) {
    return Ok(hit);
  }

  tx.execute(
    "INSERT INTO artists (name) VALUES (?1)
         ON CONFLICT(name) DO NOTHING",
    params![name],
  )
  .map_err(|err| err.to_string())?;

  let found_id: i64 = tx
    .query_row(
      "SELECT id FROM artists WHERE name = ?1 COLLATE NOCASE",
      params![name],
      |row| row.get(0),
    )
    .map_err(|err| err.to_string())?;

  roster.insert(lookup_key, found_id);
  Ok(found_id)
}

/// 按路径清单查歌曲行 id，汇成 path → rowid 的对照表。
fn map_paths_to_rowids(
  tx: &rusqlite::Transaction<'_>,
  wanted: &[String],
) -> Result<HashMap<String, i64>, String> {
  if wanted.is_empty() {
    return Ok(HashMap::new());
  }

  let marks = vec!["?"; wanted.len()].join(", ");
  let lookup_sql = format!("SELECT path, id FROM songs WHERE path IN ({marks})");
  let mut lookup = tx.prepare(&lookup_sql).map_err(|err| err.to_string())?;
  let pairs = lookup
    .query_map(params_from_iter(wanted.iter()), |row| {
      let path_text: String = row.get(0)?;
      let row_id: i64 = row.get(1)?;
      Ok((path_text, row_id))
    })
    .map_err(|err| err.to_string())?;

  Ok(pairs.filter_map(Result::ok).fold(
    HashMap::with_capacity(wanted.len()),
    |mut index, (path, id)| {
      index.insert(path, id);
      index
    },
  ))
}

/// 重挂一批曲目的歌手关联：先抹旧关联（可选），再按展示顺序逐条插入。
///
/// 只归属一个真实歌手的曲目会顺带回填头像路径（歌手已有头像则不动）。
/// `wipe_first` 供首次灌库使用——那时不存在旧关联，抹除可以省略。
fn restamp_song_artist_links(
  tx: &rusqlite::Transaction<'_>,
  batch: &[Song],
  rowids: &HashMap<String, i64>,
  roster: &mut HashMap<String, i64>,
  wipe_first: bool,
) -> Result<(), String> { // 实现
  if batch.is_empty() || rowids.is_empty() {
    return Ok(());
  }

  let mut eraser = if wipe_first {
    Some(
      tx.prepare("DELETE FROM song_artists WHERE song_id = ?1")
        .map_err(|err| err.to_string())?,
    )
  } else {
    None
  };
  let mut linker = tx
    .prepare(
      "INSERT INTO song_artists (song_id, artist_id, sort_order)
             VALUES (?1, ?2, ?3)",
    )
    .map_err(|err| err.to_string())?;

  for track in batch {
    let Some(&row_id) = rowids.get(&track.path) else {
      continue;
    };

    if let Some(wiper) = eraser.as_mut() {
      wiper
        .execute(params![row_id])
        .map_err(|err| err.to_string())?;
    }

    // 展示名单兜底：空列表按单一未知歌手处理，保证每首歌至少挂一条。
    let unknown_fallback = String::from(ARTIST_FALLBACK_TEXT);
    let credited: Vec<&str> = if track.artist_names.is_empty() {
      vec![unknown_fallback.as_str()]
    } else {
      track.artist_names.iter().map(String::as_str).collect()
    };
    let lone_singer = super::exclusive_real_artist(track).is_some();

    for (order, name) in credited.iter().enumerate() {
      let artist_id = resolve_artist_id(tx, roster, name)?;
      linker
        .execute(params![row_id, artist_id, order as i64])
        .map_err(|err| err.to_string())?;

      if lone_singer {
        if let Some(avatar) = &track.artist_avatar_path {
          let stamping = tx.execute(
            "UPDATE artists
                         SET avatar_path = ?1
                         WHERE id = ?2
                           AND (avatar_path IS NULL OR TRIM(avatar_path) = '')",
            params![Some(avatar), artist_id],
          );
          stamping.map_err(|error| format!("Failed to update artist avatar: {}", error))?;
        }
      }
    }
  }

  Ok(())
}

/// 一个分片的写入骨架：开事务 → 逐首写 songs 行 → 重挂歌手关联 → 提交。
fn write_song_slice(
  conn: &mut rusqlite::Connection,
  batch: &[Song],
  roster: &mut HashMap<String, i64>,
  mode: SliceMode,
  wipe_links_first: bool,
) -> Result<(), String> { // 实现
  if batch.is_empty() {
    return Ok(());
  }

  let tx = open_write_tx(conn)?;
  {
    let mut stmt = tx.prepare(mode.sql()).map_err(|err| err.to_string())?;
    for song in batch {
      let row = prepare_row(song)?;
      let outcome = match mode {
        SliceMode::Upsert => run_insert(&mut stmt, song, &row),
        SliceMode::Refresh => run_update(&mut stmt, song, &row),
      };
      outcome.map_err(|error| match mode {
        SliceMode::Upsert => format!("insert failed for '{}': {}", song.path, error),
        SliceMode::Refresh => format!("update failed for '{}': {}", song.path, error),
      })?;
    }

    let wanted: Vec<String> = batch.iter().map(|song| song.path.clone()).collect();
    let rowids = map_paths_to_rowids(&tx, &wanted)?;
    restamp_song_artist_links(&tx, batch, &rowids, roster, wipe_links_first)?;
  }

  tx.commit().map_err(|err| err.to_string())
}

/// 新增分片：首灌库时省略旧关联抹除，其余照常先抹再挂。
fn flush_added_slice(
  conn: &mut rusqlite::Connection,
  batch: &[Song],
  roster: &mut HashMap<String, i64>,
  bulk_seed: bool,
) -> Result<(), String> { // 实现
  write_song_slice(conn, batch, roster, SliceMode::Upsert, !bulk_seed)
}

/// 更新分片：总是先抹旧关联再按新名单重挂。
fn flush_updated_slice(
  conn: &mut rusqlite::Connection,
  batch: &[Song],
  roster: &mut HashMap<String, i64>,
) -> Result<(), String> { // 实现
  write_song_slice(conn, batch, roster, SliceMode::Refresh, true)
}

/// 删除分片：单事务内按路径移除；关联行交给外键级联。
fn flush_deleted_slice(conn: &mut rusqlite::Connection, gone: &[String]) -> Result<(), String> {
  if gone.is_empty() {
    return Ok(());
  }

  let tx = open_write_tx(conn)?;
  {
    let mut wiper = tx
      .prepare("DELETE FROM songs WHERE path = ?1")
      .map_err(|err| err.to_string())?;

    for path in gone {
      let removal = wiper.execute(params![path]);
      removal.map_err(|error| format!("delete failed for '{}': {}", path, error))?;
    }
  }

  tx.commit().map_err(|err| err.to_string())
}

/// 清掉不再被任何曲目引用的歌手行；这步是收尾优化，失败不惊动主流程。
fn sweep_orphan_artists(conn: &mut rusqlite::Connection) {
  let _ = conn.execute(
    "DELETE FROM artists
         WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)", 
    [],
  );
}

/// 一个分片完成后的广播：推 writing 进度，并把该分片增量塞进批量队列。
fn broadcast_slice(
  reporter: Option<&ScanPipe>,
  done: usize,
  planned_total: usize,
  fresh: &[Song],
  gone: &[String],
) {
  if let Some(pipe) = reporter {
    pipe.report_writing(done, planned_total);
    pipe.queue_delta(fresh.to_vec(), gone.to_vec());
  }
}

/// 整批扫描变更的落库入口：三份清单分别分片执行，每个分片完成后
/// 推一条 writing 进度并把该分片增量塞进批量队列，最后清理孤儿歌手。
pub(crate) fn apply_scan_changes( // apply_scan_changes
  conn: &mut rusqlite::Connection,
  to_add: &[Song],
  to_update: &[Song],
  to_delete: &[String],
  reporter: Option<&ScanPipe>,
) -> Result<(), String> { // 实现
  // 三份清单全空：仍补一条归零的 writing 帧，方便前端复位界面。
  let nothing_to_do = to_add.is_empty() && to_update.is_empty() && to_delete.is_empty();
  if nothing_to_do {
    if let Some(pipe) = reporter {
      pipe.report_writing(0, 0);
    }
    return Ok(());
  }

  let existing_rows = conn
    .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get::<_, i64>(0))
    .unwrap_or(0);
  // 首导判定：库内一无所知且本次新增量可观，此时才放宽分片。
  let bulk_seed = existing_rows == 0 && to_add.len() >= 500;
  let slice_width = choose_slice_width(existing_rows, to_add.len());

  let mut roster = HashMap::<String, i64>::new();
  let planned_total = to_add.len() + to_update.len() + to_delete.len();
  let mut done_rows: usize = 0;
  if let Some(pipe) = reporter {
    pipe.report_writing(0, planned_total);
  }

  for slice in to_add.chunks(slice_width) {
    flush_added_slice(conn, slice, &mut roster, bulk_seed)?;
    done_rows += slice.len();
    broadcast_slice(reporter, done_rows, planned_total, slice, &[]);
  }

  for slice in to_update.chunks(slice_width) {
    flush_updated_slice(conn, slice, &mut roster)?;
    done_rows += slice.len();
    broadcast_slice(reporter, done_rows, planned_total, slice, &[]);
  }

  for slice in to_delete.chunks(slice_width) {
    flush_deleted_slice(conn, slice)?;
    done_rows += slice.len();
    broadcast_slice(reporter, done_rows, planned_total, &[], slice);
  }

  sweep_orphan_artists(conn);
  Ok(())
}
