#![allow(dead_code)]

//! 控制率处理器：参数平滑、包络跟随与低频振荡器。

use std::f32::consts::PI;

// =========================================================================
// =========================================================================

pub struct SmoothedValue {
  pub current: f32,
  pub target: f32,
  pub coeff: f32,
}

impl SmoothedValue {
  pub fn new(initial: f32) -> Self {
    Self {
      current: initial,
      target: initial,
      coeff: 0.99,
    }
  }

  pub fn set_time_constant(&mut self, seconds: f32, sample_rate: f32) {
    let seconds = seconds.max(0.0005);
    self.coeff = (-1.0 / (seconds * sample_rate)).exp();
  }

  pub fn set_target(&mut self, target: f32) {
    self.target = target;
  }

  pub fn set_immediate(&mut self, value: f32) {
    self.current = value;
    self.target = value;
  }

  #[inline]
  pub fn tick(&mut self) -> f32 {
    if (self.target - self.current).abs() < 0.0001 {
      self.current = self.target;
    } else {
      self.current = self.current + (self.target - self.current) * (1.0 - self.coeff);
    }
    self.current
  }
}

// =========================================================================
// =========================================================================

pub struct EnvelopeFollower {
  pub envelope: f32,
  pub attack_coeff: f32,
  pub release_coeff: f32,
}

impl EnvelopeFollower {
  pub fn new(attack_ms: f32, release_ms: f32, sample_rate: f32) -> Self {
    let mut ef = Self {
      envelope: 0.0,
      attack_coeff: 0.0,
      release_coeff: 0.0,
    };
    ef.set_times(attack_ms, release_ms, sample_rate);
    ef
  }

  pub fn set_times(&mut self, attack_ms: f32, release_ms: f32, sample_rate: f32) {
    self.attack_coeff = (-1.0 / (attack_ms.max(0.1) * 0.001 * sample_rate)).exp();
    self.release_coeff = (-1.0 / (release_ms.max(0.1) * 0.001 * sample_rate)).exp();
  }

  #[inline]
  pub fn process(&mut self, input: f32) -> f32 {
    let inp = input.abs();
    let c = if inp > self.envelope {
      self.attack_coeff
    } else {
      self.release_coeff
    };
    self.envelope = self.envelope + (inp - self.envelope) * (1.0 - c);
    self.envelope
  }

  pub fn reset(&mut self) {
    self.envelope = 0.0;
  }
}

// =========================================================================
// =========================================================================

pub struct Lfo {
  pub phase: f32,
  pub phase_inc: f32,
}

impl Lfo {
  pub fn new(freq: f32, sample_rate: f32) -> Self {
    Self {
      phase: 0.0,
      phase_inc: (2.0 * PI * freq / sample_rate).min(PI),
    }
  }

  pub fn set_freq(&mut self, freq: f32, sample_rate: f32) {
    self.phase_inc = (2.0 * PI * freq / sample_rate).min(PI);
  }

  #[inline]
  pub fn tick_sine(&mut self) -> f32 {
    let v = self.phase.sin();
    self.phase += self.phase_inc;
    if self.phase >= 2.0 * PI {
      self.phase -= 2.0 * PI;
    }
    v
  }

  #[inline]
  pub fn tick_tri(&mut self) -> f32 {
    let p = self.phase / (2.0 * PI);
    let v = if p < 0.5 {
      4.0 * p - 1.0
    } else {
      3.0 - 4.0 * p
    };
    self.phase += self.phase_inc;
    if self.phase >= 2.0 * PI {
      self.phase -= 2.0 * PI;
    }
    v
  }

  pub fn reset(&mut self) {
    self.phase = 0.0;
  }
}
