use core::f32::consts::PI;

pub use super::controls::{EnvelopeFollower, Lfo, SmoothedValue};
pub use super::filters::DelayLine;

// ==========================================================================
// 双二阶滤波器 Biquad（RBJ cookbook 系数）
// ==========================================================================

#[derive(Default, Clone)]
pub(crate) struct BiquadState {
  s1: f32,
  s2: f32,
} // BiquadState

pub(crate) struct Biquad {
  pub b0: f32,
  pub b1: f32,
  pub b2: f32,
  pub a1: f32,
  pub a2: f32,
  pub states: Vec<BiquadState>,
  pub passthrough: bool,
} // Biquad

impl Biquad { // 核心滤波运算
  pub fn new(channels: usize) -> Self {
    Self {
      b0: 1.0,
      b1: 0.0,
      b2: 0.0,
      a1: 0.0,
      a2: 0.0,
      states: vec![BiquadState::default(); channels],
      passthrough: true,
    }
  }

  fn clamp_freq(freq: f32, sample_rate: f32) -> f32 {
    let nyq = sample_rate * 0.5;
    freq.clamp(10.0, nyq * 0.95)
  }

  #[allow(dead_code)]
  pub fn set_peaking(&mut self, freq: f32, sample_rate: f32, gain_db: f32, q: f32) {
    if gain_db.abs() < 0.05 {
      self.set_passthrough();
      return;
    }
    let f = Self::clamp_freq(freq, sample_rate);
    let w0 = 2.0 * PI * f / sample_rate;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let a = 10.0_f32.powf(gain_db / 40.0);
    let alpha = sinw / (2.0 * q);
    let b0 = 1.0 + alpha * a;
    let b1 = -2.0 * cosw;
    let b2 = 1.0 - alpha * a;
    let a0 = 1.0 + alpha / a;
    self.set_coeffs(
      b0 / a0,
      b1 / a0,
      b2 / a0,
      -2.0 * cosw / a0,
      (1.0 - alpha / a) / a0,
    );
  }

  pub fn set_lowpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
    let f = Self::clamp_freq(freq, sample_rate);
    let w0 = 2.0 * PI * f / sample_rate;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let alpha = sinw / (2.0 * q);
    let b0 = (1.0 - cosw) / 2.0;
    let b1 = 1.0 - cosw;
    let b2 = (1.0 - cosw) / 2.0;
    let a0 = 1.0 + alpha;
    self.set_coeffs(
      b0 / a0,
      b1 / a0,
      b2 / a0,
      -2.0 * cosw / a0,
      (1.0 - alpha) / a0,
    );
  }

  pub fn set_highpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
    let f = Self::clamp_freq(freq, sample_rate);
    let w0 = 2.0 * PI * f / sample_rate;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let alpha = sinw / (2.0 * q);
    let b0 = (1.0 + cosw) / 2.0;
    let b1 = -(1.0 + cosw);
    let b2 = (1.0 + cosw) / 2.0;
    let a0 = 1.0 + alpha;
    self.set_coeffs(
      b0 / a0,
      b1 / a0,
      b2 / a0,
      -2.0 * cosw / a0,
      (1.0 - alpha) / a0,
    );
  }

  pub fn set_lowshelf(&mut self, freq: f32, sample_rate: f32, gain_db: f32, q: f32) {
    if gain_db.abs() < 0.05 {
      self.set_passthrough();
      return;
    }
    let f = Self::clamp_freq(freq, sample_rate);
    let w0 = 2.0 * PI * f / sample_rate;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let a = 10.0_f32.powf(gain_db / 40.0);
    let alpha = sinw / (2.0 * q);
    let sq = 2.0 * (a.sqrt()) * alpha;
    let b0 = a * ((a + 1.0) - (a - 1.0) * cosw + sq);
    let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cosw);
    let b2 = a * ((a + 1.0) - (a - 1.0) * cosw - sq);
    let a0 = (a + 1.0) + (a - 1.0) * cosw + sq;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cosw);
    let a2 = (a + 1.0) + (a - 1.0) * cosw - sq;
    self.set_coeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }

  pub fn set_highshelf(&mut self, freq: f32, sample_rate: f32, gain_db: f32, q: f32) {
    if gain_db.abs() < 0.05 {
      self.set_passthrough();
      return;
    }
    let f = Self::clamp_freq(freq, sample_rate);
    let w0 = 2.0 * PI * f / sample_rate;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let a = 10.0_f32.powf(gain_db / 40.0);
    let alpha = sinw / (2.0 * q);
    let sq = 2.0 * (a.sqrt()) * alpha;
    let b0 = a * ((a + 1.0) + (a - 1.0) * cosw + sq);
    let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cosw);
    let b2 = a * ((a + 1.0) + (a - 1.0) * cosw - sq);
    let a0 = (a + 1.0) - (a - 1.0) * cosw + sq;
    let a1 = 2.0 * (a - 1.0) - (a + 1.0) * cosw;
    let a2 = (a + 1.0) - (a - 1.0) * cosw - sq;
    self.set_coeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }

  #[allow(dead_code)]
  pub fn set_notch(&mut self, freq: f32, sample_rate: f32, q: f32) {
    let f = Self::clamp_freq(freq, sample_rate);
    let w0 = 2.0 * PI * f / sample_rate;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let alpha = sinw / (2.0 * q);
    let b0 = 1.0;
    let b1 = -2.0 * cosw;
    let b2 = 1.0;
    let a0 = 1.0 + alpha;
    self.set_coeffs(
      b0 / a0,
      b1 / a0,
      b2 / a0,
      -2.0 * cosw / a0,
      (1.0 - alpha) / a0,
    );
  }

  pub fn set_allpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
    let f = Self::clamp_freq(freq, sample_rate);
    let w0 = 2.0 * PI * f / sample_rate;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let alpha = sinw / (2.0 * q);
    let b0 = 1.0 - alpha;
    let b1 = -2.0 * cosw;
    let b2 = 1.0 + alpha;
    let a0 = 1.0 + alpha;
    self.set_coeffs(
      b0 / a0,
      b1 / a0,
      b2 / a0,
      -2.0 * cosw / a0,
      (1.0 - alpha) / a0,
    );
  }

  fn set_coeffs(&mut self, b0: f32, b1: f32, b2: f32, a1: f32, a2: f32) {
    self.b0 = b0;
    self.b1 = b1;
    self.b2 = b2;
    self.a1 = a1;
    self.a2 = a2;
    self.passthrough = false;
  }

  fn set_passthrough(&mut self) {
    self.b0 = 1.0;
    self.b1 = 0.0;
    self.b2 = 0.0;
    self.a1 = 0.0;
    self.a2 = 0.0;
    self.passthrough = true;
  }

  pub fn resize_channels(&mut self, channels: usize) {
    self.states.resize(channels, BiquadState::default());
  }

  pub fn reset(&mut self) {
    for s in &mut self.states {
      s.s1 = 0.0;
      s.s2 = 0.0;
    }
  }

  #[inline]
  pub fn process(&mut self, sample: f32, ch: usize) -> f32 {
    if self.passthrough {
      return sample;
    }
    if ch >= self.states.len() {
      self.states.resize(ch + 1, BiquadState::default());
    }
    let st = &mut self.states[ch];
    let out = self.b0 * sample + st.s1;
    st.s1 = self.b1 * sample - self.a1 * out + st.s2;
    st.s2 = self.b2 * sample - self.a2 * out;
    if !out.is_finite() {
      st.s1 = 0.0;
      st.s2 = 0.0;
      return sample;
    }
    out
  }
} // impl Biquad

// ==========================================================================
// 工具函数
// ==========================================================================

#[inline(always)]
pub fn db_to_gain(level_db: f32) -> f32 { 10.0_f32.powf(level_db / 20.0) }

#[inline(always)]
pub fn gain_to_db(level: f32) -> f32 { 20.0 * level.max(1e-10).log10() }

#[inline(always)]
pub fn soft_clip(input: f32) -> f32 {
  const THRESHOLD: f32 = 0.95;
  let ax = input.abs();
  if ax <= THRESHOLD {
    input
  } else {
    let excess = ax - THRESHOLD;
    let headroom = 1.0 - THRESHOLD;
    let saturation = headroom * (1.0 - (-excess / headroom).exp());
    input.signum() * (THRESHOLD + saturation).min(1.0)
  }
} // soft_clip


// ---------------------------------------------------------------------------
impl Biquad {
  pub fn set_passthrough_inline(&mut self) {
    self.b0 = 1.0;
    self.b1 = 0.0;
    self.b2 = 0.0;
    self.a1 = 0.0;
    self.a2 = 0.0;
    self.passthrough = true;
  }
} // impl Biquad
#[cfg(test)] mod tests {
  use super::*;
  use super::super::filters::DcBlocker;

  #[test]
  fn test_biquad_passthrough() {
    let mut bq = Biquad::new(1);
    bq.set_peaking(1000.0, 44100.0, 0.0, 1.0);
    assert!(bq.passthrough);
    assert_eq!(bq.process(0.5, 0), 0.5);
  }

  #[test]
  fn test_biquad_lowpass_finite() {
    let mut bq = Biquad::new(1);
    bq.set_lowpass(1000.0, 44100.0, 0.707);
    let mut out = 0.0;
    for _ in 0..1000 {
      out = bq.process(0.5, 0);
    }
    assert!(out.is_finite());
  }

  #[test]
  fn test_delay_line_interp() {
    let mut dl = DelayLine::new(16);
    dl.write(1.0);
    assert!((dl.read(0.0) - 1.0).abs() < 1e-5);
  }

  #[test]
  fn test_dc_blocker() {
    let mut dc = DcBlocker::new(44100.0);
    let mut last = 1.0;
    for _ in 0..5000 {
      last = dc.process(0.8);
    }
    assert!(last.abs() < 0.05, "dc not blocked: {last}");
  }

  #[test]
  fn test_soft_clip_transparent_below_threshold() {
    for x in [0.0f32, 0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 0.94, -0.5, -0.9] {
      let clipped = soft_clip(x);
      assert!(
        (clipped - x).abs() < 1e-6,
        "soft_clip should be transparent for |x| < 0.95, got soft_clip({}) = {}",
        x,
        clipped
      );
    }
  }

  #[test]
  fn test_soft_clip_limits_above_threshold() {
    for x in [0.96f32, 1.0, 1.5, 2.0, 5.0, -1.0, -2.0] {
      let clipped = soft_clip(x);
      assert!(
        clipped.abs() <= 1.0,
        "soft_clip should limit to [-1, 1], got soft_clip({}) = {}",
        x,
        clipped
      );
    }
  }

  #[test]
  fn test_soft_clip_continuous_at_threshold() {
    let below = soft_clip(0.949);
    let at = soft_clip(0.95);
    let above = soft_clip(0.951);
    assert!(
      (below - at).abs() < 0.01,
      "soft_clip should be continuous at threshold: {} vs {}",
      below,
      at
    );
    assert!(
      (at - above).abs() < 0.01,
      "soft_clip should be continuous at threshold: {} vs {}",
      at,
      above
    );
  }
} // tests
