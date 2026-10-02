//! 音效处理源：包装 rodio Source，按帧应用参数化效果链。

use rodio::{source::SeekError, Source};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::Duration;

use super::dsp;
use super::params::*;
use super::{channel, dynamics, modulation, pitch, reverb, shaper, spatial};

pub struct SoundEffectHandle {
  pub settings: Arc<Mutex<SoundEffectSettings>>,
  pub dirty: AtomicBool,
}

impl SoundEffectHandle {
  pub fn new(settings: SoundEffectSettings) -> Self {
    Self {
      settings: Arc::new(Mutex::new(settings)),
      dirty: AtomicBool::new(false),
    }
  }

  pub fn set_settings(&self, new_settings: SoundEffectSettings) {
    if let Ok(mut s) = self.settings.lock() {
      *s = new_settings;
    }
    self.dirty.store(true, Ordering::Release);
  }
}

// =========================================================================
// =========================================================================

pub struct SoundEffectSource<I> {
  inner: I,
  handle: Arc<SoundEffectHandle>,
  settings: SoundEffectSettings,
  pitch: pitch::PitchRateProcessor,
  channel_rack: channel::ChannelRack,
  shaper_rack: shaper::ShaperRack,
  dynamics_rack: dynamics::DynamicsRack,
  modulation_rack: modulation::ModulationRack,
  reverb_rack: reverb::ReverbRack,
  spatial_rack: spatial::SpatialRack,
  v4a_low: dsp::Biquad,
  v4a_high: dsp::Biquad,
  in_frame: Vec<f32>,
  out_frame: Vec<f32>,
  out_idx: usize,
  channels: u16,
  sample_rate: u32,
  frame_counter: usize,
  prepared: bool,
}

impl<I> SoundEffectSource<I>
where
  I: Source<Item = f32>,
{
  pub fn new(inner: I, handle: Arc<SoundEffectHandle>) -> Self {
    let channels = inner.channels();
    let sample_rate = inner.sample_rate();
    let settings = handle
      .settings
      .lock()
      .map(|s| s.clone())
      .unwrap_or_default();
    handle.dirty.store(false, Ordering::Release);
    let mut src = Self {
      inner,
      handle,
      settings: settings.clone(),
      pitch: pitch::PitchRateProcessor::new(channels, sample_rate),
      channel_rack: channel::ChannelRack::new(),
      shaper_rack: shaper::ShaperRack::new(),
      dynamics_rack: dynamics::DynamicsRack::new(),
      modulation_rack: modulation::ModulationRack::new(),
      reverb_rack: reverb::ReverbRack::new(),
      spatial_rack: spatial::SpatialRack::new(),
      v4a_low: dsp::Biquad::new(2),
      v4a_high: dsp::Biquad::new(2),
      in_frame: Vec::new(),
      out_frame: Vec::new(),
      out_idx: 0,
      channels,
      sample_rate,
      frame_counter: 0,
      prepared: false,
    };
    src.prepare_all();
    src.apply_params(&settings);
    src
  }

  fn prepare_all(&mut self) {
    let sr = self.sample_rate as f32;
    let ch = self.channels as usize;
    self.pitch.prepare(sr, ch);
    self.channel_rack.prepare(sr, ch);
    self.shaper_rack.prepare(sr, ch);
    self.dynamics_rack.prepare(sr, ch);
    self.modulation_rack.prepare(sr, ch);
    self.reverb_rack.prepare(sr, ch);
    self.spatial_rack.prepare(sr, ch);
    self.v4a_low.resize_channels(ch);
    self.v4a_high.resize_channels(ch);
    self.in_frame.resize(ch.max(1), 0.0);
    self.out_frame.resize(ch.max(1), 0.0);
    self.out_idx = self.out_frame.len();
    self.prepared = true;
  }

  fn apply_params(&mut self, s: &SoundEffectSettings) {
    let effective = if s.v4a_enabled {
      let mut e = s.clone();
      e.vocal_removal = false;
      e.bass_boost.enabled = true;
      e.bass_boost.gain = e.bass_boost.gain.max(6.0);
      e.bass_boost.dynamic = true;
      e.dynamic_eq.enabled = true;
      e.stereo_widen.enabled = true;
      e.stereo_widen.amount = e.stereo_widen.amount.max(1.4);
      e.compressor.enabled = true;
      e.compressor.threshold = e.compressor.threshold.min(-20.0);
      e.compressor.ratio = e.compressor.ratio.max(4.0);
      e.compressor.attack = e.compressor.attack.min(3.0);
      e.compressor.release = e.compressor.release.max(100.0);
      e
    } else {
      s.clone()
    };
    self.settings = effective.clone();
    self.pitch.update_params(&effective);
    self.channel_rack.update_params(&effective);
    self.shaper_rack.update_params(&effective);
    self.dynamics_rack.update_params(&effective);
    self.modulation_rack.update_params(&effective);
    self.reverb_rack.update_params(&effective);
    self.spatial_rack.update_params(&effective);
    self.v4a_low.set_passthrough_inline();
    self.v4a_high.set_passthrough_inline();
  }

  fn reset_all(&mut self) {
    self.pitch.reset();
    self.channel_rack.reset();
    self.shaper_rack.reset();
    self.dynamics_rack.reset();
    self.modulation_rack.reset();
    self.reverb_rack.reset();
    self.spatial_rack.reset();
    self.v4a_low.reset();
    self.v4a_high.reset();
    self.out_frame.fill(0.0);
    self.out_idx = 0;
  }

  fn sync_settings(&mut self) {
    self.frame_counter += 1;
    if self.frame_counter < 64 {
      return;
    }
    self.frame_counter = 0;
    if !self.handle.dirty.load(Ordering::Acquire) {
      return;
    }
    let snapshot = match self.handle.settings.try_lock() {
      Ok(s) => {
        self.handle.dirty.store(false, Ordering::Release);
        s.clone()
      }
      Err(_) => return,
    };
    self.settings = snapshot.clone();
    self.apply_params(&snapshot);
  }
}

impl<I> Iterator for SoundEffectSource<I>
where
  I: Source<Item = f32>,
{
  type Item = f32;

  #[inline]
  fn next(&mut self) -> Option<Self::Item> {
    if self.out_idx < self.out_frame.len() {
      let s = self.out_frame[self.out_idx];
      self.out_idx += 1;
      return Some(s);
    }

    let cur_rate = self.inner.sample_rate();
    let cur_ch = self.inner.channels();
    if cur_rate != self.sample_rate || cur_ch != self.channels || !self.prepared {
      self.sample_rate = cur_rate;
      self.channels = cur_ch;
      self.prepare_all();
      let s = self.settings.clone();
      self.apply_params(&s);
    }

    self.sync_settings();

    let hard_bypass = self.settings.should_hard_bypass();
    if hard_bypass {
      let ch = self.channels as usize;
      for i in 0..ch.min(self.out_frame.len()) {
        self.out_frame[i] = self.inner.next()?;
      }
      self.out_idx = 0;

      if self.out_idx < self.out_frame.len() {
        let s = self.out_frame[self.out_idx];
        self.out_idx += 1;
        return Some(s);
      }
      return None;
    }

    if !self.pitch.fill(&mut self.inner, &mut self.in_frame) {
      return None;
    }

    let ch = self.channels;
    let s = &self.settings;
    self.out_frame.copy_from_slice(&self.in_frame);
    self.out_idx = 0;

    self.channel_rack.process(&mut self.out_frame, ch, s);
    self.shaper_rack.process(&mut self.out_frame, ch, s);
    self.dynamics_rack.process(&mut self.out_frame, ch, s);
    self.modulation_rack.process(&mut self.out_frame, ch, s);
    self.reverb_rack.process(&mut self.out_frame, ch, s);
    self.spatial_rack.process(&mut self.out_frame, ch, s);

    let boost_db = (s.audio_boost / 100.0).clamp(0.0, 1.0) * 6.0;
    if boost_db > 0.01 {
      let g = dsp::db_to_gain(boost_db);
      for v in &mut self.out_frame {
        *v = dsp::soft_clip(*v * g);
      }
    }

    if self.out_idx < self.out_frame.len() {
      let s = self.out_frame[self.out_idx];
      self.out_idx += 1;
      Some(s)
    } else {
      None
    }
  }
}

impl<I> Source for SoundEffectSource<I>
where
  I: Source<Item = f32>,
{
  #[inline]
  fn channels(&self) -> u16 {
    self.channels
  }

  #[inline]
  fn sample_rate(&self) -> u32 {
    if self.settings.should_hard_bypass() {
      return self.sample_rate;
    }
    self.pitch.effective_sample_rate(self.sample_rate)
  }

  #[inline]
  fn current_frame_len(&self) -> Option<usize> {
    self.inner.current_frame_len()
  }

  #[inline]
  fn total_duration(&self) -> Option<Duration> {
    self.inner.total_duration()
  }

  #[inline]
  fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
    self.inner.try_seek(pos)?;
    self.reset_all();
    Ok(())
  }
}
