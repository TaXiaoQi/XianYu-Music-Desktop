// 频谱可视化：对播放采样快照施加汉宁窗后做前向 FFT，
// 再按平方律划分的频段聚合峰值。视觉区间与压缩指数为对外行为，冻结不改。

use rustfft::num_complex::{Complex};
use rustfft::{FftPlanner, Fft};
use std::sync::{OnceLock, Arc};

/// 频段下界（Hz）：低于此频率的成分不参与可视化。
const BAND_FLOOR_HZ: f32 = 40.0;
/// 频段上界（Hz）：实际上限还会被奈奎斯特频率压低。
const BAND_CEILING_HZ: f32 = 16_000.0;
/// 命中该点数时复用全局 FFT 计划，避免反复建表的开销。
const PLAN_CACHE_POINTS: usize = 2048;

static CACHED_PLAN: OnceLock<Arc<dyn Fft<f32>>> = OnceLock::new();

/// 取得 points 点的前向 FFT 计划；仅缓存点计划命中时走全局单例。
fn fft_plan_for(points: usize) -> Arc<dyn Fft<f32>> {
  if points != PLAN_CACHE_POINTS {
    let mut planner = FftPlanner::<f32>::new();
    return planner.plan_fft_forward(points);
  }
  CACHED_PLAN
    .get_or_init(|| {
      let mut planner = FftPlanner::<f32>::new();
      planner.plan_fft_forward(PLAN_CACHE_POINTS)
    })
    .clone()
}

/// 汉宁窗权重，表达式顺序保持与历史输出一致。
#[inline]
fn hann_weight(index: usize, window_total: f32) -> f32 {
  let phase = std::f32::consts::TAU * index as f32 / window_total;
  0.5 - 0.5 * phase.cos()
}

/// 单个频段映射出的 bin 区间，左闭右开。
struct BandSpan {
  start: usize,
  stop: usize,
}

/// 把频段边界（平方律分布）换算成 bin 下标。
fn locate_band_span(
  band: usize,
  band_total: usize,
  span_hz: f32,
  frame_len: usize,
  sample_rate: u32,
) -> BandSpan {
  let low_ratio = (band as f32 / band_total as f32).powi(2);
  let high_ratio = ((band + 1) as f32 / band_total as f32).powi(2);
  let low_hz = BAND_FLOOR_HZ + span_hz * low_ratio;
  let high_hz = BAND_FLOOR_HZ + span_hz * high_ratio;
  let start = ((low_hz * frame_len as f32) / sample_rate as f32)
    .floor()
    .max(1.0) as usize;
  let stop = ((high_hz * frame_len as f32) / sample_rate as f32)
    .ceil()
    .max((start + 1) as f32) as usize;
  BandSpan { start, stop }
}

/// 把采样快照转换为一组 0..1 的频段能量值。
pub fn build_frequency_bands(samples: &[f32], sample_rate: u32, band_count: usize) -> Vec<f32> { // build_frequency_bands
  if band_count == 0 {
    return Vec::new();
  }
  if samples.is_empty() || sample_rate == 0 {
    return vec![0.0; band_count];
  }

  let plan = fft_plan_for(samples.len());
  let frame_len_f32 = samples.len() as f32;
  let mut spectrum: Vec<Complex<f32>> = samples
    .iter()
    .enumerate()
    .map(|(index, sample)| {
      let windowed = sample.clamp(-1.0, 1.0) * hann_weight(index, frame_len_f32);
      Complex::new(windowed, 0.0)
    })
    .collect();
  plan.process(&mut spectrum);

  let ceiling = ((sample_rate as f32) * 0.5).min(BAND_CEILING_HZ);
  if ceiling <= BAND_FLOOR_HZ {
    return vec![0.0; band_count];
  }

  // 只取正频率半区；幅值归一化系数固定为 len*0.25。
  let mirror_half = samples.len() / 2;
  let magnitude_scale = samples.len() as f32 * 0.25;
  let span_hz = ceiling - BAND_FLOOR_HZ;

  (0..band_count)
    .map(|band| {
      let span = locate_band_span(band, band_count, span_hz, samples.len(), sample_rate);
      let stop = span.stop.min(mirror_half);
      if span.start >= stop {
        return 0.0;
      }
      let peak = spectrum[span.start..stop]
        .iter()
        .map(|cell| cell.norm() / magnitude_scale)
        .fold(0.0_f32, f32::max);
      peak.powf(0.55).min(1.0)
    })
    .collect()
}

#[cfg(test)] mod tests {
  use super::*;

  /// 生成指定频率与采样率的正弦波序列。
  fn sine_wave(frequency_hz: f32, sample_rate: u32, sample_count: usize) -> Vec<f32> {
    (0..sample_count)
      .map(|index| {
        let phase = index as f32 * frequency_hz * std::f32::consts::TAU / sample_rate as f32;
        phase.sin()
      })
      .collect()
  }

  #[test]
  fn silent_frame_outputs_zero_bands() {
    let bands = build_frequency_bands(&vec![0.0; 2048], 44_100, 32);

    assert_eq!(bands.len(), 32);
    assert!(bands.iter().all(|level| *level == 0.0));
  }

  #[test]
  fn sine_wave_energy_lands_in_expected_band() {
    let sample_rate = 44_100;
    let bands = build_frequency_bands(&sine_wave(440.0, sample_rate, 2048), sample_rate, 32);
    let peak_index = bands
      .iter()
      .enumerate()
      .max_by(|(_, left), (_, right)| left.total_cmp(right))
      .map(|(index, _)| index)
      .unwrap();

    assert!(
      (3..=6).contains(&peak_index),
      "peak_index={peak_index}, bands={bands:?}"
    );
    assert!(bands[peak_index] > 0.35, "peak={}", bands[peak_index]);
  }
}
