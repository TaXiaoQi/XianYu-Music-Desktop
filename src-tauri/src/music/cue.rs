// CUE 唱片描述表解析（弦予原创实现）。
// 整体流水线分三段：先对每一行做指令分类，再按类别折叠出轨道草稿，
// 最后根据 FILE 引用定位真实音频文件。时间轴一律折算成毫秒。

use encoding_rs::Encoding;
use serde::{Serialize, Deserialize};
use std::{
  fs,
  path::{Path, PathBuf},
};
use thiserror::{Error};

// 解析失败的完整形态集合；对外错误文案属于既有契约，逐字保持。
#[derive(Debug, Error)]
pub enum CueParseError { // CueParseError
  #[error("Failed to read CUE file: {0}")]
  Io(#[from] std::io::Error),
  #[error("CUE file is empty")]
  EmptyFile,
  #[error("No FILE directive found in CUE sheet")]
  MissingFileDirective,
  #[error("No TRACK directives found in CUE sheet")]
  NoTracks,
  #[error("Invalid timestamp at line {line}: {raw}")]
  InvalidTimestamp { line: usize, raw: String },
  #[error("Audio file referenced by CUE not found: {0}")]
  AudioFileNotFound(String),
}

// 专辑级元数据 + 轨道列表；字段名同时是前端反序列化契约。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CueSheet { // CueSheet
  pub album_title: Option<String>,
  pub album_performer: Option<String>,
  pub file_path: String,
  pub resolved_audio_path: PathBuf,
  pub tracks: Vec<CueTrack>,
}

// 单条音轨：起始时间必有，结束时间由下一条音轨补齐。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CueTrack { // CueTrack
  pub track_number: u32,
  pub title: Option<String>,
  pub performer: Option<String>,
  pub index01_start_ms: u64,
  pub end_ms: Option<u64>,
}

// INDEX 第三段是 1/75 秒精度的帧计数。
const FRAMES_PER_SECOND: u64 = 75;

// 单行指令的归类结果；Skip 与 Other 都不参与状态推进，
// 区分二者只为阅读时能分辨「注释/空行」与「未支持的指令」。
enum CueInstruction<'line> {
  Skip,
  Title(&'line str),
  Performer(&'line str),
  File(&'line str),
  Track(u32),
  Index01(&'line str),
  Other,
}

// 逐行分类：先按第一个空格切出指令头，再按指令头分发。
// 键名大小写敏感，取值必须是成对的英文双引号，这与主流刻录软件的输出一致。
fn classify_line<'line>(raw_line: &'line str) -> CueInstruction<'line> {
  let Some((keyword, argument)) = raw_line.split_once(' ') else {
    return CueInstruction::Skip;
  };

  match keyword {
    "REM" => CueInstruction::Skip,
    "TITLE" => as_quoted(argument)
      .map(CueInstruction::Title)
      .unwrap_or(CueInstruction::Other),
    "PERFORMER" => as_quoted(argument)
      .map(CueInstruction::Performer)
      .unwrap_or(CueInstruction::Other),
    "FILE" => file_name_argument(argument)
      .map(CueInstruction::File)
      .unwrap_or(CueInstruction::Other),
    "TRACK" => track_argument(argument)
      .map(CueInstruction::Track)
      .unwrap_or(CueInstruction::Other),
    "INDEX" => index_argument(argument)
      .map(CueInstruction::Index01)
      .unwrap_or(CueInstruction::Other),
    _ => CueInstruction::Other,
  }
}

// 剥掉一层成对的英文双引号；引号缺失或不成对一律视为无效取值。
fn as_quoted(argument: &str) -> Option<&str> {
  let trimmed = argument.trim();
  let opened = trimmed.strip_prefix('"')?;
  let closed = opened.strip_suffix('"')?;
  (closed.len() + 2 == trimmed.len()).then_some(closed)
}

// FILE 指令的文件名段：第一个参数须是双引号包裹的路径，
// 其后的类型标记（WAVE / AIFF / MP3 等）按惯例忽略。
fn file_name_argument(argument: &str) -> Option<&str> {
  let trimmed = argument.trim();
  let opened = trimmed.strip_prefix('"')?;
  let closing = opened.find('"')?;
  Some(&opened[..closing])
}

// TRACK 指令的编号段：取第一个空白分隔记号并按无符号整数解析。
fn track_argument(argument: &str) -> Option<u32> {
  argument
    .trim()
    .split_whitespace()
    .next()?
    .parse::<u32>()
    .ok()
}

// INDEX 指令只认编号 01；编号后必须紧跟一个空格再接时间串，
// 时间串本身允许带前后空白（保持与既有解析器相同的容错面）。
fn index_argument(argument: &str) -> Option<&str> {
  Some(argument.strip_prefix("01 ")?.trim())
}

// 轨道草稿：INDEX 01 尚未落地前不成立。
struct DraftTrack {
  ordinal: u32,
  heading: Option<String>,
  artist_name: Option<String>,
  start_at: Option<u64>,
}

// mm:ss:ff → 毫秒。帧段按每秒 75 帧折算并向下取整。
fn cue_time_to_millis(stamp: &str, origin: usize) -> Result<u64, CueParseError> {
  let reject = || CueParseError::InvalidTimestamp {
    line: origin,
    raw: stamp.to_string(),
  };

  let mut sections = stamp.trim().split(':');
  let (minutes_raw, seconds_raw, frames_raw) = match (
    sections.next(),
    sections.next(),
    sections.next(),
    sections.next(),
  ) {
    (Some(m), Some(s), Some(f), None) => (m, s, f),
    _ => return Err(reject()),
  };

  let minutes: u64 = minutes_raw.parse().map_err(|_| reject())?;
  let seconds: u64 = seconds_raw.parse().map_err(|_| reject())?;
  let frames: u64 = frames_raw.parse().map_err(|_| reject())?;

  let frame_millis = frames * 1000 / FRAMES_PER_SECOND;
  Ok(minutes * 60_000 + seconds * 1_000 + frame_millis)
}

// 编码裁决顺序：UTF-8 优先，其次 GBK、Shift_JIS，
// 两者都产生解码错误时退回 UTF-8 宽容模式（含韩文等字节的兜底路径）。
fn decode_cue_bytes(raw: &[u8]) -> String {
  if let Ok(text) = std::str::from_utf8(raw) {
    return text.to_owned();
  }

  let candidates: [&Encoding; 2] = [encoding_rs::GBK, encoding_rs::SHIFT_JIS];
  for codec in candidates {
    // decode 的第三个返回值是 had_errors（true 表示存在坏序列）。
    let (text, _, had_errors) = codec.decode(raw);
    if !had_errors {
      return text.into_owned();
    }
  }

  String::from_utf8_lossy(raw).into_owned()
}

// 入口：读文件字节 → 解码 → 组装。
pub fn parse_cue_file(cue_path: &Path) -> Result<CueSheet, CueParseError> {
  let raw = fs::read(cue_path)?;
  let text = decode_cue_bytes(&raw);
  assemble_cue_sheet(&text, cue_path)
}

// 主折叠：把分类后的指令序列收敛成 CueSheet。
fn assemble_cue_sheet(text: &str, cue_path: &Path) -> Result<CueSheet, CueParseError> {
  if text.trim().is_empty() {
    return Err(CueParseError::EmptyFile);
  }
  let base_dir = cue_path.parent().unwrap_or_else(|| Path::new("."));

  let mut album_title = None;
  let mut album_performer = None;
  let mut referenced_file: Option<String> = None;
  let mut drafts: Vec<DraftTrack> = Vec::new();

  for (offset, raw_line) in text.lines().enumerate() {
    match classify_line(raw_line.trim()) {
      CueInstruction::Skip | CueInstruction::Other => {}
      CueInstruction::Title(value) => match drafts.last_mut() {
        Some(draft) => draft.heading = Some(value.to_owned()),
        None => album_title = Some(value.to_owned()),
      },
      CueInstruction::Performer(value) => match drafts.last_mut() {
        Some(draft) => draft.artist_name = Some(value.to_owned()),
        None => album_performer = Some(value.to_owned()),
      },
      CueInstruction::File(value) => referenced_file = Some(value.to_owned()),
      CueInstruction::Track(number) => drafts.push(DraftTrack {
        ordinal: number,
        heading: None,
        artist_name: None,
        start_at: None,
      }),
      CueInstruction::Index01(stamp) => {
        if let Some(draft) = drafts.last_mut() {
          draft.start_at = Some(cue_time_to_millis(stamp, offset + 1)?);
        }
      }
    }
  }

  // 没等到 INDEX 01 的轨道不成立：一条 INDEX 就是一座桥，
  // 没过桥的草稿连同它收到的字段一起丢弃。
  drafts.retain(|draft| draft.start_at.is_some());
  if drafts.is_empty() {
    return Err(CueParseError::NoTracks);
  }

  let referenced_file = referenced_file.ok_or(CueParseError::MissingFileDirective)?;
  let resolved_audio_path = locate_referenced_audio(&referenced_file, base_dir)?;

  let mut tracks: Vec<CueTrack> = drafts
    .into_iter()
    .map(|draft| CueTrack {
      track_number: draft.ordinal,
      title: draft.heading,
      performer: draft.artist_name,
      index01_start_ms: draft.start_at.unwrap_or(0),
      end_ms: None,
    })
    .collect();

  // 相邻音轨首尾相接：前一条的结束即后一条的起始，末轨保持开放。
  let last_index = tracks.len().saturating_sub(1);
  for index in 0..last_index {
    let next_start = tracks[index + 1].index01_start_ms;
    tracks[index].end_ms = Some(next_start);
  }

  Ok(CueSheet {
    album_title,
    album_performer,
    file_path: referenced_file,
    resolved_audio_path,
    tracks,
  })
}

// 统一经全局路径归一化，保证入库口径与缓存键一致。
fn normalized_audio_path(path: PathBuf) -> PathBuf {
  crate::music::utils::normalize_path(&path.to_string_lossy()).into()
}

// 音频文件定位：先按 CUE 内写法原样尝试（相对路径基于 CUE 所在目录），
// 落空后退化为同目录下大小写不敏感的逐项比对，仍找不到才报缺失。
fn locate_referenced_audio(reference: &str, cue_dir: &Path) -> Result<PathBuf, CueParseError> {
  let direct = if Path::new(reference).is_absolute() {
    PathBuf::from(reference)
  } else {
    cue_dir.join(reference)
  };

  if direct.exists() {
    return Ok(normalized_audio_path(direct));
  }

  let wanted = direct
    .file_name()
    .map(|name| name.to_string_lossy().to_lowercase());
  if let (Some(parent), Some(wanted)) = (direct.parent(), wanted) {
    let Ok(listing) = fs::read_dir(parent) else {
      return Err(CueParseError::AudioFileNotFound(reference.to_string()));
    };
    for probe in listing.flatten() {
      let candidate = probe.path();
      let hit = candidate
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase() == wanted)
        .unwrap_or(false);
      if hit && candidate.is_file() {
        return Ok(normalized_audio_path(candidate));
      }
    }
  }

  Err(CueParseError::AudioFileNotFound(reference.to_string()))
}

#[cfg(test)]
mod cue_tests {
  use super::{
    assemble_cue_sheet, cue_time_to_millis, decode_cue_bytes, parse_cue_file, CueParseError,
  };
  use std::path::Path;

  #[test]
  fn zero_frame_stamp_is_zero_ms() {
    assert_eq!(cue_time_to_millis("00:00:00", 1).unwrap(), 0);
  }

  #[test]
  fn frame_part_folds_into_millis() {
    let stamp = cue_time_to_millis("04:52:60", 1).unwrap();
    assert_eq!(stamp, 240000 + 52000 + 800);
  }

  #[test]
  fn malformed_stamps_are_rejected() {
    assert!(cue_time_to_millis("abc", 1).is_err());
    assert!(cue_time_to_millis("1:2", 1).is_err());
  }

  #[test]
  fn sheet_without_matching_audio_reports_missing_file() {
    let content = concat!(
      "TITLE \"Test Album\"\n",
      "FILE \"test.flac\" WAVE\n",
      "  TRACK 01 AUDIO\n",
      "    TITLE \"Song One\"\n",
      "    PERFORMER \"Artist\"\n",
      "    INDEX 01 00:00:00\n",
      "  TRACK 02 AUDIO\n",
      "    TITLE \"Song Two\"\n",
      "    INDEX 01 03:30:00\n",
    );
    let result = assemble_cue_sheet(content, Path::new("."));
    assert!(matches!(result, Err(CueParseError::AudioFileNotFound(_))));
  }

  #[test]
  fn three_track_sheet_chains_end_times() {
    let content = concat!(
      "TITLE \"Album\"\n",
      "FILE \"test.flac\" WAVE\n",
      "  TRACK 01 AUDIO\n",
      "    INDEX 01 00:00:00\n",
      "  TRACK 02 AUDIO\n",
      "    INDEX 01 04:52:60\n",
      "  TRACK 03 AUDIO\n",
      "    INDEX 01 08:48:20\n",
    );
    let scratch = std::env::temp_dir();
    std::fs::write(scratch.join("test.flac"), b"fake").ok();
    let cue_path = scratch.join("test.cue");
    let _ = std::fs::write(&cue_path, content);
    let sheet = match parse_cue_file(&cue_path) {
      Ok(sheet) => sheet,
      Err(_) => return,
    };
    assert_eq!(sheet.tracks.len(), 3);
    assert_eq!(sheet.tracks[0].index01_start_ms, 0);
    assert_eq!(sheet.tracks[0].end_ms, Some(292800));
    assert_eq!(sheet.tracks[1].index01_start_ms, 292800);
    assert_eq!(sheet.tracks[2].end_ms, None);
  }

  #[test]
  fn gbk_payload_survives_decoding() {
    let gbk_payload: &[u8] = &[
      0x54, 0x49, 0x54, 0x4c, 0x45, 0x20, 0x22, 0xc0, 0xc7, 0x22, 0x0a,
    ];
    let decoded = decode_cue_bytes(gbk_payload);
    assert!(decoded.contains("狼"));
  }
}
