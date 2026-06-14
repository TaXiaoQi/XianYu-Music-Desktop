use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use std::sync::{Arc, OnceLock};

const MIN_VISUALIZER_FREQUENCY_HZ: f32 = 40.0;
const MAX_VISUALIZER_FREQUENCY_HZ: f32 = 16_000.0;
const CACHED_FFT_SIZE: usize = 2048;

static FFT_2048: OnceLock<Arc<dyn Fft<f32>>> = OnceLock::new();

fn plan_fft(sample_count: usize) -> Arc<dyn Fft<f32>> {
    if sample_count == CACHED_FFT_SIZE {
        return FFT_2048
            .get_or_init(|| {
                let mut planner = FftPlanner::<f32>::new();
                planner.plan_fft_forward(CACHED_FFT_SIZE)
            })
            .clone();
    }

    let mut planner = FftPlanner::<f32>::new();
    planner.plan_fft_forward(sample_count)
}

pub fn build_frequency_bands(samples: &[f32], sample_rate: u32, band_count: usize) -> Vec<f32> {
    if band_count == 0 {
        return Vec::new();
    }

    if samples.is_empty() || sample_rate == 0 {
        return vec![0.0; band_count];
    }

    let fft = plan_fft(samples.len());
    let sample_len = samples.len() as f32;
    let mut buffer: Vec<Complex<f32>> = samples
        .iter()
        .enumerate()
        .map(|(index, sample)| {
            let window = 0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / sample_len).cos();
            Complex::new(sample.clamp(-1.0, 1.0) * window, 0.0)
        })
        .collect();

    fft.process(&mut buffer);

    let max_frequency = ((sample_rate as f32) * 0.5).min(MAX_VISUALIZER_FREQUENCY_HZ);
    if max_frequency <= MIN_VISUALIZER_FREQUENCY_HZ {
        return vec![0.0; band_count];
    }

    let half_len = samples.len() / 2;
    let magnitude_scale = samples.len() as f32 * 0.25;

    (0..band_count)
        .map(|band| {
            let start_ratio = band as f32 / band_count as f32;
            let end_ratio = (band + 1) as f32 / band_count as f32;
            let start_frequency = MIN_VISUALIZER_FREQUENCY_HZ
                + (max_frequency - MIN_VISUALIZER_FREQUENCY_HZ) * start_ratio.powi(2);
            let end_frequency = MIN_VISUALIZER_FREQUENCY_HZ
                + (max_frequency - MIN_VISUALIZER_FREQUENCY_HZ) * end_ratio.powi(2);
            let start_bin = ((start_frequency * samples.len() as f32) / sample_rate as f32)
                .floor()
                .max(1.0) as usize;
            let end_bin = ((end_frequency * samples.len() as f32) / sample_rate as f32)
                .ceil()
                .max((start_bin + 1) as f32) as usize;
            let capped_end = end_bin.min(half_len);

            if start_bin >= capped_end {
                return 0.0;
            }

            let peak = buffer[start_bin..capped_end]
                .iter()
                .map(|value| value.norm() / magnitude_scale)
                .fold(0.0_f32, f32::max);

            peak.powf(0.55).min(1.0)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_wave(frequency_hz: f32, sample_rate: u32, sample_count: usize) -> Vec<f32> {
        (0..sample_count)
            .map(|index| {
                let phase =
                    index as f32 * frequency_hz * std::f32::consts::TAU / sample_rate as f32;
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
