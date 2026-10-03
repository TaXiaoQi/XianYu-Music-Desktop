// 曲库查询的共享底座：数据库执行辅助、缓存曲目行映射与展示名小工具。

use std::path::Path;

use crate::database::{DbState};
use crate::music::types::LibrarySong;
use crate::music::utils::{ // 实现
  clamp_i64_to_u32, i64_to_u64_opt, i64_to_u8_opt,
};

// ---------- 数据库执行底座 ----------

// rusqlite 错误统一折算成字符串，收敛散落的闭包写法。
pub(super) fn db_err(err: rusqlite::Error) -> String {
  err.to_string()
}

// 预编译语句的小包装，出错时同样折算成字符串。
pub(super) fn prepare<'a>(
  conn: &'a rusqlite::Connection,
  sql: &str,
) -> Result<rusqlite::Statement<'a>, String> {
  conn.prepare(sql).map_err(db_err)
}

// 取结果集第 0 列的字符串值；单行取值失败与空值都按「跳过」处理，
// 与旧的 filter_map(ok) 语义一致。
pub(super) fn string_column(
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
pub(super) async fn run_with_db<T, F>(db_state: &DbState, task: F) -> Result<T, String>
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

// 缓存曲目整行投影；列序与 song_from_row 内的下标严格对应，动一处必动另一处。
// 下标 17/18/19（container/codec/file_size）暂不进模型，映射时跳过。
pub(super) const SONG_CACHE_COLUMNS: &str = "id, path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, cover_thumb_path, bitrate, sample_rate, bit_depth, format, container, codec, file_size, track_number, disc_number, added_at, file_modified_at, cue_source_path, cue_start_offset, cue_end_offset, source_type, remote_source_id, comment";

// JSON 字符串列表列 → Vec<String>；空值或坏 JSON 一律按空列表处理。
pub(super) fn decode_name_list(raw: Option<String>) -> Vec<String> {
  raw
    .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
    .unwrap_or_default()
}

// songs 表整行 → LibrarySong；列下标见 SONG_CACHE_COLUMNS。
pub(super) fn song_from_row(row: &rusqlite::Row) -> rusqlite::Result<LibrarySong> {
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
pub(super) fn read_song_cache(conn: &rusqlite::Connection) -> Result<Vec<LibrarySong>, String> {
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

// 文件名标签：取不到文件名时原样返回整条路径。
pub(super) fn file_display_name(path: &str) -> String {
  Path::new(path)
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_else(|| path.to_string())
}
