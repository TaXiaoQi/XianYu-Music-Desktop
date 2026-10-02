// 响度归一化模块（本文件为全新组织，数值语义冻结）：
// 1) ReplayGain 标签读取：标准键直取，非标准键名按变体兜底；
// 2) GainRamp：目标增益变化后在给定毫秒窗口内线性过渡，句柄可跨线程共享；
// 3) VolumeNormalizer：帧首刷新斜坡值，再把增益乘到每个采样；
// 4) song_loudness 表读写与播放期按需建档（SQL 文本字节级冻结）；
// 5) 播放增益折算：-18 LUFS 参考优先，其次标签增益，最后按 0.98 上限防削波。

use lofty::file::TaggedFileExt;
use lofty::tag::{ItemKey, ItemValue};
use rodio::{source::SeekError, Source};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::atomic::Ordering;
use std::sync::{atomic::AtomicU32, Arc};
use std::{
  fs,
  path::Path,
  time::{Duration, SystemTime, UNIX_EPOCH},
};

/// 播放增益折算的参考响度（LUFS）。
const TARGET_LOUDNESS_LUFS: f32 = -18.0;
/// 防削波钳制允许的采样绝对值上限。
const PEAK_CEILING: f32 = 0.98;

/// 档案读取语句（列清单与字节数冻结，列序对应 row_to_record）。
const LOUDNESS_SELECT_SQL: &str = "SELECT song_id, song_path, loudness_lufs, estimated_loudness_lufs, sample_peak, true_peak,
                    tag_track_gain_db, tag_track_peak, tag_album_gain_db, tag_album_peak,
                    tag_r128_track_gain_db, tag_r128_album_gain_db, file_size, file_modified_at,
                    scan_source, analyzer_name, analyzer_version, scan_status, scanned_at, error_message
             FROM song_loudness WHERE song_id = ?1";

/// 档案全量写入语句（字节级冻结）。
const LOUDNESS_UPSERT_SQL: &str = "INSERT INTO song_loudness (
            song_id, song_path, loudness_lufs, estimated_loudness_lufs, sample_peak, true_peak,
            tag_track_gain_db, tag_track_peak, tag_album_gain_db, tag_album_peak,
            tag_r128_track_gain_db, tag_r128_album_gain_db, file_size, file_modified_at,
            scan_source, analyzer_name, analyzer_version, scan_status, scanned_at, error_message
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
         ON CONFLICT(song_id) DO UPDATE SET
            song_path = excluded.song_path,
            loudness_lufs = excluded.loudness_lufs,
            estimated_loudness_lufs = excluded.estimated_loudness_lufs,
            sample_peak = excluded.sample_peak,
            true_peak = excluded.true_peak,
            tag_track_gain_db = excluded.tag_track_gain_db,
            tag_track_peak = excluded.tag_track_peak,
            tag_album_gain_db = excluded.tag_album_gain_db,
            tag_album_peak = excluded.tag_album_peak,
            tag_r128_track_gain_db = excluded.tag_r128_track_gain_db,
            tag_r128_album_gain_db = excluded.tag_r128_album_gain_db,
            file_size = excluded.file_size,
            file_modified_at = excluded.file_modified_at,
            scan_source = excluded.scan_source,
            analyzer_name = excluded.analyzer_name,
            analyzer_version = excluded.analyzer_version,
            scan_status = excluded.scan_status,
            scanned_at = excluded.scanned_at,
            error_message = excluded.error_message";

/// 待分析占位写入语句（字节级冻结）。
const LOUDNESS_PENDING_SQL: &str = "INSERT INTO song_loudness (
            song_id, song_path, file_size, file_modified_at, scan_source, scan_status
         ) VALUES (?1, ?2, ?3, ?4, 'none', 'pending')
         ON CONFLICT(song_id) DO UPDATE SET
            song_path = excluded.song_path,
            file_size = excluded.file_size,
            file_modified_at = excluded.file_modified_at,
            scan_source = 'none',
            scan_status = 'pending'";

// ---------------------------------------------------------------------------
// ReplayGain 标签读取
// ---------------------------------------------------------------------------

/// "x.xx dB" 形态的增益文本折算为纯数值（去单位、空格与正号）。
fn gain_text_as_db(raw: &str) -> Option<f32> {
  let flattened = raw
    .to_lowercase()
    .replace("db", "")
    .replace(' ', "")
    .replace('+', "");
  flattened.trim().parse::<f32>().ok()
}

/// 峰值文本折算为纯数值（仅去空格）。
fn peak_text_as_value(raw: &str) -> Option<f32> {
  raw.replace(' ', "").trim().parse::<f32>().ok()
}

/// 非标准键名兜底：Unknown(key) 的小写形式与两种约定写法比对。
fn key_is_variant(actual: &ItemKey, snake: &str, joined: &str) -> bool {
  if let ItemKey::Unknown(raw_key) = actual {
    let lowered = raw_key.to_lowercase();
    lowered == snake || lowered == joined
  } else {
    false
  }
}

/// 单个标签内的命中汇总：增益必须存在，峰值可选。
#[derive(Default)]
struct TagHarvest {
  track_gain: Option<f32>,
  track_peak: Option<f32>,
}

impl TagHarvest {
  /// 汇总收口：有增益才算命中。
  fn into_gain_pair(self) -> Option<(f32, Option<f32>)> {
    self.track_gain.map(|gain| (gain, self.track_peak))
  }

  /// 标准键直接读取（先命中先生效）。
  fn read_standard_keys(&mut self, item_tag: &lofty::tag::Tag) {
    if self.track_gain.is_none() {
      if let Some(text) = item_tag.get_string(&ItemKey::ReplayGainTrackGain) {
        self.track_gain = gain_text_as_db(text);
      }
    }
    if self.track_peak.is_none() {
      if let Some(text) = item_tag.get_string(&ItemKey::ReplayGainTrackPeak) {
        self.track_peak = peak_text_as_value(text);
      }
    }
  }

  /// 部分写入器使用非标准键名，逐条目做变体匹配补漏。
  fn read_variant_keys(&mut self, item_tag: &lofty::tag::Tag) {
    for entry in item_tag.items() {
      let ItemValue::Text(text) = entry.value() else {
        continue;
      };
      let key = entry.key();

      if self.track_gain.is_none()
        && (key == &ItemKey::ReplayGainTrackGain
          || key_is_variant(key, "replaygain_track_gain", "replaygaintrackgain"))
      {
        self.track_gain = gain_text_as_db(text);
      } else if self.track_peak.is_none()
        && (key == &ItemKey::ReplayGainTrackPeak
          || key_is_variant(key, "replaygain_track_peak", "replaygaintrackpeak"))
      {
        self.track_peak = peak_text_as_value(text);
      }
    }
  }
}

/// 从标签文件提取轨道增益与轨道峰值（首个命中优先）。
pub fn extract_replaygain_from_path(path: &Path) -> Option<(f32, Option<f32>)> {
  let probed = crate::music::tags::read_tagged_file_from_path(path).ok()?;
  let mut harvest = TagHarvest::default();
  for item_tag in probed.tags() {
    harvest.read_standard_keys(item_tag);
    harvest.read_variant_keys(item_tag);
  }
  harvest.into_gain_pair()
}

// ---------------------------------------------------------------------------
// 增益斜坡
// ---------------------------------------------------------------------------

/// 斜坡目标的线程侧句柄（增益以 f32 位模式经原子量传递）。
#[derive(Clone)]
pub struct VolumeNormalizerHandle {
  wanted_bits: Arc<AtomicU32>,
}

impl VolumeNormalizerHandle { // VolumeNormalizerHandle
  /// 更新斜坡目标增益。
  pub fn set_target_gain(&self, wanted: f32) {
    self.wanted_bits.store(wanted.to_bits(), Ordering::Relaxed);
  }
}

/// 线性增益斜坡：目标变化后在 ramp_ms 毫秒内从旧值过渡到新值。
pub struct GainRamp { // GainRamp
  wanted_bits: Arc<AtomicU32>,
  previous_goal: f32,
  emitted: f32,
  ramp_origin: f32,
  ramp_total: usize,
  ramp_elapsed: usize,
  ramping: bool,
}

impl GainRamp { // GainRamp
  /// 以初始增益建坡；ramp_ms 折算为采样帧数（至少 1 帧）。
  pub fn new(initial_gain: f32, sample_rate: u32, ramp_ms: u32) -> Self {
    let total_frames = ((f64::from(ramp_ms) / 1000.0) * f64::from(sample_rate)).round() as usize;
    let ramp = Self {
      wanted_bits: Arc::new(AtomicU32::new(initial_gain.to_bits())),
      previous_goal: initial_gain,
      emitted: initial_gain,
      ramp_origin: initial_gain,
      ramp_total: total_frames.max(1),
      ramp_elapsed: 0,
      ramping: false,
    };
    ramp
  }

  /// 取出与本坡共享目标的线程侧句柄。
  pub fn get_handle(&self) -> VolumeNormalizerHandle {
    VolumeNormalizerHandle {
      wanted_bits: Arc::clone(&self.wanted_bits),
    }
  }

  /// 每帧调用一次，返回此刻应施加的线性增益。
  #[inline]
  pub fn next_frame_gain(&mut self) -> f32 {
    let goal = f32::from_bits(self.wanted_bits.load(Ordering::Relaxed));

    if (goal - self.previous_goal).abs() > 0.00001 {
      self.ramp_origin = self.emitted;
      self.previous_goal = goal;
      self.ramp_elapsed = 0;
      self.ramping = true;
    }

    if self.ramping {
      self.ramp_elapsed += 1;
      let ratio = self.ramp_elapsed as f32 / self.ramp_total as f32;
      if ratio >= 1.0 {
        self.emitted = goal;
        self.ramping = false;
      }
      if ratio < 1.0 {
        self.emitted = self.ramp_origin + (goal - self.ramp_origin) * ratio;
      }
    }

    self.emitted
  }
}

// ---------------------------------------------------------------------------
// 归一化源
// ---------------------------------------------------------------------------

/// 帧首刷新斜坡值，并把增益乘到每个采样上的归一化源。
pub struct VolumeNormalizer<I> { // VolumeNormalizer
  upstream: I,
  curve: GainRamp,
  lanes: u16,
  lane_pos: u16,
  lane_gain: f32,
}

impl<I> VolumeNormalizer<I>
where
  I: Source<Item = f32>,
{
  pub fn new(inner: I, initial_gain: f32, ramp_ms: u32) -> (Self, VolumeNormalizerHandle) {
    let curve = GainRamp::new(initial_gain, inner.sample_rate(), ramp_ms);
    let handle = curve.get_handle();
    let lanes = inner.channels();
    (
      Self {
        upstream: inner,
        curve,
        lanes,
        lane_pos: 0,
        lane_gain: initial_gain,
      },
      handle,
    )
  }
}

impl<I> Iterator for VolumeNormalizer<I>
where
  I: Source<Item = f32>,
{
  type Item = I::Item;

  #[inline]
  fn next(&mut self) -> Option<f32> {
    let raw = self.upstream.next()?;

    if self.lane_pos == 0 {
      self.lane_gain = self.curve.next_frame_gain();
    }

    self.lane_pos += 1;
    if self.lane_pos >= self.lanes {
      self.lane_pos = 0;
    }

    Some(raw * self.lane_gain)
  }
}

impl<I> Source for VolumeNormalizer<I>
where
  I: Source<Item = f32>,
{
  #[inline]
  fn channels(&self) -> u16 {
    self.upstream.channels()
  }
  #[inline]
  fn sample_rate(&self) -> u32 {
    self.upstream.sample_rate()
  }
  #[inline]
  fn current_frame_len(&self) -> Option<usize> {
    self.upstream.current_frame_len()
  }
  #[inline]
  fn total_duration(&self) -> Option<Duration> {
    self.upstream.total_duration()
  }

  /// seek 后回到帧首，避免残留声道相位错位。
  #[inline]
  fn try_seek(&mut self, target: Duration) -> Result<(), SeekError> {
    self.lane_pos = 0;
    self.upstream.try_seek(target)
  }
}

// ---------------------------------------------------------------------------
// song_loudness 表
// ---------------------------------------------------------------------------

/// 单曲响度档案（字段名对前端冻结为 camelCase）。
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessRecord {
  pub song_id: i64,                         // 曲库主键
  pub song_path: String,                    // 音频文件路径
  pub loudness_lufs: Option<f64>,           // 分析所得综合响度
  pub estimated_loudness_lufs: Option<f64>, // 由标签增益反推的估算响度
  pub sample_peak: Option<f64>,             // 采样峰值
  pub true_peak: Option<f64>,               // 真峰
  pub tag_track_gain_db: Option<f64>,       // 标签轨道增益
  pub tag_track_peak: Option<f64>,          // 标签轨道峰值
  pub tag_album_gain_db: Option<f64>,       // 标签专辑增益
  pub tag_album_peak: Option<f64>,          // 标签专辑峰值
  pub tag_r128_track_gain_db: Option<f64>,  // R128 轨道增益
  pub tag_r128_album_gain_db: Option<f64>,  // R128 专辑增益
  pub file_size: i64,                       // 文件字节数
  pub file_modified_at: i64,                // 修改时刻（自纪元秒）
  pub scan_source: String,                  // 数据来源
  pub analyzer_name: Option<String>,        // 分析器名称
  pub analyzer_version: i32,                // 分析器版本
  pub scan_status: String,                  // 扫描状态
  pub scanned_at: Option<i64>,              // 扫描完成时刻
  pub error_message: Option<String>,        // 失败原因
}

/// 依列序取值的小包装，行构造保持可读。
fn take<T>(row: &rusqlite::Row<'_>, column: usize) -> rusqlite::Result<T>
where
  T: rusqlite::types::FromSql,
{
  row.get(column)
}

/// 从查询行构造档案；列顺序必须与 LOUDNESS_SELECT_SQL 一致。
fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<LoudnessRecord> {
  let built = LoudnessRecord {
    song_id: take(row, 0)?,
    song_path: take(row, 1)?,
    loudness_lufs: take(row, 2)?,
    estimated_loudness_lufs: take(row, 3)?,
    sample_peak: take(row, 4)?,
    true_peak: take(row, 5)?,
    tag_track_gain_db: take(row, 6)?,
    tag_track_peak: take(row, 7)?,
    tag_album_gain_db: take(row, 8)?,
    tag_album_peak: take(row, 9)?,
    tag_r128_track_gain_db: take(row, 10)?,
    tag_r128_album_gain_db: take(row, 11)?,
    file_size: take(row, 12)?,
    file_modified_at: take(row, 13)?,
    scan_source: take(row, 14)?,
    analyzer_name: take(row, 15)?,
    analyzer_version: take(row, 16)?,
    scan_status: take(row, 17)?,
    scanned_at: take(row, 18)?,
    error_message: take(row, 19)?,
  };
  Ok(built)
}

/// rusqlite 错误转文本的统一出口。
fn db_reason(error: rusqlite::Error) -> String {
  error.to_string()
}

/// io / SystemTime 错误统一转文本。
fn reason_text<E: std::fmt::Display>(error: E) -> String {
  error.to_string()
}

/// 读取单曲档案；无记录时返回 Ok(None)。
pub fn get_song_loudness_record( // get_song_loudness_record
  conn: &Connection,
  song_id: i64,
) -> Result<Option<LoudnessRecord>, String> { // 实现
  let mut stmt = conn.prepare(LOUDNESS_SELECT_SQL).map_err(db_reason)?;
  let found = stmt
    .query_row(params![song_id], row_to_record)
    .optional()
    .map_err(db_reason)?;
  Ok(found)
}

/// 全量写入或按主键更新档案。
pub fn upsert_song_loudness_record(
  conn: &Connection,
  record: &LoudnessRecord,
) -> Result<(), String> { // 实现
  let args = params![
    record.song_id,
    record.song_path,
    record.loudness_lufs,
    record.estimated_loudness_lufs,
    record.sample_peak,
    record.true_peak,
    record.tag_track_gain_db,
    record.tag_track_peak,
    record.tag_album_gain_db,
    record.tag_album_peak,
    record.tag_r128_track_gain_db,
    record.tag_r128_album_gain_db,
    record.file_size,
    record.file_modified_at,
    record.scan_source,
    record.analyzer_name,
    record.analyzer_version,
    record.scan_status,
    record.scanned_at,
    record.error_message,
  ];
  conn.execute(LOUDNESS_UPSERT_SQL, args).map_err(db_reason)?;
  Ok(())
}

/// 仅登记“待分析”占位（保留文件指纹，分析状态复位）。
pub fn create_pending_loudness_record( // create_pending_loudness_record
  conn: &Connection,
  song_id: i64,
  song_path: &str,
  file_size: i64,
  file_modified_at: i64,
) -> Result<(), String> { // 实现
  let args = params![song_id, song_path, file_size, file_modified_at];
  conn
    .execute(LOUDNESS_PENDING_SQL, args)
    .map_err(db_reason)?;
  Ok(())
}

// ---------------------------------------------------------------------------
// 播放增益折算
// ---------------------------------------------------------------------------

/// 参考增益决策：分析 LUFS（对齐目标响度）优先，标签轨道增益回退。
fn reference_gain_db(record: &LoudnessRecord, offset_db: f32) -> Option<f32> {
  match (record.loudness_lufs, record.tag_track_gain_db) {
    (Some(lufs), _) => Some(TARGET_LOUDNESS_LUFS + offset_db - lufs as f32),
    (None, Some(tag_gain)) => Some(tag_gain as f32 + offset_db),
    (None, None) => None,
  }
}

/// 防削波钳制：峰值已知时保证增益×峰值不越上限；缺峰值时正增益不放大。
fn cap_gain_for_peak(linear_gain: f32, record: &LoudnessRecord, gain_db: f32) -> f32 {
  let Some(raw_peak) = record.sample_peak.or(record.tag_track_peak) else {
    return if gain_db > 0.0 { 1.0 } else { linear_gain };
  };
  let peak = raw_peak as f32;
  if linear_gain * peak > PEAK_CEILING {
    PEAK_CEILING / peak
  } else {
    linear_gain
  }
}

/// 依据响度档案折算线性播放增益（无参考数据时按 1.0 播放）。
pub fn calculate_playback_gain(
  record: &LoudnessRecord,
  gain_offset_db: f32,
  prevent_clipping: bool,
) -> f32 {
  let Some(gain_db) = reference_gain_db(record, gain_offset_db) else {
    return 1.0;
  };

  let linear_gain = 10.0_f32.powf(gain_db / 20.0);
  if prevent_clipping {
    cap_gain_for_peak(linear_gain, record, gain_db)
  } else {
    linear_gain
  }
}

// ---------------------------------------------------------------------------
// 播放期按需建档
// ---------------------------------------------------------------------------

/// 文件体积（字节）与最后修改时刻（自纪元秒）。
fn file_stamp(path: &Path) -> Result<(i64, i64), String> {
  let meta = fs::metadata(path).map_err(reason_text)?;
  let stamp_secs = meta
    .modified()
    .map_err(reason_text)?
    .duration_since(UNIX_EPOCH)
    .map_err(reason_text)?
    .as_secs();
  Ok((meta.len() as i64, stamp_secs as i64))
}

/// 当前时刻的自纪元秒。
fn epoch_seconds_now() -> i64 {
  let since_epoch = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default();
  since_epoch.as_secs() as i64
}

/// 全空档案底版：字段留给调用方按需填充。
fn bare_record(
  song_id: i64,
  song_path: &str,
  file_size: i64,
  file_modified_at: i64,
) -> LoudnessRecord {
  LoudnessRecord {
    song_id,
    song_path: song_path.to_string(),
    loudness_lufs: None,
    estimated_loudness_lufs: None,
    sample_peak: None,
    true_peak: None,
    tag_track_gain_db: None,
    tag_track_peak: None,
    tag_album_gain_db: None,
    tag_album_peak: None,
    tag_r128_track_gain_db: None,
    tag_r128_album_gain_db: None,
    file_size,
    file_modified_at,
    scan_source: "none".to_string(),
    analyzer_name: None,
    analyzer_version: 1,
    scan_status: "pending".to_string(),
    scanned_at: None,
    error_message: None,
  }
}

/// 标签 ReplayGain 建档：估算响度 = 目标响度 − 标签增益。
fn record_from_tag_gain(
  song_id: i64,
  song_path: &str,
  tag_gain: f32,
  tag_peak: Option<f32>,
  file_size: i64,
  file_modified_at: i64,
) -> LoudnessRecord {
  let mut built = bare_record(song_id, song_path, file_size, file_modified_at);
  built.estimated_loudness_lufs = Some(f64::from(TARGET_LOUDNESS_LUFS - tag_gain));
  built.tag_track_gain_db = Some(f64::from(tag_gain));
  built.tag_track_peak = tag_peak.map(f64::from);
  built.scan_source = "tag_replaygain".to_string();
  built.scan_status = "scanned".to_string();
  built.scanned_at = Some(epoch_seconds_now());
  built
}

/// 播放期按需建立响度档案：缓存命中 → 标签提取 → 占位待分析。
pub fn process_song_on_play(
  conn: &Connection,
  song_id: i64,
  song_path: &str,
) -> Result<LoudnessRecord, String> {
  let file_path = Path::new(song_path);
  let (size_bytes, stamp_secs) = file_stamp(file_path)?;

  // 文件体积与修改时间都未变化时，缓存直接复用。
  if let Ok(Some(hit)) = get_song_loudness_record(conn, song_id) {
    if hit.file_size == size_bytes && hit.file_modified_at == stamp_secs {
      return Ok(hit);
    }
  }

  let tag_hits = extract_replaygain_from_path(file_path);
  if let Some((tag_gain, tag_peak)) = tag_hits {
    let built = record_from_tag_gain(
      song_id, song_path, tag_gain, tag_peak, size_bytes, stamp_secs,
    );
    upsert_song_loudness_record(conn, &built)?;
    return Ok(built);
  }

  create_pending_loudness_record(conn, song_id, song_path, size_bytes, stamp_secs)?;
  Ok(bare_record(song_id, song_path, size_bytes, stamp_secs))
}
