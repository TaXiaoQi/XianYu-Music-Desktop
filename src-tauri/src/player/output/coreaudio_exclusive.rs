// Core Audio 独占输出：hog mode 独占设备 + 原生采样率/位深协商直出，
// 含 DSD (DoP) 原生直通尝试与 PCM 编码协商回退。行为镜像 WASAPI 独占路径：
// 候选优先协商、物理格式回读验证、DoP 失败回退 PCM、seek 重建音源失败时保留当前播放。
// 实现要点：Core Audio C API 手写 FFI（零新依赖）；直接注册 AudioDeviceIOProc
// 写设备物理格式缓冲（不经 AudioUnit/混音器）；喂送线程 + 环形缓冲对接实时回调。

// kAudioObject... 等四字符码常量刻意镜像 Core Audio C 头文件命名，
// 便于与 Apple 文档逐名核对，不做 Rust 大写改名，模块内整体豁免。
#![allow(non_upper_case_globals)]

use super::exclusive_common::{
  ExclusiveAudioFeed, ExclusiveControl, ExclusiveEncoding, ExclusivePlayRequest,
};
use crate::player::dsd_dop::{dop_pcm_rate, parse_dsd_info, DopStreamSource};
use crate::player::equalizer::{EqualizerHandle, EqualizerSettings};
use crate::player::loudness::VolumeNormalizerHandle;
use crate::player::output::OutputError;
use crate::player::sound_effect::{SoundEffectHandle, SoundEffectSettings};
use crate::player::types::SharedProgress;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// 喂送线程每次读取的帧数。
const FEED_CHUNK_FRAMES: usize = 2048;
/// 初始化握手的超时秒数。
const STARTUP_HANDSHAKE_SECS: u64 = 3;
/// 物理格式切换后的回读验证上限次数（每次 50ms）。
const FORMAT_SETTLE_ATTEMPTS: usize = 20;
/// 实时回调暂存缓冲的帧数上限（超出按静音兜底，正常设备周期远小于该值）。
const SCRATCH_FRAME_CAPACITY: usize = 8192;
/// 起播前环形缓冲至少预填的比例。
const RING_PRIME_RATIO: usize = 4;

/// 会话结束标记：0=运行中 1=正常结束 2=异常结束。
const FINISH_NONE: u8 = 0;
const FINISH_OK: u8 = 1;
const FINISH_ERR: u8 = 2;

// ---------------------------------------------------------------------------
// Core Audio FFI：仅声明独占输出所需的符号
// ---------------------------------------------------------------------------

#[allow(non_snake_case, non_camel_case_types, dead_code)]
mod ffi {
  use std::os::raw::{c_char, c_void};

  pub type OSStatus = i32;
  pub type AudioObjectID = u32;
  pub type AudioDeviceID = u32;
  pub type AudioStreamID = u32;
  pub type Float64 = f64;

  /// 四字符常量（大端 'xxxx'）。
  pub const fn fourcc(code: &[u8; 4]) -> u32 {
    ((code[0] as u32) << 24) | ((code[1] as u32) << 16) | ((code[2] as u32) << 8) | (code[3] as u32)
  }

  pub const kAudioNoError: OSStatus = 0;

  pub const kAudioObjectSystemObject: AudioObjectID = 1;
  pub const kAudioObjectPropertyScopeGlobal: u32 = fourcc(b"glob");
  pub const kAudioObjectPropertyScopeOutput: u32 = fourcc(b"outp");
  pub const kAudioObjectPropertyElementMain: u32 = 0;

  pub const kAudioObjectPropertyName: u32 = fourcc(b"anam");
  pub const kAudioHardwarePropertyDevices: u32 = fourcc(b"dev#");
  pub const kAudioHardwarePropertyDefaultOutputDevice: u32 = fourcc(b"dOut");
  pub const kAudioDevicePropertyHogMode: u32 = fourcc(b"hog ");
  pub const kAudioDevicePropertyNominalSampleRate: u32 = fourcc(b"noms");
  pub const kAudioDevicePropertyAvailableNominalSampleRates: u32 = fourcc(b"nv#r");
  pub const kAudioDevicePropertyStreams: u32 = fourcc(b"stm#");
  pub const kAudioDevicePropertyStreamConfiguration: u32 = fourcc(b"slay");
  pub const kAudioStreamPropertyPhysicalFormat: u32 = fourcc(b"pfmt");
  pub const kAudioStreamPropertyAvailablePhysicalFormats: u32 = fourcc(b"fpfm");

  pub const kAudioFormatLinearPCM: u32 = fourcc(b"lpcm");
  pub const kAudioFormatFlagIsFloat: u32 = 1 << 0;
  pub const kAudioFormatFlagIsSignedInteger: u32 = 1 << 2;
  pub const kAudioFormatFlagIsPacked: u32 = 1 << 3;
  pub const kAudioFormatFlagIsNonInterleaved: u32 = 1 << 5;

  #[repr(C)]
  #[derive(Clone, Copy)]
  pub struct AudioObjectPropertyAddress {
    pub mSelector: u32,
    pub mScope: u32,
    pub mElement: u32,
  }

  #[repr(C)]
  #[derive(Clone, Copy, Debug, Default)]
  pub struct AudioValueRange {
    pub mMinimum: Float64,
    pub mMaximum: Float64,
  }

  #[repr(C)]
  #[derive(Clone, Copy, Debug, Default)]
  pub struct AudioStreamBasicDescription {
    pub mSampleRate: Float64,
    pub mFormatID: u32,
    pub mFormatFlags: u32,
    pub mBytesPerPacket: u32,
    pub mFramesPerPacket: u32,
    pub mBytesPerFrame: u32,
    pub mChannelsPerFrame: u32,
    pub mBitsPerChannel: u32,
  }

  #[repr(C)]
  #[derive(Clone, Copy, Debug, Default)]
  pub struct AudioStreamRangedDescription {
    pub mFormat: AudioStreamBasicDescription,
    pub mSampleRateRange: AudioValueRange,
  }

  #[repr(C)]
  pub struct AudioBuffer {
    pub mNumberChannels: u32,
    pub mDataByteSize: u32,
    pub mData: *mut c_void,
  }

  /// 变长结构：mBuffers 按指针算术访问后续元素。
  #[repr(C)]
  pub struct AudioBufferList {
    pub mNumberBuffers: u32,
    pub mBuffers: [AudioBuffer; 1],
  }

  pub type AudioDeviceIOProc = unsafe extern "C" fn(
    inDevice: AudioDeviceID,
    inNow: *const c_void,
    inInputData: *const AudioBufferList,
    inInputTime: *const c_void,
    outOutputData: *mut AudioBufferList,
    outOutputTime: *const c_void,
    inClientData: *mut c_void,
  ) -> OSStatus;

  pub type AudioDeviceIOProcID = *mut c_void;

  extern "C" {
    pub fn AudioObjectGetPropertyDataSize(
      inObjectID: AudioObjectID,
      inAddress: *const AudioObjectPropertyAddress,
      inQualifierDataSize: u32,
      inQualifierData: *const c_void,
      outDataSize: *mut u32,
    ) -> OSStatus;
    pub fn AudioObjectGetPropertyData(
      inObjectID: AudioObjectID,
      inAddress: *const AudioObjectPropertyAddress,
      inQualifierDataSize: u32,
      inQualifierData: *const c_void,
      ioDataSize: *mut u32,
      outData: *mut c_void,
    ) -> OSStatus;
    pub fn AudioObjectSetPropertyData(
      inObjectID: AudioObjectID,
      inAddress: *const AudioObjectPropertyAddress,
      inQualifierDataSize: u32,
      inQualifierData: *const c_void,
      inDataSize: u32,
      inData: *const c_void,
    ) -> OSStatus;
    pub fn AudioDeviceCreateIOProcID(
      inDevice: AudioDeviceID,
      inProc: AudioDeviceIOProc,
      inClientData: *mut c_void,
      outIOProcID: *mut AudioDeviceIOProcID,
    ) -> OSStatus;
    pub fn AudioDeviceDestroyIOProcID(
      inDevice: AudioDeviceID,
      theIOProcID: AudioDeviceIOProcID,
    ) -> OSStatus;
    pub fn AudioDeviceStart(inDevice: AudioDeviceID, theIOProcID: AudioDeviceIOProcID) -> OSStatus;
    pub fn AudioDeviceStop(inDevice: AudioDeviceID, theIOProcID: AudioDeviceIOProcID) -> OSStatus;
    pub fn CFStringGetCString(
      theString: *const c_void,
      buffer: *mut c_char,
      bufferSize: isize,
      encoding: u32,
    ) -> u8;
    pub fn CFRelease(cf: *const c_void);
  }

  pub const kCFStringEncodingUTF8: u32 = 0x0800_0100;
}

use ffi::*;

// ---------------------------------------------------------------------------
// 属性读写小工具
// ---------------------------------------------------------------------------

/// 构造属性地址。
fn property_addr(selector: u32, scope: u32) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress {
    mSelector: selector,
    mScope: scope,
    mElement: kAudioObjectPropertyElementMain,
  }
}

/// 读取单个 Copy 类型属性。
fn get_fixed<T: Copy>(object_id: AudioObjectID, selector: u32, scope: u32) -> Result<T, String> {
  unsafe {
    let mut size = std::mem::size_of::<T>() as u32;
    let mut out: T = std::mem::zeroed();
    let status = AudioObjectGetPropertyData(
      object_id,
      &property_addr(selector, scope),
      0,
      std::ptr::null(),
      &mut size,
      &mut out as *mut T as *mut std::os::raw::c_void,
    );
    if status == kAudioNoError {
      Ok(out)
    } else {
      Err(format!("AudioObjectGetPropertyData({selector:#x}) failed: {status}"))
    }
  }
}

/// 读取 T 数组型属性。
fn get_vec<T: Copy>(object_id: AudioObjectID, selector: u32, scope: u32) -> Result<Vec<T>, String> {
  unsafe {
    let mut size = 0u32;
    let status = AudioObjectGetPropertyDataSize(
      object_id,
      &property_addr(selector, scope),
      0,
      std::ptr::null(),
      &mut size,
    );
    if status != kAudioNoError {
      return Err(format!("AudioObjectGetPropertyDataSize({selector:#x}) failed: {status}"));
    }
    if size == 0 {
      return Ok(Vec::new());
    }
    let count = size as usize / std::mem::size_of::<T>();
    let mut out: Vec<T> = Vec::with_capacity(count);
    let mut used = size;
    let status = AudioObjectGetPropertyData(
      object_id,
      &property_addr(selector, scope),
      0,
      std::ptr::null(),
      &mut used,
      out.as_mut_ptr() as *mut std::os::raw::c_void,
    );
    if status != kAudioNoError {
      return Err(format!("AudioObjectGetPropertyData({selector:#x}) failed: {status}"));
    }
    out.set_len(count);
    Ok(out)
  }
}

/// 写入属性。
fn set_data<T>(object_id: AudioObjectID, selector: u32, scope: u32, value: &T) -> Result<(), String> {
  unsafe {
    let status = AudioObjectSetPropertyData(
      object_id,
      &property_addr(selector, scope),
      0,
      std::ptr::null(),
      std::mem::size_of::<T>() as u32,
      value as *const T as *const std::os::raw::c_void,
    );
    if status == kAudioNoError {
      Ok(())
    } else {
      Err(format!("AudioObjectSetPropertyData({selector:#x}) failed: {status}"))
    }
  }
}

trait StatusExt {
  fn check(self, label: &str) -> Result<(), String>;
}

impl StatusExt for OSStatus {
  fn check(self, label: &str) -> Result<(), String> {
    if self == kAudioNoError {
      Ok(())
    } else {
      Err(format!("{label} failed: {self}"))
    }
  }
}

// ---------------------------------------------------------------------------
// 设备枚举与格式协商
// ---------------------------------------------------------------------------

/// 读取 CFStringRef 属性为 UTF-8 字符串。
fn get_cfstring(object_id: AudioObjectID, selector: u32, scope: u32) -> Option<String> {
  unsafe {
    let cf: *const std::os::raw::c_void = get_fixed(object_id, selector, scope).ok()?;
    if cf.is_null() {
      return None;
    }
    let mut buffer = [0u8; 512];
    let ok = CFStringGetCString(
      cf,
      buffer.as_mut_ptr() as *mut std::os::raw::c_char,
      buffer.len() as isize,
      kCFStringEncodingUTF8,
    );
    CFRelease(cf);
    if ok != 0 {
      let len = buffer.iter().position(|&byte| byte == 0).unwrap_or(0);
      Some(String::from_utf8_lossy(&buffer[..len]).into_owned())
    } else {
      None
    }
  }
}

/// 解析 AudioBufferList 字节（StreamConfiguration）：统计输出声道总数。
fn parse_buffer_list_channels(bytes: &[u8]) -> u32 {
  if bytes.len() < 4 {
    return 0;
  }
  let count = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).min(64);
  let buffer_stride = 4 + 4 + std::mem::size_of::<*const std::os::raw::c_void>();
  let mut channels = 0u32;
  for index in 0..count as usize {
    let base = 4 + index * buffer_stride;
    if base + 4 > bytes.len() {
      break;
    }
    channels += u32::from_le_bytes([
      bytes[base],
      bytes[base + 1],
      bytes[base + 2],
      bytes[base + 3],
    ]);
  }
  channels
}

/// 设备输出声道数（无输出流则为 0）。
fn device_output_channels(device: AudioDeviceID) -> u32 {
  match get_vec::<u8>(
    device,
    kAudioDevicePropertyStreamConfiguration,
    kAudioObjectPropertyScopeOutput,
  ) {
    Ok(bytes) => parse_buffer_list_channels(&bytes),
    Err(_) => 0,
  }
}

/// 列出具备输出流的设备。
fn output_devices() -> Vec<AudioDeviceID> {
  let devices: Vec<AudioDeviceID> = get_vec(
    kAudioObjectSystemObject,
    kAudioHardwarePropertyDevices,
    kAudioObjectPropertyScopeGlobal,
  )
  .unwrap_or_default();
  devices
    .into_iter()
    .filter(|device| device_output_channels(*device) > 0)
    .collect()
}

/// 设备显示名。
fn device_display_name(device: AudioDeviceID) -> String {
  get_cfstring(device, kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal)
    .unwrap_or_else(|| format!("AudioDevice({device})"))
}

/// 按名称或默认规则挑选输出设备，返回 (设备ID, 显示名)。
fn find_device(device_name: Option<&str>) -> Result<(AudioDeviceID, String), String> {
  match device_name {
    Some(name) => {
      for device in output_devices() {
        if device_display_name(device) == name {
          return Ok((device, name.to_string()));
        }
      }
      Err(format!("Exclusive output device not found: {name}"))
    }
    None => {
      let device: AudioDeviceID = get_fixed(
        kAudioObjectSystemObject,
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
      )?;
      let name = device_display_name(device);
      Ok((device, name))
    }
  }
}

/// 请求 hog mode 独占设备；成功后系统混音器不再向该设备送音。
fn acquire_hog_mode(device: AudioDeviceID) -> Result<(), String> {
  let pid = std::process::id() as i32;
  set_data(device, kAudioDevicePropertyHogMode, kAudioObjectPropertyScopeGlobal, &pid)
    .map_err(|error| format!("无法独占音频设备（可能被其他独占播放器占用）：{error}"))?;
  // 回读确认确实持有。
  match get_fixed::<i32>(device, kAudioDevicePropertyHogMode, kAudioObjectPropertyScopeGlobal) {
    Ok(held) if held == pid => Ok(()),
    Ok(held) => Err(format!("设备独占被其他进程持有（pid {held}）")),
    Err(error) => Err(error),
  }
}

/// 尽力释放 hog mode（初始化失败与收尾路径使用）。
fn release_hog_mode(device: AudioDeviceID) {
  let released: i32 = -1;
  let _ = set_data(device, kAudioDevicePropertyHogMode, kAudioObjectPropertyScopeGlobal, &released);
}

/// 设备是否原生支持该采样率。
fn nominal_rate_supported(device: AudioDeviceID, sample_rate: u32) -> bool {
  let ranges: Vec<AudioValueRange> = get_vec(
    device,
    kAudioDevicePropertyAvailableNominalSampleRates,
    kAudioObjectPropertyScopeGlobal,
  )
  .unwrap_or_default();
  if ranges.is_empty() {
    // 设备未上报范围时不过早拒绝，交由物理格式协商判定。
    return true;
  }
  let rate = sample_rate as f64;
  ranges
    .iter()
    .any(|range| rate + 0.5 >= range.mMinimum && rate - 0.5 <= range.mMaximum)
}

/// 设置设备名义采样率（独占下绕过系统重采样的关键）。
fn set_nominal_rate(device: AudioDeviceID, sample_rate: u32) -> Result<(), String> {
  if !nominal_rate_supported(device, sample_rate) {
    return Err(format!("设备不支持原生采样率 {sample_rate} Hz"));
  }
  let rate = sample_rate as f64;
  set_data(device, kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal, &rate)
}

/// 输出流 ID（取第一个输出流）。
fn output_stream(device: AudioDeviceID) -> Result<AudioStreamID, String> {
  let streams: Vec<AudioStreamID> =
    get_vec(device, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput)?;
  streams
    .into_iter()
    .next()
    .ok_or_else(|| "设备没有输出流".to_string())
}

/// 流当前物理格式。
fn stream_physical_format(stream: AudioStreamID) -> Result<AudioStreamBasicDescription, String> {
  get_fixed(stream, kAudioStreamPropertyPhysicalFormat, kAudioObjectPropertyScopeGlobal)
}

/// 从物理格式推导采样编码；无法表达的格式返回 None。
fn encoding_of(asbd: &AudioStreamBasicDescription) -> Option<ExclusiveEncoding> {
  if asbd.mFormatID != kAudioFormatLinearPCM {
    return None;
  }
  let is_float = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0;
  let is_packed = asbd.mFormatFlags & kAudioFormatFlagIsPacked != 0;
  let bytes_per_sample = asbd.mBytesPerFrame.max(1);

  if is_float {
    return match asbd.mBitsPerChannel {
      32 => Some(ExclusiveEncoding::Float32),
      _ => None,
    };
  }
  match (asbd.mBitsPerChannel, is_packed, bytes_per_sample) {
    (16, true, 2) => Some(ExclusiveEncoding::Int16),
    (24, true, 3) => Some(ExclusiveEncoding::Int24),
    (24, false, 4) => Some(ExclusiveEncoding::Int32Valid24),
    (32, true, 4) => Some(ExclusiveEncoding::Int32),
    _ => None,
  }
}

/// 编码偏好序（越小越优先），镜像 WASAPI 候选表语义。
fn encoding_preference(encoding: ExclusiveEncoding, preferred_depth: Option<u8>) -> u32 {
  match preferred_depth {
    Some(16) => match encoding {
      ExclusiveEncoding::Int16 => 0,
      ExclusiveEncoding::Float32 => 1,
      _ => 100,
    },
    Some(24) => match encoding {
      ExclusiveEncoding::Int24 => 0,
      ExclusiveEncoding::Int32Valid24 => 1,
      ExclusiveEncoding::Int32 => 2,
      ExclusiveEncoding::Float32 => 3,
      _ => 100,
    },
    Some(32) => match encoding {
      ExclusiveEncoding::Int32 => 0,
      ExclusiveEncoding::Float32 => 1,
      _ => 100,
    },
    _ => match encoding {
      ExclusiveEncoding::Float32 => 0,
      ExclusiveEncoding::Int32Valid24 => 1,
      ExclusiveEncoding::Int24 => 2,
      ExclusiveEncoding::Int32 => 3,
      ExclusiveEncoding::Int16 => 4,
    },
  }
}

/// 枚举输出流可用物理格式。
fn available_physical_formats(stream: AudioStreamID) -> Vec<AudioStreamRangedDescription> {
  get_vec(
    stream,
    kAudioStreamPropertyAvailablePhysicalFormats,
    kAudioObjectPropertyScopeGlobal,
  )
  .unwrap_or_default()
}

/// 协商物理格式：在设备可用格式中按编码偏好挑选，切换并回读验证。
/// 返回 (实际生效格式, 编码)。
fn negotiate_physical_format(
  stream: AudioStreamID,
  sample_rate: u32,
  channels: u16,
  preferred_depth: Option<u8>,
  restrict_to_24bit_int: bool,
) -> Result<(AudioStreamBasicDescription, ExclusiveEncoding), String> {
  let rate = sample_rate as f64;
  let mut best: Option<(u32, AudioStreamRangedDescription)> = None;
  for candidate in available_physical_formats(stream) {
    let asbd = candidate.mFormat;
    // 采样率覆盖与声道数匹配是硬条件。
    if rate + 0.5 < candidate.mSampleRateRange.mMinimum
      || rate - 0.5 > candidate.mSampleRateRange.mMaximum
    {
      continue;
    }
    if asbd.mChannelsPerFrame != 0 && asbd.mChannelsPerFrame != channels as u32 {
      continue;
    }
    if restrict_to_24bit_int {
      let is_int = asbd.mFormatFlags & kAudioFormatFlagIsFloat == 0;
      if !is_int || asbd.mBitsPerChannel != 24 {
        continue;
      }
    }
    let Some(encoding) = encoding_of(&asbd) else {
      continue;
    };
    let preference = encoding_preference(encoding, preferred_depth);
    if best
      .as_ref()
      .map_or(true, |(best_score, _)| preference < *best_score)
    {
      best = Some((preference, candidate));
    }
  }

  let Some((_, chosen)) = best else {
    return Err(format!(
      "设备不支持独占格式 {sample_rate} Hz / {channels} 声道"
    ));
  };

  // 下发目标格式：采样率锁定为目标值。
  let mut target = chosen.mFormat;
  target.mSampleRate = rate;
  target.mFramesPerPacket = 1;
  if target.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0 {
    target.mBytesPerPacket = target.mBytesPerFrame;
  }
  let ranged = AudioStreamRangedDescription {
    mFormat: target,
    mSampleRateRange: AudioValueRange { mMinimum: rate, mMaximum: rate },
  };
  set_data(stream, kAudioStreamPropertyPhysicalFormat, kAudioObjectPropertyScopeGlobal, &ranged)?;

  // 回读验证：设备切换可能异步生效，短暂等待至格式稳定。
  for _ in 0..FORMAT_SETTLE_ATTEMPTS {
    let actual = stream_physical_format(stream)?;
    let rate_ok = (actual.mSampleRate - rate).abs() < 0.5;
    if rate_ok && actual.mBitsPerChannel == target.mBitsPerChannel {
      if let Some(encoding) = encoding_of(&actual) {
        return Ok((actual, encoding));
      }
      return Err(format!("设备物理格式无法映射编码: {actual:?}"));
    }
    thread::sleep(Duration::from_millis(50));
  }
  Err("设备物理格式切换未生效".to_string())
}

// ---------------------------------------------------------------------------
// 环形缓冲（喂送线程 → 实时回调）
// ---------------------------------------------------------------------------

struct RingInner {
  buffer: Vec<u8>,
  read_pos: usize,
  write_pos: usize,
  len: usize,
}

struct SampleRing {
  inner: Mutex<RingInner>,
  capacity: usize,
  notify: Condvar,
}

impl SampleRing {
  fn new(capacity: usize) -> Self {
    Self {
      inner: Mutex::new(RingInner {
        buffer: vec![0u8; capacity],
        read_pos: 0,
        write_pos: 0,
        len: 0,
      }),
      capacity,
      notify: Condvar::new(),
    }
  }

  fn locked(&self) -> std::sync::MutexGuard<'_, RingInner> {
    self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
  }

  fn free_space(&self) -> usize {
    self.capacity - self.locked().len
  }

  fn stored_bytes(&self) -> usize {
    self.locked().len
  }

  /// 推入字节；缓冲满时阻塞等待，running 变 false 时中止（返回 false）。
  fn push_cancellable(&self, mut bytes: &[u8], running: &AtomicBool) -> bool {
    while !bytes.is_empty() {
      let mut inner = self.locked();
      while inner.len == self.capacity {
        if !running.load(Ordering::Relaxed) {
          return false;
        }
        let (guard, _timeout) = self
          .notify
          .wait_timeout(inner, Duration::from_millis(50))
          .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner = guard;
      }
      let write = inner.write_pos;
      let take = bytes
        .len()
        .min(self.capacity - inner.len)
        .min(self.capacity - write);
      inner.buffer[write..write + take].copy_from_slice(&bytes[..take]);
      inner.write_pos = (write + take) % self.capacity;
      inner.len += take;
      bytes = &bytes[take..];
      self.notify.notify_all();
    }
    true
  }

  /// 清空缓冲（seek 重建音源后调用）。
  fn clear(&self) {
    let mut inner = self.locked();
    inner.read_pos = 0;
    inner.write_pos = 0;
    inner.len = 0;
    self.notify.notify_all();
  }

  /// 尽力取出 want 字节到 output，返回实际取出数（实时回调路径，勿阻塞）。
  fn try_drain(&self, output: &mut [u8]) -> usize {
    let mut inner = self.locked();
    let take = output.len().min(inner.len);
    if take == 0 {
      return 0;
    }
    let read = inner.read_pos;
    let first = take.min(self.capacity - read);
    output[..first].copy_from_slice(&inner.buffer[read..read + first]);
    if take > first {
      let rest = take - first;
      output[first..take].copy_from_slice(&inner.buffer[..rest]);
    }
    inner.read_pos = (read + take) % self.capacity;
    inner.len -= take;
    self.notify.notify_all();
    take
  }
}

// ---------------------------------------------------------------------------
// 会话共享状态
// ---------------------------------------------------------------------------

/// 喂送线程、实时回调与控制线程之间的共享状态。
struct ExclusiveShared {
  ring: SampleRing,
  /// 实时回调是否送出音频（暂停/停止时输出静音）。
  audible: AtomicBool,
  /// 会话是否仍在运行（false 后回调只输出静音并不再取数）。
  running: AtomicBool,
  /// 喂送线程已读完音源。
  source_ended: AtomicBool,
  /// 结束标记与错误信息。
  finish: AtomicU8,
  finish_error: Mutex<Option<String>>,
  /// 待执行的 seek 目标时间。
  seek_request: Mutex<Option<Duration>>,
  /// 响度归一化句柄（喂送线程装配链后填入，控制线程写入增益）。
  normalizer: Mutex<Option<VolumeNormalizerHandle>>,
  /// 音量平衡增益（seek 重建音源时按此值装配新链）。
  balance_gain: Mutex<f32>,
  /// 回调交换数据使用的交错每帧字节数。
  bytes_per_frame: usize,
  /// 设备声道数（非交错物理格式时用于拆面）。
  channels: u32,
  /// 非交错物理格式标记。
  non_interleaved: bool,
  /// 回调拆面/复制的暂存区（仅 IOProc 线程访问）。
  scratch: Mutex<Vec<u8>>,
}

impl ExclusiveShared {
  fn finish_ok(&self) {
    self.finish.store(FINISH_OK, Ordering::SeqCst);
  }

  fn finish_err(&self, message: String) {
    if let Ok(mut slot) = self.finish_error.lock() {
      *slot = Some(message);
    }
    self.finish.store(FINISH_ERR, Ordering::SeqCst);
  }

  fn take_seek(&self) -> Option<Duration> {
    self.seek_request
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
      .take()
  }

  fn current_balance_gain(&self) -> f32 {
    *self
      .balance_gain
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
  }
}

// ---------------------------------------------------------------------------
// 实时回调
// ---------------------------------------------------------------------------

/// 把输出缓冲整体清零（静音）。
unsafe fn silence_buffers(list: *mut AudioBufferList) {
  let count = (*list).mNumberBuffers as usize;
  for index in 0..count {
    let buffer = &mut *(*list).mBuffers.as_mut_ptr().add(index);
    std::ptr::write_bytes(buffer.mData as *mut u8, 0, buffer.mDataByteSize as usize);
  }
}

unsafe extern "C" fn exclusive_io_proc(
  _device: AudioDeviceID,
  _now: *const std::os::raw::c_void,
  _input: *const AudioBufferList,
  _input_time: *const std::os::raw::c_void,
  output: *mut AudioBufferList,
  _output_time: *const std::os::raw::c_void,
  client_data: *mut std::os::raw::c_void,
) -> OSStatus {
  let shared = &*(client_data as *const ExclusiveShared);
  if !shared.running.load(Ordering::Relaxed) || !shared.audible.load(Ordering::Relaxed) {
    silence_buffers(output);
    return kAudioNoError;
  }

  let list = &mut *output;
  if list.mNumberBuffers == 0 || shared.bytes_per_frame == 0 || shared.channels == 0 {
    return kAudioNoError;
  }

  if !shared.non_interleaved {
    // 交错：单缓冲直接从环形缓冲搬运。
    let buffer = &mut list.mBuffers[0];
    let want = buffer.mDataByteSize as usize;
    let out = std::slice::from_raw_parts_mut(buffer.mData as *mut u8, want);
    let got = shared.ring.try_drain(out);
    if got < want {
      std::ptr::write_bytes(out[got..].as_mut_ptr(), 0, want - got);
    }
    return kAudioNoError;
  }

  // 非交错：先取交错数据到暂存区，再按声道拆面写入。
  let bytes_per_sample = (shared.bytes_per_frame / shared.channels as usize).max(1);
  let first = &mut list.mBuffers[0];
  let plane_bytes = first.mDataByteSize as usize; // 单声道平面大小
  let frames = plane_bytes / bytes_per_sample;
  let interleaved_bytes = frames * shared.bytes_per_frame;
  if frames == 0 || frames > SCRATCH_FRAME_CAPACITY || interleaved_bytes == 0 {
    silence_buffers(output);
    return kAudioNoError;
  }

  let mut scratch = shared
    .scratch
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());
  scratch.resize(interleaved_bytes, 0);
  let got = shared.ring.try_drain(&mut scratch[..interleaved_bytes]);
  if got < interleaved_bytes {
    std::ptr::write_bytes(scratch[got..].as_mut_ptr(), 0, interleaved_bytes - got);
  }

  let _channels = shared.channels as usize;
  for channel in 0..list.mNumberBuffers as usize {
    let plane = &mut *list.mBuffers.as_mut_ptr().add(channel);
    let plane_out = std::slice::from_raw_parts_mut(plane.mData as *mut u8, plane_bytes);
    for frame in 0..frames {
      let base = frame * shared.bytes_per_frame + channel * bytes_per_sample;
      plane_out[frame * bytes_per_sample..(frame + 1) * bytes_per_sample]
        .copy_from_slice(&scratch[base..base + bytes_per_sample]);
    }
  }
  kAudioNoError
}

/// 注册 IOProc（不启动设备）；返回 IOProcID。
fn register_io_proc(
  device: AudioDeviceID,
  shared: &Arc<ExclusiveShared>,
) -> Result<AudioDeviceIOProcID, String> {
  unsafe {
    let mut io_proc_id: AudioDeviceIOProcID = std::ptr::null_mut();
    AudioDeviceCreateIOProcID(
      device,
      exclusive_io_proc,
      Arc::as_ptr(shared) as *mut std::os::raw::c_void,
      &mut io_proc_id,
    )
    .check("AudioDeviceCreateIOProcID")?;
    Ok(io_proc_id)
  }
}

// ---------------------------------------------------------------------------
// 喂送线程
// ---------------------------------------------------------------------------

/// 喂送音源：PCM 解码链或 DoP 原生码流。
enum FeedKind {
  Pcm(ExclusiveAudioFeed),
  Dop {
    source: DopStreamSource,
    rate: u32,
    channels: u32,
  },
}

/// 喂送线程重建音源所需的固定参数。
struct FeederContext {
  path: String,
  bit_perfect: bool,
  progress: Arc<SharedProgress>,
  equalizer: Arc<EqualizerHandle>,
  sound_effect: Arc<SoundEffectHandle>,
  user_volume: Arc<AtomicU32>,
}

/// 喂送线程：解码 → 编码 → 环形缓冲。处理 seek 重建与播放结束检测。
fn run_feeder(
  shared: Arc<ExclusiveShared>,
  context: FeederContext,
  _start_time: Duration,
  encoding: ExclusiveEncoding,
  bytes_per_frame: usize,
  kind: FeedKind,
) {
  let mut kind = kind;
  // PCM：装配归一化句柄槽位；DoP：进度已由计划阶段写入。
  if let FeedKind::Pcm(feed) = &mut kind {
    feed.normalizer_handle.set_target_gain(shared.current_balance_gain());
    if let Ok(mut slot) = shared.normalizer.lock() {
      *slot = Some(feed.normalizer_handle.clone());
    }
  }

  let mut chunk: Vec<u8> = Vec::with_capacity(FEED_CHUNK_FRAMES * bytes_per_frame.max(1));
  loop {
    if !shared.running.load(Ordering::Relaxed) {
      return;
    }

    // seek：整体重建音源，失败则保留当前播放。
    if let Some(time) = shared.take_seek() {
      shared.source_ended.store(false, Ordering::Relaxed);
      shared.ring.clear();
      match &mut kind {
        FeedKind::Pcm(feed) => {
          match ExclusiveAudioFeed::open(
            &context.path,
            time,
            context.progress.clone(),
            shared.current_balance_gain(),
            context.equalizer.clone(),
            context.sound_effect.clone(),
            context.user_volume.clone(),
            context.bit_perfect,
          ) {
            Ok((next_feed, _, _, _)) => {
              next_feed
                .normalizer_handle
                .set_target_gain(shared.current_balance_gain());
              if let Ok(mut slot) = shared.normalizer.lock() {
                *slot = Some(next_feed.normalizer_handle.clone());
              }
              *feed = next_feed;
            }
            Err(error) => {
              eprintln!("[coreaudio_exclusive] seek 打开新音源失败，保留当前播放: {error}");
            }
          }
        }
        FeedKind::Dop { source, rate, channels } => {
          let target_frame = (time.as_secs_f64() * *rate as f64).round() as u64;
          match source.seek_to_frame(target_frame) {
            Ok(frame) => {
              context
                .progress
                .samples_played
                .store(frame * *channels as u64, Ordering::Relaxed);
            }
            Err(error) => {
              eprintln!("[coreaudio_exclusive] DoP seek 失败，保留当前播放: {error}");
            }
          }
        }
      }
    }

    if !shared.audible.load(Ordering::Relaxed) {
      // 暂停期间不解码不推进，回调输出静音。
      let inner = shared.ring.locked();
      let _unused = shared
        .ring
        .notify
        .wait_timeout(inner, Duration::from_millis(50))
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      continue;
    }

    // 音源耗尽：等环形缓冲播完再收尾。
    if shared.source_ended.load(Ordering::Relaxed) {
      if shared.ring.stored_bytes() == 0 {
        shared.finish_ok();
        return;
      }
      thread::sleep(Duration::from_millis(10));
      continue;
    }

    match &mut kind {
      FeedKind::Pcm(feed) => {
        if shared.ring.free_space() < FEED_CHUNK_FRAMES * bytes_per_frame {
          thread::sleep(Duration::from_millis(5));
          continue;
        }
        let ended = feed.read_frames_into(FEED_CHUNK_FRAMES, encoding, &mut chunk);
        if !shared.ring.push_cancellable(&chunk, &shared.running) {
          return;
        }
        if ended {
          shared.source_ended.store(true, Ordering::Relaxed);
        }
      }
      FeedKind::Dop { source, rate: _, channels } => {
        let free_frames = shared.ring.free_space() / 3;
        if free_frames == 0 {
          thread::sleep(Duration::from_millis(5));
          continue;
        }
        chunk.clear();
        let wanted = free_frames.min(FEED_CHUNK_FRAMES);
        let frames = match source.next_frames(&mut chunk, wanted) {
          Ok(frames) => frames,
          Err(error) => {
            shared.finish_err(format!("DoP 读取失败: {error}"));
            return;
          }
        };
        if frames > 0
          && !shared
            .ring
            .push_cancellable(&chunk[..frames * 3], &shared.running)
        {
          return;
        }
        context
          .progress
          .samples_played
          .fetch_add(frames as u64 * *channels as u64, Ordering::Relaxed);
        if frames < wanted {
          shared.source_ended.store(true, Ordering::Relaxed);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 会话计划（协商结果）
// ---------------------------------------------------------------------------

/// 协商完成后的会话计划。
struct SessionPlan {
  kind: FeedKind,
  encoding: ExclusiveEncoding,
  /// 交错每帧字节数。
  bytes_per_frame: usize,
  channels: u32,
  non_interleaved: bool,
  sample_rate: u32,
}

impl SessionPlan {
  /// 环形缓冲容量：约 0.5 秒音频，限制进度超前幅度。
  fn ring_capacity(&self) -> usize {
    let bytes_per_second = self.bytes_per_frame.max(1) * self.sample_rate as usize;
    (bytes_per_second / 2).clamp(1 << 18, 1 << 21)
  }
}

/// DSD 文件的 DoP 直通计划；设备不支持时返回 None 交回 PCM 路径。
fn try_dop_plan(
  device: AudioDeviceID,
  stream: AudioStreamID,
  request: &ExclusivePlayRequest,
) -> Result<Option<SessionPlan>, String> {
  let lower = request.path.to_lowercase();
  if !lower.ends_with(".dsf") && !lower.ends_with(".dff") {
    return Ok(None);
  }
  let info = match parse_dsd_info(&request.path) {
    Ok(info) if !info.is_dst => info,
    _ => return Ok(None),
  };
  let Some(dop_rate) = dop_pcm_rate(info.dsd_rate) else {
    return Ok(None);
  };

  set_nominal_rate(device, dop_rate)?;
  let Ok((actual, encoding)) =
    negotiate_physical_format(stream, dop_rate, info.channels, None, true)
  else {
    // 设备不支持该 DoP 速率的 24bit 格式时放弃直通，交回 PCM 路径。
    return Ok(None);
  };
  let non_interleaved = actual.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0;
  let bytes_per_frame = if non_interleaved {
    actual.mBytesPerFrame * actual.mChannelsPerFrame
  } else {
    actual.mBytesPerFrame
  } as usize;

  // DoP 数据（3 字节交错打包）必须能原样直出。
  if !matches!(encoding, ExclusiveEncoding::Int24)
    || bytes_per_frame != info.channels as usize * 3
  {
    return Ok(None);
  }

  let mut source = DopStreamSource::open(&request.path, &info)?;
  let skip_frames = (request.start_time.as_secs_f64() * dop_rate as f64).round() as u64;
  let actual_start_frame = source.seek_to_frame(skip_frames)?;

  request.progress.sample_rate.store(dop_rate, Ordering::Relaxed);
  request
    .progress
    .channels
    .store(info.channels as u32, Ordering::Relaxed);
  request
    .progress
    .samples_played
    .store(actual_start_frame * info.channels as u64, Ordering::Relaxed);
  request.progress.visualizer.reset();

  Ok(Some(SessionPlan {
    kind: FeedKind::Dop {
      source,
      rate: dop_rate,
      channels: info.channels as u32,
    },
    encoding,
    bytes_per_frame,
    channels: info.channels as u32,
    non_interleaved,
    sample_rate: dop_rate,
  }))
}

/// 组装会话计划：DoP 直通优先，失败回退 PCM 协商。
fn build_session_plan(
  device: AudioDeviceID,
  stream: AudioStreamID,
  request: &ExclusivePlayRequest,
) -> Result<SessionPlan, String> {
  if request.dsd_native_passthrough {
    match try_dop_plan(device, stream, request) {
      Ok(Some(plan)) => return Ok(plan),
      Ok(None) => {}
      Err(error) => return Err(error),
    }
  }

  let (feed, sample_rate, channels, preferred_depth) = ExclusiveAudioFeed::open(
    &request.path,
    request.start_time,
    request.progress.clone(),
    request.volume_balance_gain,
    request.equalizer_handle.clone(),
    request.sound_effect_handle.clone(),
    request.user_volume.clone(),
    request.bit_perfect,
  )?;

  set_nominal_rate(device, sample_rate)?;
  let (actual, encoding) =
    negotiate_physical_format(stream, sample_rate, channels, preferred_depth, false)?;
  let non_interleaved = actual.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0;
  let bytes_per_frame = if non_interleaved {
    actual.mBytesPerFrame * actual.mChannelsPerFrame
  } else {
    actual.mBytesPerFrame
  } as usize;

  Ok(SessionPlan {
    kind: FeedKind::Pcm(feed),
    encoding,
    bytes_per_frame,
    channels: channels as u32,
    non_interleaved,
    sample_rate,
  })
}

// ---------------------------------------------------------------------------
// 对外控制面
// ---------------------------------------------------------------------------

/// 独占播放会话：命令通道 + 结果通道 + 后台线程句柄。
pub(crate) struct CoreAudioExclusivePlayback {
  tx: Sender<ExclusiveControl>,
  result_rx: Receiver<Result<(), String>>,
  join_handle: Option<JoinHandle<()>>,
  active_device_name: String,
}

impl CoreAudioExclusivePlayback {
  /// 启动独占播放线程并等待初始化握手（3 秒超时）。
  pub(crate) fn start(request: ExclusivePlayRequest) -> Result<Self, OutputError> {
    let (control_tx, control_rx) = channel::<ExclusiveControl>();
    let (init_tx, init_rx) = std::sync::mpsc::sync_channel::<Result<String, String>>(1);
    let (result_tx, result_rx) = channel::<Result<(), String>>();

    let join_handle = thread::spawn(move || {
      let outcome = run_exclusive_playback(request, control_rx, init_tx);
      if let Err(error) = &outcome {
        eprintln!("Core Audio exclusive playback failed: {error}");
      }
      let _ = result_tx.send(outcome);
    });

    match init_rx.recv_timeout(Duration::from_secs(STARTUP_HANDSHAKE_SECS)) {
      Ok(Ok(active_device_name)) => Ok(Self {
        tx: control_tx,
        result_rx,
        join_handle: Some(join_handle),
        active_device_name,
      }),
      Ok(Err(error)) => {
        let _ = control_tx.send(ExclusiveControl::Stop);
        let _ = join_handle.join();
        Err(OutputError::Exclusive(error))
      }
      Err(RecvTimeoutError::Timeout) => {
        let _ = control_tx.send(ExclusiveControl::Stop);
        let _ = join_handle.join();
        Err(OutputError::Exclusive(format!(
          "Core Audio exclusive initialization timed out after {STARTUP_HANDSHAKE_SECS} seconds"
        )))
      }
      Err(RecvTimeoutError::Disconnected) => {
        let _ = join_handle.join();
        Err(OutputError::Exclusive(
          "Core Audio exclusive initialization thread disconnected".to_string(),
        ))
      }
    }
  }

  pub(crate) fn active_device_name(&self) -> &str {
    &self.active_device_name
  }

  pub(crate) fn seek(&self, time: Duration, is_playing: bool) {
    let _ = self.tx.send(ExclusiveControl::Seek { time, is_playing });
  }

  pub(crate) fn set_volume_balance(&self, enabled: bool, target_gain: f32) {
    let _ = self.tx.send(ExclusiveControl::SetVolumeBalance {
      enabled,
      target_gain,
    });
  }

  pub(crate) fn set_equalizer_settings(&self, settings: EqualizerSettings) {
    let _ = self
      .tx
      .send(ExclusiveControl::SetEqualizerSettings { settings });
  }

  pub(crate) fn set_sound_effect_settings(&self, settings: SoundEffectSettings) {
    let _ = self
      .tx
      .send(ExclusiveControl::SetSoundEffectSettings { settings });
  }

  /// 请求停止并等待线程退出。
  pub(crate) fn stop(&mut self) {
    let _ = self.tx.send(ExclusiveControl::Stop);
    if let Some(join_handle) = self.join_handle.take() {
      let _ = join_handle.join();
    }
  }

  /// 非阻塞探测播放线程是否已结束（Err 表示异常退出）。
  pub(crate) fn try_finished(&self) -> Option<Result<(), String>> {
    match self.result_rx.try_recv() {
      Ok(result) => Some(result),
      Err(TryRecvError::Empty) => None,
      Err(TryRecvError::Disconnected) => Some(Err(
        "Core Audio exclusive playback thread disconnected".to_string(),
      )),
    }
  }
}

impl Drop for CoreAudioExclusivePlayback {
  fn drop(&mut self) {
    self.stop();
  }
}

// ---------------------------------------------------------------------------
// 主播放流程
// ---------------------------------------------------------------------------

/// 会话资源收尾：停回调 → 销毁 IOProc → 停喂送线程 → 释放 hog。
struct SessionCleanup {
  device: AudioDeviceID,
  io_proc_id: Option<AudioDeviceIOProcID>,
  shared: Option<Arc<ExclusiveShared>>,
  feeder: Option<JoinHandle<()>>,
}

impl SessionCleanup {
  fn dismantle(&mut self) {
    if let Some(shared) = &self.shared {
      shared.running.store(false, Ordering::Relaxed);
    }
    if let Some(io_proc_id) = self.io_proc_id.take() {
      unsafe {
        let _ = AudioDeviceStop(self.device, io_proc_id);
        let _ = AudioDeviceDestroyIOProcID(self.device, io_proc_id);
      }
    }
    if let Some(feeder) = self.feeder.take() {
      let _ = feeder.join();
    }
    release_hog_mode(self.device);
  }
}

fn run_exclusive_playback(
  request: ExclusivePlayRequest,
  control_rx: Receiver<ExclusiveControl>,
  init_tx: std::sync::mpsc::SyncSender<Result<String, String>>,
) -> Result<(), String> {
  request
    .user_volume
    .store(request.volume.to_bits(), Ordering::Relaxed);

  let (device, device_name) = find_device(request.device_name.as_deref())?;
  if let Err(error) = acquire_hog_mode(device) {
    release_hog_mode(device);
    return Err(error);
  }

  let stream = match output_stream(device) {
    Ok(stream) => stream,
    Err(error) => {
      let _ = init_tx.send(Err(error.clone()));
      release_hog_mode(device);
      return Err(error);
    }
  };

  let mut plan = match build_session_plan(device, stream, &request) {
    Ok(plan) => plan,
    Err(error) => {
      let _ = init_tx.send(Err(error.clone()));
      release_hog_mode(device);
      return Err(error);
    }
  };
  let ring_capacity = plan.ring_capacity();

  let shared = ExclusiveShared {
    ring: SampleRing::new(ring_capacity),
    audible: AtomicBool::new(request.is_playing),
    running: AtomicBool::new(true),
    source_ended: AtomicBool::new(false),
    finish: AtomicU8::new(FINISH_NONE),
    finish_error: Mutex::new(None),
    seek_request: Mutex::new(None),
    normalizer: Mutex::new(None),
    balance_gain: Mutex::new(request.volume_balance_gain),
    bytes_per_frame: plan.bytes_per_frame,
    channels: plan.channels,
    non_interleaved: plan.non_interleaved,
    scratch: Mutex::new(Vec::new()),
  };
  // PCM 链的归一化句柄预填，控制线程可立刻写增益。
  if let FeedKind::Pcm(feed) = &mut plan.kind {
    feed
      .normalizer_handle
      .set_target_gain(request.volume_balance_gain);
    if let Ok(mut slot) = shared.normalizer.lock() {
      *slot = Some(feed.normalizer_handle.clone());
    }
  }
  if plan.non_interleaved {
    if let Ok(mut scratch) = shared.scratch.lock() {
      scratch.reserve_exact(SCRATCH_FRAME_CAPACITY * plan.bytes_per_frame.max(1));
    }
  }
  let shared = Arc::new(shared);

  let io_proc_id = match register_io_proc(device, &shared) {
    Ok(id) => id,
    Err(error) => {
      let _ = init_tx.send(Err(error.clone()));
      release_hog_mode(device);
      return Err(error);
    }
  };

  let context = FeederContext {
    path: request.path.clone(),
    bit_perfect: request.bit_perfect,
    progress: request.progress.clone(),
    equalizer: request.equalizer_handle.clone(),
    sound_effect: request.sound_effect_handle.clone(),
    user_volume: request.user_volume.clone(),
  };
  let feeder = {
    let shared = shared.clone();
    thread::spawn(move || run_feeder(shared, context, request.start_time, plan.encoding, plan.bytes_per_frame, plan.kind))
  };

  let mut cleanup = SessionCleanup {
    device,
    io_proc_id: Some(io_proc_id),
    shared: Some(shared.clone()),
    feeder: Some(feeder),
  };

  // 预填后启动设备（无论是否处于播放态都启动，静音由回调内 audible 开关控制）。
  let prime_target = ring_capacity / RING_PRIME_RATIO;
  let primed_at = std::time::Instant::now();
  while shared.ring.stored_bytes() < prime_target
    && primed_at.elapsed() < Duration::from_millis(500)
    && !shared.source_ended.load(Ordering::Relaxed)
  {
    thread::sleep(Duration::from_millis(10));
  }
  if let Err(error) = unsafe { AudioDeviceStart(device, io_proc_id) }.check("AudioDeviceStart") {
    cleanup.dismantle();
    let _ = init_tx.send(Err(error.clone()));
    return Err(error);
  }

  let _ = init_tx.send(Ok(device_name));

  let outcome = control_loop(&shared, &control_rx, &request);
  cleanup.dismantle();
  outcome
}

/// 控制循环：命令转发 + 结束检测。
fn control_loop(
  shared: &Arc<ExclusiveShared>,
  control_rx: &Receiver<ExclusiveControl>,
  request: &ExclusivePlayRequest,
) -> Result<(), String> {
  loop {
    match control_rx.recv_timeout(Duration::from_millis(20)) {
      Ok(ExclusiveControl::Seek { time, is_playing }) => {
        shared.audible.store(is_playing, Ordering::Relaxed);
        if let Ok(mut slot) = shared.seek_request.lock() {
          *slot = Some(time);
        }
        shared.ring.notify.notify_all();
      }
      Ok(ExclusiveControl::Stop) => return Ok(()),
      Ok(ExclusiveControl::SetVolumeBalance { enabled, target_gain }) => {
        let next_gain = if enabled { target_gain } else { 1.0 };
        if let Ok(mut gain) = shared.balance_gain.lock() {
          *gain = next_gain;
        }
        if let Ok(slot) = shared.normalizer.lock() {
          if let Some(handle) = slot.as_ref() {
            handle.set_target_gain(next_gain);
          }
        }
      }
      Ok(ExclusiveControl::SetEqualizerSettings { settings }) => {
        request.equalizer_handle.set_settings(settings);
      }
      Ok(ExclusiveControl::SetSoundEffectSettings { settings }) => {
        request.sound_effect_handle.set_settings(settings);
      }
      Err(RecvTimeoutError::Timeout) => {}
      Err(RecvTimeoutError::Disconnected) => return Ok(()),
    }

    match shared.finish.load(Ordering::SeqCst) {
      FINISH_OK => return Ok(()),
      FINISH_ERR => {
        let message = shared
          .finish_error
          .lock()
          .unwrap_or_else(|poisoned| poisoned.into_inner())
          .clone()
          .unwrap_or_else(|| "Core Audio exclusive playback failed".to_string());
        return Err(message);
      }
      _ => {}
    }
  }
}

// ---------------------------------------------------------------------------
// 编码映射单测
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;

  fn asbd(bits: u32, flags: u32, bytes_per_frame: u32, channels: u32) -> AudioStreamBasicDescription {
    AudioStreamBasicDescription {
      mSampleRate: 44_100.0,
      mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: flags,
      mBytesPerPacket: bytes_per_frame,
      mFramesPerPacket: 1,
      mBytesPerFrame: bytes_per_frame,
      mChannelsPerFrame: channels,
      mBitsPerChannel: bits,
    }
  }

  #[test]
  fn encoding_of_maps_common_device_formats() {
    let packed = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
    let float_packed = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    let int_non_interleaved =
      kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved;

    assert!(matches!(
      encoding_of(&asbd(16, packed, 2, 2)),
      Some(ExclusiveEncoding::Int16)
    ));
    assert!(matches!(
      encoding_of(&asbd(24, packed, 3, 2)),
      Some(ExclusiveEncoding::Int24)
    ));
    assert!(matches!(
      encoding_of(&asbd(32, packed, 4, 2)),
      Some(ExclusiveEncoding::Int32)
    ));
    // 24bit 打包进 32bit 容器（非 packed）。
    assert!(matches!(
      encoding_of(&asbd(24, kAudioFormatFlagIsSignedInteger, 4, 2)),
      Some(ExclusiveEncoding::Int32Valid24)
    ));
    assert!(matches!(
      encoding_of(&asbd(32, float_packed, 4, 2)),
      Some(ExclusiveEncoding::Float32)
    ));
    // 非交错不影响编码推导（每帧字节数为单声道值）。
    assert!(matches!(
      encoding_of(&asbd(32, int_non_interleaved, 4, 2)),
      Some(ExclusiveEncoding::Int32)
    ));
  }

  #[test]
  fn buffer_list_channel_parse_reads_le_counts() {
    // 2 个缓冲，各 2 声道。
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&2u32.to_le_bytes());
    for _ in 0..2 {
      bytes.extend_from_slice(&2u32.to_le_bytes()); // mNumberChannels
      bytes.extend_from_slice(&512u32.to_le_bytes()); // mDataByteSize
      bytes.extend_from_slice(&0usize.to_le_bytes()); // mData 指针占位
    }
    assert_eq!(parse_buffer_list_channels(&bytes), 4);
  }

  #[test]
  fn encoding_preference_mirrors_depth_candidate_order() {
    // 24bit 源：Int24 优先于 Float32。
    assert!(encoding_preference(ExclusiveEncoding::Int24, Some(24))
      < encoding_preference(ExclusiveEncoding::Float32, Some(24)));
    // 无位深偏好：Float32 优先（全量候选表首位）。
    assert!(encoding_preference(ExclusiveEncoding::Float32, None)
      < encoding_preference(ExclusiveEncoding::Int24, None));
  }
}
