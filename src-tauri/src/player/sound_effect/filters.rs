#![allow(dead_code)]

//! 简单滤波器原语：单极点滤波、直流阻断、延迟线与全通。

use std::f32::consts::PI;

// =========================================================================
// =========================================================================

pub struct OnePole {
  pub z1: f32,
  pub a0: f32,
  pub b1: f32,
  pub is_lowpass: bool,
}

impl OnePole {
  pub fn lowpass(cutoff: f32, sample_rate: f32) -> Self {
    let cutoff = cutoff.clamp(10.0, sample_rate * 0.45);
    let b1 = (-2.0 * PI * cutoff / sample_rate).exp();
    Self {
      z1: 0.0,
      a0: 1.0 - b1,
      b1,
      is_lowpass: true,
    }
  }

  pub fn highpass(cutoff: f32, sample_rate: f32) -> Self {
    let cutoff = cutoff.clamp(10.0, sample_rate * 0.45);
    let b1 = (-2.0 * PI * cutoff / sample_rate).exp();
    Self {
      z1: 0.0,
      a0: (1.0 + b1) / 2.0,
      b1,
      is_lowpass: false,
    }
  }

  pub fn set_lowpass(&mut self, cutoff: f32, sample_rate: f32) {
    let cutoff = cutoff.clamp(10.0, sample_rate * 0.45);
    self.b1 = (-2.0 * PI * cutoff / sample_rate).exp();
    self.a0 = 1.0 - self.b1;
    self.is_lowpass = true;
  }

  #[inline]
  pub fn process(&mut self, sample: f32) -> f32 {
    self.z1 = self.a0 * sample + self.b1 * self.z1;
    if self.is_lowpass {
      self.z1
    } else {
      sample - self.z1
    }
  }

  pub fn reset(&mut self) {
    self.z1 = 0.0;
  }
}

// =========================================================================
// =========================================================================

pub struct DcBlocker {
  pub r: f32,
  pub prev_in: f32,
  pub prev_out: f32,
}

impl DcBlocker {
  pub fn new(sample_rate: f32) -> Self {
    let r = 1.0 - (2.0 * PI * 20.0 / sample_rate).min(PI);
    Self {
      r,
      prev_in: 0.0,
      prev_out: 0.0,
    }
  }

  #[inline]
  pub fn process(&mut self, sample: f32) -> f32 {
    let out = sample - self.prev_in + self.r * self.prev_out;
    self.prev_in = sample;
    self.prev_out = out;
    out
  }

  pub fn reset(&mut self) {
    self.prev_in = 0.0;
    self.prev_out = 0.0;
  }
}

// =========================================================================
// =========================================================================

pub struct DelayLine {
  pub buffer: Vec<f32>,
  pub mask: usize,
  pub write_pos: usize,
}

impl DelayLine {
  pub fn new(size: usize) -> Self {
    let size = size.next_power_of_two().max(2);
    Self {
      buffer: vec![0.0; size],
      mask: size - 1,
      write_pos: 0,
    }
  }

  pub fn clear(&mut self) {
    self.buffer.fill(0.0);
    self.write_pos = 0;
  }

  pub fn resize(&mut self, size: usize) {
    let size = size.next_power_of_two().max(2);
    if size != self.buffer.len() {
      self.buffer = vec![0.0; size];
      self.mask = size - 1;
      self.write_pos = 0;
    }
  }

  #[inline]
  pub fn write(&mut self, sample: f32) {
    self.buffer[self.write_pos] = sample;
    self.write_pos = (self.write_pos + 1) & self.mask;
  }

  #[inline]
  pub fn read(&self, delay: f32) -> f32 {
    let delay_pos = self.write_pos as f32 - delay - 1.0;
    let mut idx = delay_pos.floor() as isize;
    let frac = delay_pos - idx as f32;
    let i0 = (idx & self.mask as isize) as usize;
    idx += 1;
    let i1 = (idx & self.mask as isize) as usize;
    let s0 = self.buffer[i0];
    let s1 = self.buffer[i1];
    s0 + (s1 - s0) * frac
  }
}

// =========================================================================
// =========================================================================

pub struct AllPass {
  pub delay: DelayLine,
  pub gain: f32,
}

impl AllPass {
  pub fn new(size: usize, gain: f32) -> Self {
    Self {
      delay: DelayLine::new(size),
      gain,
    }
  }

  pub fn clear(&mut self) {
    self.delay.clear();
  }

  pub fn resize(&mut self, size: usize) {
    self.delay.resize(size);
  }

  #[inline]
  pub fn process_int(&mut self, sample: f32, len: usize) -> f32 {
    let delayed = self.delay.read(len as f32);
    let out = -self.gain * sample + delayed;
    self.delay.write(sample + self.gain * out);
    out
  }
}
