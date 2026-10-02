//! 磁盘盘点与差异计算子模块。对指定文件夹做两件事：
//!
//! 1. **快照加载** —— 从 songs 表捞出该文件夹（含全部子目录）的现有曲目；
//! 2. **求差** —— 与磁盘盘点结果对比，产出 新增/更新/删除 三份清单，
//!    以及合并后的全量曲目列表。
//!
//! 求差规则：
//! - 已入库曲目只在 mtime/体积变化、或库内元数据残缺时才重新解码，其余复用；
//! - CUE 文件展开成若干合成音轨（路径形如 `<cue>::trackNN`），被引用的
//!   整轨音频不再单独参与差异；
//! - 低于最短时长门槛的既有曲目进入删除清单，新文件则直接丢弃；
//! - 快照里没被磁盘命中的路径一律删除。

use crate::music::cue;
use crate::music::types::Song;
use super::super::utils::{ // 实现
  descendant_like_patterns, is_cue_file_extension, is_supported_library_extension, normalize_path,
};
use super::parser::{ // 实现
  apply_album_grouping, assemble_cue_track_song, container_info_absent, parse_song_from_file,
  plan_parse_workers, text_fields_missing,
};
use crate::music::scanner::progress::ScanProgressReporter;
use super::ScanOptions;
use crate::music::utils::{clamp_i64_to_u32, i64_to_bool, i64_to_u64_opt, i64_to_u8_opt};
use rayon::prelude::*; // 实现
use rusqlite::{params};
use std::collections::{HashMap, HashSet};
use std::path::{PathBuf, Path};
use symphonia::core::codecs::CODEC_TYPE_NULL;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use walkdir::{WalkDir};

// ---------- 数据载体 ----------

/// 库内一首歌的快照事实：完整实体 + 记录时的 mtime 与体积。
pub(super) struct StoredSongFacts {
  pub(super) song: Song,
  pub(super) mtime_seconds: Option<i64>,
  pub(super) size_bytes: i64,
}

/// 一次差异计算的产出：合并后的全量曲目 + 增/改/删三份清单。
pub(super) struct FolderDiff {
  pub(super) songs: Vec<Song>,
  pub(super) to_add: Vec<Song>,
  pub(super) to_update: Vec<Song>,
  pub(super) to_delete: Vec<String>,
  pub(super) has_disk_songs: bool,
}

/// 磁盘上发现的一个候选条目（真实音频文件或 CUE 合成音轨）。
struct FoundCandidate {
  path: PathBuf,
  path_text: String,
  ext: String,
  mtime: Option<i64>,
  size: i64,
}

/// 一个待解码任务。slot 指回候选列表中的位置；is_new 区分新增/既有。
struct DecodeTask {
  slot: usize,
  path: PathBuf,
  path_text: String,
  ext: String,
  is_new: bool,
}

/// 解码任务的产物。song 为 None 表示该既有曲目已不达标（转入删除清单）。
struct DecodeOutcome {
  slot: usize,
  path_text: String,
  song: Option<Song>,
  is_new: bool,
}

// ---------- 小工具 ----------

/// 系统时间 → Unix 秒（i64）；早于纪元返回 None。
fn to_epoch_secs_i64(stamp: std::time::SystemTime) -> Option<i64> {
  stamp
    .duration_since(std::time::UNIX_EPOCH)
    .ok()
    .map(|delta| delta.as_secs() as i64)
}

/// 遍历根目录下的所有普通文件（跳过无法访问的条目）。
fn walk_disk_files(root: &str) -> impl Iterator<Item = walkdir::DirEntry> {
  WalkDir::new(root)
    .into_iter()
    .filter_map(|entry| entry.ok())
    .filter(|entry| entry.file_type().is_file())
}

/// 是否通过最短时长门槛（门槛为 0 表示不过滤）。
fn within_duration_floor(entry: &Song, options: ScanOptions) -> bool {
  options.min_duration_secs == 0 || entry.duration >= options.min_duration_secs
}

/// 统一裁决一个解码结果：
/// 过门槛 → 收下；没过门槛 → 既有曲目回传 None 触发删除，新文件直接丢弃；
/// 解码本身失败 → 什么都不产生（库内原行保持原样）。
fn classify_decoded(
  task: &DecodeTask,
  decoded: Option<Song>,
  options: &ScanOptions,
) -> Option<DecodeOutcome> {
  let song = decoded?;
  if within_duration_floor(&song, *options) {
    return Some(DecodeOutcome {
      slot: task.slot,
      path_text: task.path_text.clone(),
      song: Some(song),
      is_new: task.is_new,
    });
  }

  (!task.is_new).then(|| DecodeOutcome {
    slot: task.slot,
    path_text: task.path_text.clone(),
    song: None,
    is_new: task.is_new,
  })
}

// ---------- 快照加载 ----------

/// 从 songs 表加载指定文件夹（含全部后代）的曲目快照。
///
/// 语句属冻结面：LIKE 模式列序、ESCAPE 写法均不可调整。
pub(super) fn load_db_snapshot(
  conn: &rusqlite::Connection,
  normalized_folder: &str,
) -> Result<HashMap<String, StoredSongFacts>, String> {
  let (pattern_a, pattern_b) = descendant_like_patterns(normalized_folder);
  let mut snapshot: HashMap<String, StoredSongFacts> = HashMap::new();

  let mut stmt = conn
        .prepare(
                "SELECT id, path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, cover_thumb_path, bitrate, sample_rate, bit_depth, format, container, codec, file_size, track_number, disc_number, added_at, file_modified_at, cue_source_path, cue_start_offset, cue_end_offset, comment 
             FROM songs
             WHERE path = ?1 
                OR path LIKE ?2 ESCAPE '^' 
                OR path LIKE ?3 ESCAPE '^'", 
        )
        .map_err(|error| error.to_string())?; // 实现

  let rows = stmt
    .query_map(params![normalized_folder, pattern_a, pattern_b], |row| {
      // 列下标与上方 SELECT 的列顺序一一对应。
      let path_text: String = row.get(1)?;
      let stored_title: Option<String> = row.get(2)?;
      let stored_artist: Option<String> = row.get(3)?;
      let names_json = super::json_list_from_column(row.get::<_, Option<String>>(4)?);
      let shown_json = super::json_list_from_column(row.get::<_, Option<String>>(5)?);
      let stored_album: Option<String> = row.get(6)?;
      let stored_album_artist: Option<String> = row.get(7)?;
      let stored_album_key: Option<String> = row.get(8)?;
      let flag_various = i64_to_bool(row.get::<_, Option<i64>>(9)?);
      let flag_folded = i64_to_bool(row.get::<_, Option<i64>>(10)?);
      let stored_duration = clamp_i64_to_u32(row.get::<_, Option<i64>>(11)?.unwrap_or(0));
      let stored_thumb: Option<String> = row.get(12)?;
      let stored_bitrate = clamp_i64_to_u32(row.get::<_, Option<i64>>(13)?.unwrap_or(0));
      let stored_hz = clamp_i64_to_u32(row.get::<_, Option<i64>>(14)?.unwrap_or(0));
      let stored_depth = i64_to_u8_opt(row.get::<_, Option<i64>>(15)?);
      let stored_format: Option<String> = row.get(16)?;
      let stored_container: Option<String> = row.get(17)?;
      let stored_codec: Option<String> = row.get(18)?;
      let stored_size = row.get::<_, Option<i64>>(19)?.unwrap_or(0).max(0);
      let stored_track: Option<String> = row.get(20)?;
      let stored_disc: Option<String> = row.get(21)?;
      let stored_added = i64_to_u64_opt(row.get::<_, Option<i64>>(22)?);
      let raw_mtime: Option<i64> = row.get(23)?;
      let stored_mtime = i64_to_u64_opt(raw_mtime);
      let stored_cue_src: Option<String> = row.get(24)?;
      let stored_cue_from = row.get::<_, Option<i64>>(25)?.map(|value| value as u32);
      let stored_cue_to = row.get::<_, Option<i64>>(26)?.map(|value| value as u32);
      let stored_note: Option<String> = row.get(27)?;

      let display_name = Path::new(&path_text)
        .file_name()
        .map(|piece| piece.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_text.clone());

      Ok((
        path_text.clone(),
        StoredSongFacts {
          mtime_seconds: raw_mtime,
          size_bytes: stored_size,
          song: Song {
            id: row.get::<_, i64>(0).ok(),
            artist_avatar_bytes: None,
            name: display_name,
            path: path_text,
            title: stored_title.unwrap_or_default(),
            artist: stored_artist.unwrap_or_default(),
            artist_names: names_json,
            effective_artist_names: shown_json,
            album: stored_album.unwrap_or_default(),
            album_artist: stored_album_artist.unwrap_or_default(),
            album_key: stored_album_key.unwrap_or_default(),
            is_various_artists_album: flag_various,
            collapse_artist_credits: flag_folded,
            duration: stored_duration,
            cover_thumb_path: stored_thumb,
            bitrate: stored_bitrate,
            sample_rate: stored_hz,
            bit_depth: stored_depth,
            format: stored_format.unwrap_or_default(),
            container: stored_container,
            codec: stored_codec,
            file_size: stored_size as u64,
            track_number: stored_track,
            disc_number: stored_disc,
            added_at: stored_added,
            file_modified_at: stored_mtime,
            cue_source_path: stored_cue_src,
            cue_start_offset: stored_cue_from,
            cue_end_offset: stored_cue_to,
            comment: stored_note,
            artist_avatar_path: None,
          },
        },
      ))
    })
    .map_err(|error| error.to_string())?;

  for pair in rows.flatten() {
    snapshot.insert(pair.0, pair.1);
  }

  Ok(snapshot)
}

// ---------- 磁盘盘点 ----------

/// 两遍遍历收集磁盘候选：先音频文件，再 CUE 展开的合成音轨，
/// 最后剔除被 CUE 引用的整轨音频。
fn inventory_candidates(
  normalized_folder: &str,
  reporter: Option<&ScanProgressReporter>,
) -> Vec<FoundCandidate> {
  if let Some(notifier) = reporter {
    notifier.emit_collecting(0, 0, Some("正在扫描文件夹".to_string()));
  }

  let mut candidates: Vec<FoundCandidate> = Vec::new();
  let mut seen_count = 0usize;

  // 第一遍：受支持格式的音频文件。
  for entry in walk_disk_files(normalized_folder) {
    let Some(ext) = entry
      .path()
      .extension()
      .map(|piece| piece.to_string_lossy().to_lowercase())
    else {
      continue;
    };
    if !is_supported_library_extension(&ext) {
      continue;
    }
    let Ok(meta) = entry.metadata() else {
      continue;
    };

    seen_count += 1;
    candidates.push(FoundCandidate {
      path: entry.path().to_path_buf(),
      path_text: normalize_path(&entry.path().to_string_lossy()),
      ext,
      mtime: meta.modified().ok().and_then(to_epoch_secs_i64),
      size: meta.len() as i64,
    });

    if let Some(notifier) = reporter {
      // 首个与每第 200 个候选各推一次进度。
      if seen_count == 1 || seen_count % 200 == 0 {
        notifier.emit_collecting(
          seen_count,
          0,
          Some(format!("已发现 {} 首候选歌曲", seen_count)),
        );
      }
    }
  }

  // 第二遍：CUE 文件 → 合成音轨 + 被引用整轨登记。
  let mut referenced_audio: HashSet<String> = HashSet::new();
  for entry in walk_disk_files(normalized_folder) {
    let Some(ext) = entry
      .path()
      .extension()
      .map(|piece| piece.to_string_lossy().to_lowercase())
    else {
      continue;
    };
    if !is_cue_file_extension(&ext) {
      continue;
    }

    let cue_mtime = entry
      .metadata()
      .ok()
      .and_then(|meta| meta.modified().ok())
      .and_then(to_epoch_secs_i64);
    let cue_size = entry.metadata().map(|meta| meta.len() as i64).unwrap_or(0);
    let cue_text = normalize_path(&entry.path().to_string_lossy());

    let Ok(sheet) = cue::parse_cue_file(entry.path()) else {
      continue;
    };
    referenced_audio.insert(normalize_path(&sheet.resolved_audio_path.to_string_lossy()));

    for track in &sheet.tracks {
      let virtual_path = format!("{}::track{:02}", cue_text, track.track_number);
      candidates.push(FoundCandidate {
        path: PathBuf::from(&virtual_path),
        path_text: virtual_path,
        ext: "cue_track".to_string(),
        mtime: cue_mtime,
        size: cue_size,
      });
    }
  }

  if !referenced_audio.is_empty() {
    candidates.retain(|candidate| !referenced_audio.contains(&candidate.path_text));
  }

  if let Some(notifier) = reporter {
    notifier.emit_collecting(
      candidates.len(),
      candidates.len(),
      Some(format!(
        "已完成文件收集，共 {} 首候选歌曲",
        candidates.len()
      )),
    );
  }

  candidates
}

// ---------- 解码执行 ----------

/// 专用线程池并行执行解码任务；每完成一个任务就推一次解析计数。
fn run_decode_tasks(
  tasks: Vec<DecodeTask>,
  reporter: Option<ScanProgressReporter>,
  options: ScanOptions,
) -> Result<Vec<DecodeOutcome>, String> {
  if tasks.is_empty() {
    return Ok(Vec::new());
  }

  let grand_total = tasks.len();
  let pool = rayon::ThreadPoolBuilder::new()
    .num_threads(plan_parse_workers(grand_total))
    .build()
    .map_err(|error| error.to_string())?;

  let outcomes = pool.install(|| {
    tasks
      .into_par_iter()
      .filter_map(|task| {
        let decoded = parse_song_from_file(&task.path, &task.path_text, &task.ext);
        if let Some(notifier) = reporter.as_ref() {
          notifier.advance_parse_tick(grand_total);
        }
        classify_decoded(&task, decoded, &options)
      })
      .collect::<Vec<DecodeOutcome>>()
  });

  Ok(outcomes)
}

/// 用 symphonia 探测整轨音频的时长（毫秒），供 CUE 音轨切分播放区间。
fn measure_full_duration_ms(audio: &Path) -> Option<u32> {
  let file = std::fs::File::open(audio).ok()?;
  let stream = MediaSourceStream::new(Box::new(file), Default::default());
  let mut hint = Hint::new();
  if let Some(ext) = audio.extension().and_then(|piece| piece.to_str()) {
    hint.with_extension(ext);
  }
  let probed = symphonia::default::get_probe()
    .format(
      &hint,
      stream,
      &FormatOptions::default(),
      &MetadataOptions::default(),
    )
    .ok()?;
  let track = probed
    .format
    .tracks()
    .iter()
    .find(|candidate| candidate.codec_params.codec != CODEC_TYPE_NULL)?;
  let time_base = track.codec_params.time_base?;
  let frames = track.codec_params.n_frames?;
  let span = time_base.calc_time(frames);
  let whole = span.seconds.saturating_add(u64::from(span.frac > 0.0));
  Some((whole.min(u32::MAX as u64) * 1000) as u32)
}

/// 处理 CUE 合成音轨任务：同一乐谱只解析一次、整轨时长只探测一次。
fn expand_cue_tracks(tasks: &[DecodeTask], options: ScanOptions) -> Vec<DecodeOutcome> {
  if tasks.is_empty() {
    return Vec::new();
  }

  // 依合成路径前缀（`<cue>::trackNN` 的 `<cue>` 部分）分组。
  let mut by_sheet: HashMap<&str, Vec<&DecodeTask>> = HashMap::new();
  for task in tasks {
    if let Some(sheet_path) = task.path_text.split("::track").next() {
      by_sheet.entry(sheet_path).or_default().push(task);
    }
  }

  let mut outcomes: Vec<DecodeOutcome> = Vec::new();
  for (sheet_path, group) in by_sheet {
    let sheet_file = PathBuf::from(sheet_path);
    let Ok(sheet) = cue::parse_cue_file(&sheet_file) else {
      continue;
    };
    let audio_path = sheet.resolved_audio_path.to_string_lossy().to_string();
    let full_ms = measure_full_duration_ms(&sheet.resolved_audio_path).unwrap_or(0);
    let cue_text = normalize_path(sheet_path);

    for task in group {
      // 从合成路径尾部解析出音轨号，再回乐谱里找对应轨。
      let Some(number) = task
        .path_text
        .rsplit("::track")
        .next()
        .and_then(|tail| tail.parse::<u32>().ok())
      else {
        continue;
      };
      let Some(track) = sheet
        .tracks
        .iter()
        .find(|candidate| candidate.track_number == number)
      else {
        continue;
      };
      let Some(song) = assemble_cue_track_song(
        &cue_text,
        &audio_path,
        track,
        sheet.album_title.as_deref(),
        sheet.album_performer.as_deref(),
        full_ms,
      ) else {
        continue;
      };

      if let Some(outcome) = classify_decoded(task, Some(song), &options) {
        outcomes.push(outcome);
      }
    }
  }

  outcomes
}

// ---------- 差异主入口 ----------

/// 计算指定文件夹的扫描差异。
///
/// 流程：磁盘盘点 → 与快照比对分派任务（复用/重解码/删除）→
/// CUE 与普通音频分别解码 → 合并结果 → 按目录+专辑归组补齐专辑语义。
pub(super) fn build_scan_delta(
  normalized_folder: &str,
  mut db_snapshot: HashMap<String, StoredSongFacts>,
  reporter: Option<&ScanProgressReporter>,
  options: ScanOptions,
) -> Result<FolderDiff, String> {
  let candidates = inventory_candidates(normalized_folder, reporter);
  let saw_files_on_disk = !candidates.is_empty();
  let mut slots: Vec<Option<Song>> = vec![None; candidates.len()];
  let mut pending_tasks: Vec<DecodeTask> = Vec::new();
  let mut marked_for_removal: Vec<String> = Vec::new();

  for (slot, candidate) in candidates.iter().enumerate() {
    match db_snapshot.remove(&candidate.path_text) {
      Some(record) => {
        // mtime/体积对不上，或库内身份/文本残缺 → 重新解码。
        let stale = record.mtime_seconds != candidate.mtime
          || record.size_bytes != candidate.size
          || container_info_absent(&record.song)
          || text_fields_missing(&record.song);

        if stale {
          pending_tasks.push(DecodeTask {
            slot,
            path: candidate.path.clone(),
            path_text: candidate.path_text.clone(),
            ext: candidate.ext.clone(),
            is_new: false,
          });
        } else if within_duration_floor(&record.song, options) {
          slots[slot] = Some(record.song);
        } else {
          marked_for_removal.push(candidate.path_text.clone());
        }
      }
      None => {
        pending_tasks.push(DecodeTask {
          slot,
          path: candidate.path.clone(),
          path_text: candidate.path_text.clone(),
          ext: candidate.ext.clone(),
          is_new: true,
        });
      }
    }
  }

  // 合成音轨与真实音频走不同的解码管线。
  let (virtual_tasks, real_tasks): (Vec<DecodeTask>, Vec<DecodeTask>) = pending_tasks
    .into_iter()
    .partition(|task| task.ext == "cue_track");

  let cue_outcomes = expand_cue_tracks(&virtual_tasks, options);

  if let Some(notifier) = reporter {
    notifier.enter_parsing(real_tasks.len());
  }

  let audio_outcomes = run_decode_tasks(real_tasks, reporter.cloned(), options)?;

  let mut to_add: Vec<Song> = Vec::new();
  let mut to_update: Vec<Song> = Vec::new();

  for outcome in audio_outcomes {
    match outcome.song {
      Some(song) => {
        slots[outcome.slot] = Some(song.clone());
        if outcome.is_new {
          to_add.push(song);
        } else {
          to_update.push(song);
        }
      }
      None => marked_for_removal.push(outcome.path_text),
    }
  }
  for outcome in cue_outcomes {
    match outcome.song {
      Some(song) => {
        slots[outcome.slot] = Some(song.clone());
        if outcome.is_new {
          to_add.push(song);
        } else {
          to_update.push(song);
        }
      }
      None => marked_for_removal.push(outcome.path_text),
    }
  }

  let mut songs: Vec<Song> = slots.into_iter().flatten().collect();
  // 快照里没被磁盘命中的剩余路径（含库内残留的合成音轨）全部删除。
  marked_for_removal.extend(db_snapshot.keys().cloned());

  apply_album_grouping(&mut songs);

  // 归组改写了专辑歌手/键等字段：增改清单对齐到归组后的版本。
  let regrouped: HashMap<String, Song> = songs
    .iter()
    .cloned()
    .map(|entry| (entry.path.clone(), entry))
    .collect();

  let to_add = to_add
    .into_iter()
    .map(|entry| regrouped.get(&entry.path).cloned().unwrap_or(entry))
    .collect();
  let to_update = to_update
    .into_iter()
    .map(|entry| regrouped.get(&entry.path).cloned().unwrap_or(entry))
    .collect();

  Ok(FolderDiff {
    songs,
    to_add,
    to_update,
    to_delete: marked_for_removal,
    has_disk_songs: saw_files_on_disk,
  })
}
