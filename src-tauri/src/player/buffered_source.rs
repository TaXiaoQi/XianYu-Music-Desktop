use rodio::source::{SeekError};
use rodio::{Source};
use std::collections::{VecDeque};
use std::marker::{PhantomData};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc};
use std::{thread};
use std::time::{Duration, Instant};
const BLOCK_SAMPLES: usize = 1024usize;
const CHANNEL_BLOCKS: usize = 64usize;
const BACKOFF: Duration = Duration::from_micros(400_u64);
#[cfg(test)]
const CONSUMER_WAIT_TIMEOUT: Duration = Duration::from_millis(500);
#[cfg(not(test))]
const CONSUMER_WAIT_TIMEOUT: Duration = BACKOFF;

#[cfg(windows)]
#[link(name = "kernel32")] // 链接系统库
extern "system" { // 外部函数
  fn GetCurrentThread() -> isize;
  fn SetThreadPriority(handle: isize, priority: i32) -> i32;
} // 外部声明
#[cfg(windows)]
const THREAD_PRIORITY_ABOVE_NORMAL: i32 = 1_i32;
#[cfg(windows)]
fn elevate_thread_priority() { // 提升线程优先级
  unsafe {
    let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
  }
} // elevate_thread_priority
#[cfg(not(windows))]
#[inline(always)]
fn elevate_thread_priority() { /* 平台占位 */ }
enum Command { // 生产者命令
  Seek { pos: Duration, gen: u64 },
  Stop,
} // 生产者命令
enum SeekAck { // 定位应答
  Ok(u64),
  Failed(u64),
} // 定位应答
pub struct BufferedSource<I> { // BufferedSource
  sample_rx: Receiver<Vec<f32>>,
  cmd_tx: SyncSender<Command>,
  ack_rx: Receiver<SeekAck>,
  seek_epoch: Arc<AtomicU64>,
  sample_rate: u32,
  channels: u16,
  total_duration: Option<Duration>,
  current_block: VecDeque<f32>,
  exhausted: bool,
  monitor: Option<Arc<crate::player::types::BufferedMonitor>>,
  thread_handle: Option<thread::JoinHandle<()>>,
  _marker: PhantomData<I>,
} // BufferedSource
impl<I> BufferedSource<I> // BufferedSource
where // 泛型约束
  I: Source<Item = f32> + Send + 'static,
{ // 实现体
  #[inline]
  fn set_starvation(&self, value: bool) {
    if let Some(monitor) = &self.monitor {
      monitor.starved.store(value, Ordering::Relaxed);
    } // set_starvation
  }
  pub fn new(inner: I) -> Self {
    Self::new_tracked(inner, None)
  }
  pub fn new_tracked(
    inner: I,
    monitor: Option<Arc<crate::player::types::BufferedMonitor>>,
  ) -> Self {
    let sample_rate = inner.sample_rate();
    let channels = inner.channels();
    let total_duration = inner.total_duration();

    let (cmd_tx, cmd_rx) = mpsc::sync_channel::<Command>(8);
    let (sample_tx, sample_rx) = mpsc::sync_channel::<Vec<f32>>(CHANNEL_BLOCKS);
    let (ack_tx, ack_rx) = mpsc::channel::<SeekAck>();
    let seek_epoch = Arc::new(AtomicU64::new(0));

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();
    let monitor_clone = monitor.clone();
    let seek_epoch_clone = seek_epoch.clone();

    let thread_handle = thread::Builder::new()
      .name("xy-buffered-source".to_string())
      .spawn(move || {
        producer_loop(
          inner,
          cmd_rx,
          sample_tx,
          ack_tx,
          seek_epoch_clone,
          stop_flag_clone,
          monitor_clone,
        );
      })
      .ok();

    let mut source = Self {
      sample_rx,
      cmd_tx,
      ack_rx,
      seek_epoch,
      sample_rate,
      channels,
      total_duration,
      current_block: VecDeque::with_capacity(BLOCK_SAMPLES),
      exhausted: false,
      monitor,
      thread_handle,
      _marker: PhantomData,
    };
    source.prefill_one_block();
    source
  }

  fn prefill_one_block(&mut self) {
    const PREFILL_TIMEOUT: Duration = Duration::from_millis(500);
    match self.sample_rx.recv_timeout(PREFILL_TIMEOUT) {
      Ok(block) => {
        self.set_starvation(false);
        if block.is_empty() {
          self.exhausted = true;
        } else { // 反之
          self.current_block = block.into_iter().collect();
        } // prefill_one_block
      }
      Err(mpsc::RecvTimeoutError::Timeout) => {}
      Err(mpsc::RecvTimeoutError::Disconnected) => {
        self.exhausted = true;
      }
    } // prefill_one_block
  }
} // new_tracked
fn producer_loop( // 生产者主循环
  mut inner: impl Source<Item = f32>,
  cmd_rx: Receiver<Command>,
  sample_tx: SyncSender<Vec<f32>>,
  ack_tx: std::sync::mpsc::Sender<SeekAck>,
  seek_epoch: Arc<AtomicU64>,
  stop_flag: Arc<AtomicBool>,
  monitor: Option<Arc<crate::player::types::BufferedMonitor>>,
) { // 参数表结束
  elevate_thread_priority();
  let mut eof = false;
  loop { // 生产者主循环
    if stop_flag.load(Ordering::Relaxed) {
      return;
    } // 停机检查
    match cmd_rx.try_recv() {
      Ok(Command::Stop) => return,
      Ok(Command::Seek { pos, gen }) => {
        if gen == seek_epoch.load(Ordering::Acquire) {
          let result = inner.try_seek(pos);
          let ack = if result.is_ok() {
            SeekAck::Ok(gen)
          } else { // 反之
            SeekAck::Failed(gen)
          };
          let _ = ack_tx.send(ack);
          eof = false;
        } // producer_loop
        continue;
      }
      Err(mpsc::TryRecvError::Empty) => {}
      Err(mpsc::TryRecvError::Disconnected) => return,
    } // 生产者主循环
    if eof {
      match cmd_rx.recv_timeout(BACKOFF) {
        Ok(Command::Stop) => return,
        Ok(Command::Seek { pos, gen }) => {
          if gen == seek_epoch.load(Ordering::Acquire) {
            let result = inner.try_seek(pos);
            let _ = ack_tx.send(if result.is_ok() {
              SeekAck::Ok(gen)
            } else { // 反之
              SeekAck::Failed(gen)
            }); // 发送定位应答
            eof = false;
          }
        } // 生产者主循环
        Err(mpsc::RecvTimeoutError::Timeout) => {
          if stop_flag.load(Ordering::Relaxed) { // 停机检查
            return; // 退出生产者
          }
        } // producer_loop
        Err(mpsc::RecvTimeoutError::Disconnected) => return,
      }
      continue;
    } // 生产者主循环
    let mut block: Vec<f32> = Vec::with_capacity(BLOCK_SAMPLES);
    for _ in 0..BLOCK_SAMPLES {
      match inner.next() {
        Some(s) => block.push(s),
        None => {
          eof = true;
          break;
        } // producer_loop
      }
    } // 生产者主循环
    if !block.is_empty() {
      loop { // 等待数据就绪
        if stop_flag.load(Ordering::Relaxed) { // 停机检查
          return;
        } // 生产者主循环
        match cmd_rx.try_recv() { // 非阻塞收取命令
          Ok(Command::Stop) => return,
          Ok(Command::Seek { pos, gen }) => {
            if gen == seek_epoch.load(Ordering::Acquire) {
              let result = inner.try_seek(pos);
              let _ = ack_tx.send(if result.is_ok() {
                SeekAck::Ok(gen)
              } else { // 反之
                SeekAck::Failed(gen)
              });
              eof = false;
              break;
            } // producer_loop
          }
          Err(mpsc::TryRecvError::Empty) => {}
          Err(mpsc::TryRecvError::Disconnected) => return,
        } // producer_loop
        match sample_tx.try_send(block) {
          Ok(()) => {
            if let Some(monitor) = &monitor {
              monitor.produced.store(true, Ordering::Relaxed);
            } // producer_loop
            break;
          }
          Err(mpsc::TrySendError::Full(b)) => {
            block = b;
            thread::sleep(BACKOFF);
          }
          Err(mpsc::TrySendError::Disconnected(_)) => return,
        } // producer_loop
      }
    } // 生产者主循环
    if eof {
      return;
    } // producer_loop
  }
} // producer_loop
impl<I> Iterator for BufferedSource<I> // 迭代器
where // 泛型约束
  I: Source<Item = f32> + Send + 'static,
{ // 实现体
  type Item = f32; // 样本类型
  #[inline]
  fn next(&mut self) -> Option<Self::Item> {
    if self.exhausted {
      return None;
    } // next
    if let Some(s) = self.current_block.pop_front() {
      return Some(s);
    } // next
    loop { // 消费循环
      match self.sample_rx.recv_timeout(CONSUMER_WAIT_TIMEOUT) {
        Ok(block) => {
          self.set_starvation(false);
          if block.is_empty() {
            self.exhausted = true;
            return None; // 源已耗尽
          }
          self.current_block = block.into_iter().collect();
          if let Some(s) = self.current_block.pop_front() {
            return Some(s); // 交付样本
          }
        } // next
        Err(mpsc::RecvTimeoutError::Timeout) => {
          self.set_starvation(true);
          return Some(0.0);
        } // next
        Err(mpsc::RecvTimeoutError::Disconnected) => {
          self.exhausted = true;
          self.set_starvation(false);
          return None;
        } // next
      }
    } // next
  }
} // producer_loop
impl<I> Source for BufferedSource<I> // 音频源
where // 泛型约束
  I: Source<Item = f32> + Send + 'static,
{ // 实现体
  #[inline]
  fn channels(&self) -> u16 {
    self.channels
  }

  #[inline]
  fn sample_rate(&self) -> u32 {
    self.sample_rate
  }

  #[inline]
  fn current_frame_len(&self) -> Option<usize> {
    None // 空样本
  }

  #[inline]
  fn total_duration(&self) -> Option<Duration> {
    self.total_duration
  }

  fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
    let gen = self.seek_epoch.fetch_add(1, Ordering::AcqRel) + 1;
    if self.cmd_tx.send(Command::Seek { pos, gen }).is_err() {
      return Err(SeekError::NotSupported {
        underlying_source: "BufferedSource",
      });
    } // try_seek
    let deadline = Instant::now() + Duration::from_secs(2);
    loop { // 定位等待
      let remaining = deadline.saturating_duration_since(Instant::now());
      if remaining.is_zero() {
        self.seek_epoch.fetch_add(1, Ordering::AcqRel);
        return Err(SeekError::NotSupported {
          underlying_source: "BufferedSource",
        });
      }
      match self.ack_rx.recv_timeout(remaining) {
        Ok(SeekAck::Ok(g)) if g == gen => break,
        Ok(SeekAck::Failed(g)) if g == gen => {
          return Err(SeekError::NotSupported {
            underlying_source: "BufferedSource",
          })
        } // try_seek
        Ok(_) => continue,
        Err(mpsc::RecvTimeoutError::Timeout) => {
          self.seek_epoch.fetch_add(1, Ordering::AcqRel);
          return Err(SeekError::NotSupported {
            underlying_source: "BufferedSource",
          });
        } // try_seek
        Err(mpsc::RecvTimeoutError::Disconnected) => {
          return Err(SeekError::NotSupported {
            underlying_source: "BufferedSource",
          });
        } // try_seek
      }
    } // try_seek

    while self.sample_rx.try_recv().is_ok() {}
    self.current_block.clear();
    self.exhausted = false;
    self.prefill_one_block();
    Ok(())
  }
} // producer_loop
impl<I> Drop for BufferedSource<I> { // 资源释放
  fn drop(&mut self) {
    let _ = self.cmd_tx.try_send(Command::Stop);
    if let Some(handle) = self.thread_handle.take() {
      if self.exhausted {
        let _ = handle.join();
      }
    } // drop
  }
} // producer_loop
#[cfg(test)] mod tests {
  use super::*;

  struct SineSource {
    samples: Vec<f32>,
    idx: usize,
    rate: u32,
    ch: u16,
  }

  impl SineSource {
    fn new(rate: u32, ch: u16, secs: f32) -> Self {
      let n = (secs * rate as f32 * ch as f32).round() as usize;
      let samples: Vec<f32> = (0..n)
        .map(|i| {
          let t = i as f32 / (rate * ch as u32) as f32;
          (t * 440.0 * std::f32::consts::TAU).sin() * 0.5
        })
        .collect();
      Self {
        samples,
        idx: 0,
        rate,
        ch,
      }
    } // new
  }
  impl Iterator for SineSource {
    type Item = f32; // 样本类型
    fn next(&mut self) -> Option<f32> {
      if self.idx < self.samples.len() {
        let s = self.samples[self.idx];
        self.idx += 1;
        Some(s)
      } else { // 反之
        None // 索引耗尽
      }
    } // next
  }
  impl Source for SineSource {
    fn channels(&self) -> u16 { // channels
      self.ch
    } // channels
    fn sample_rate(&self) -> u32 { // sample_rate
      self.rate
    } // sample_rate
    fn current_frame_len(&self) -> Option<usize> { // current_frame_len
      None // 空样本
    } // current_frame_len
    fn total_duration(&self) -> Option<Duration> { // total_duration
      Some(Duration::from_secs_f64(
        self.samples.len() as f64 / (self.rate * self.ch as u32) as f64,
      ))
    } // total_duration
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> { // try_seek
      let sample_idx = (pos.as_secs_f64() * self.rate as f64 * self.ch as f64).round() as usize;
      self.idx = sample_idx.min(self.samples.len());
      Ok(())
    } // try_seek
  }

  #[test]
  fn passthrough_preserves_samples() {
    let inner = SineSource::new(44100, 2, 1.0);
    let expected: Vec<f32> = (0..44100 * 2)
      .map(|i| {
        let t = i as f32 / (44100 * 2) as f32;
        (t * 440.0 * std::f32::consts::TAU).sin() * 0.5
      })
      .collect();

    let mut buf = BufferedSource::new(inner);
    let mut out = Vec::with_capacity(expected.len());
    while let Some(s) = buf.next() {
      out.push(s);
      if out.len() >= expected.len() {
        break;
      }
    } // passthrough_preserves_samples
    assert_eq!(out.len(), expected.len(), "样本数应一致");
    for (i, (a, b)) in out.iter().zip(expected.iter()).enumerate() {
      assert!((a - b).abs() < 1e-6, "样本 {} 不匹配: {} vs {}", i, a, b);
    } // passthrough_preserves_samples
  }

  #[test]
  fn reports_metadata() {
    let inner = SineSource::new(48000, 2, 2.0);
    let buf = BufferedSource::new(inner);
    assert_eq!(buf.sample_rate(), 48000);
    assert_eq!(buf.channels(), 2);
    assert_eq!(buf.total_duration(), Some(Duration::from_secs(2)));
  }

  #[test]
  fn eof_returns_none() {
    let inner = SineSource::new(44100, 1, 0.05);
    let expected_samples = 2205;
    let mut buf = BufferedSource::new(inner);
    let mut count = 0;
    while let Some(s) = buf.next() {
      if s != 0.0 {
        count += 1;
      }
      if count > expected_samples + 5000 {
        panic!("EOF 未正确检测，产生过多样本");
      }
    } // eof_returns_none
    assert!(count > 0, "应产生非零样本");
  }

  #[test]
  fn seek_resets_position() {
    let inner = SineSource::new(44100, 2, 2.0);
    let mut buf = BufferedSource::new(inner);

    buf.try_seek(Duration::from_millis(500)).unwrap();
    let mut got = Vec::new();
    for _ in 0..1000 {
      if let Some(s) = buf.next() {
        got.push(s);
      }
    } // seek_resets_position
    let non_zero = got.iter().filter(|&&s| s.abs() > 1e-6).count();
    assert!(non_zero > 0, "seek 后应有有效音频样本");
  }

  #[test]
  fn handles_empty_source() {
    struct Empty;
    impl Iterator for Empty {
      type Item = f32; // 样本类型
      fn next(&mut self) -> Option<f32> {
        None // 空样本
      }
    } // handles_empty_source
    impl Source for Empty {
      fn channels(&self) -> u16 {
        2
      }
      fn sample_rate(&self) -> u32 {
        44100
      }
      fn current_frame_len(&self) -> Option<usize> {
        None // 空样本
      }
      fn total_duration(&self) -> Option<Duration> {
        Some(Duration::ZERO)
      }
      fn try_seek(&mut self, _pos: Duration) -> Result<(), SeekError> {
        Ok(()) // 空实现
      }
    } // handles_empty_source
    let mut buf = BufferedSource::new(Empty);
    let mut none_count = 0;
    for _ in 0..2000 {
      match buf.next() {
        Some(0.0) => {}
        Some(_) => panic!("空源不应产生非零样本"),
        None => {
          none_count += 1;
          break;
        } // handles_empty_source
      }
    } // handles_empty_source
    assert!(none_count > 0, "空源最终应返回 None");
  }
} // producer_loop
