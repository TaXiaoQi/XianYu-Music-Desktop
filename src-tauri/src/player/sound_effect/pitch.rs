use super::phase_vocoder::PhaseVocoder;
use super::SoundEffectSettings;
use rodio::Source;
use std::collections::VecDeque;

#[derive(Clone)]
struct AaBiquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: Vec<f32>,
    x2: Vec<f32>,
    y1: Vec<f32>,
    y2: Vec<f32>,
    cutoff: f32,
    enabled: bool,
}

impl AaBiquad {
    fn disabled(channels: usize) -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: vec![0.0; channels],
            x2: vec![0.0; channels],
            y1: vec![0.0; channels],
            y2: vec![0.0; channels],
            cutoff: 0.0,
            enabled: false,
        }
    }

    fn set_lowpass(&mut self, sample_rate: f32, fc: f32, channels: usize) {
        if channels != self.x1.len() {
            *self = Self::disabled(channels);
        }
        let fc = fc.clamp(20.0, 0.49 * sample_rate);
        let w0 = std::f32::consts::TAU * fc / sample_rate;
        let cosw = w0.cos();
        let alpha = w0.sin() / (2.0 * std::f32::consts::SQRT_2);
        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 - cosw) * 0.5) / a0;
        self.b1 = (1.0 - cosw) / a0;
        self.b2 = self.b0;
        self.a1 = (-2.0 * cosw) / a0;
        self.a2 = (1.0 - alpha) / a0;
        self.cutoff = fc;
        self.enabled = true;
    }

    fn reset_state(&mut self) {
        self.x1.iter_mut().for_each(|v| *v = 0.0);
        self.x2.iter_mut().for_each(|v| *v = 0.0);
        self.y1.iter_mut().for_each(|v| *v = 0.0);
        self.y2.iter_mut().for_each(|v| *v = 0.0);
    }

    #[inline]
    fn tick(&mut self, c: usize, x: f32) -> f32 {
        if !self.enabled {
            return x;
        }
        let y = self.b0 * x + self.b1 * self.x1[c] + self.b2 * self.x2[c]
            - self.a1 * self.y1[c]
            - self.a2 * self.y2[c];
        self.x2[c] = self.x1[c];
        self.x1[c] = x;
        self.y2[c] = self.y1[c];
        self.y1[c] = y;
        y
    }
}

pub struct PitchRateProcessor {
    channels: usize,
    sample_rate: f32,

    // ---- 重采样（变调） ----
    ratio: f64,
    read_pos: f64,
    input_buf: VecDeque<f32>,
    active: bool,
    aa_filter: AaBiquad,

    // ---- 纯黑胶变速（sample_rate 调整，样本直通） ----
    sample_rate_mode: bool,
    rate_multiplier: f32,

    // ---- 相位声码器（变速保持音钳 / 变调速度补偿） ----
    stretcher: PhaseVocoder,

    eof: bool,
}

impl PitchRateProcessor {
    pub fn new(channels: u16, sample_rate: u32) -> Self {
        let ch = channels as usize;
        let sr = sample_rate as f32;
        let mut stretcher = PhaseVocoder::new();
        stretcher.prepare(sr, ch);
        Self {
            channels: ch.max(1),
            sample_rate: sr,
            ratio: 1.0,
            read_pos: 0.0,
            input_buf: VecDeque::with_capacity(8192),
            active: false,
            aa_filter: AaBiquad::disabled(ch.max(1)),
            sample_rate_mode: false,
            rate_multiplier: 1.0,
            stretcher,
            eof: false,
        }
    }

    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        self.channels = channels.max(1);
        self.input_buf.clear();
        self.read_pos = 0.0;
        self.eof = false;
        self.aa_filter = AaBiquad::disabled(self.channels);
        self.stretcher.prepare(sample_rate, self.channels);
    }

    pub fn reset(&mut self) {
        self.input_buf.clear();
        self.read_pos = 0.0;
        self.eof = false;
        self.aa_filter.reset_state();
        self.stretcher.reset();
    }

    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        let raw_rate = if !s.playback_rate.is_finite() || s.playback_rate <= 0.0 {
            100.0
        } else {
            s.playback_rate
        };
        let raw_pitch = if !s.pitch_shift.is_finite() || s.pitch_shift <= 0.0 {
            100.0
        } else {
            s.pitch_shift
        };
        let t = (raw_rate / 100.0).clamp(0.25, 4.0);
        let p = (raw_pitch / 100.0).clamp(0.25, 4.0);
        let pitch_changed = (p - 1.0).abs() >= 0.001;
        let rate_changed = (t - 1.0).abs() >= 0.001;
        let preserves = s.preserves_pitch;

        // ================================================================
        // ================================================================
        if !pitch_changed && !rate_changed {
            self.active = false;
            self.sample_rate_mode = false;
            self.rate_multiplier = 1.0;
            self.ratio = 1.0;
            if self.aa_filter.enabled {
                self.aa_filter.enabled = false;
                self.aa_filter.cutoff = 0.0;
                self.aa_filter.reset_state();
            }
            self.stretcher.set_stretch(1.0);
            self.stretcher.reset();
            return;
        }

        if !preserves && !pitch_changed {
            self.active = false;
            self.sample_rate_mode = true;
            self.rate_multiplier = t;
            self.ratio = 1.0;
            if self.aa_filter.enabled {
                self.aa_filter.enabled = false;
                self.aa_filter.cutoff = 0.0;
                self.aa_filter.reset_state();
            }
            self.stretcher.set_stretch(1.0);
            self.stretcher.reset();
            return;
        }

        let pitch_eff = if preserves { p } else { p * t };
        let tempo = t;
        let resample_ratio = pitch_eff;
        let stretch_factor = (tempo / pitch_eff).clamp(0.25, 4.0);
        self.ratio = resample_ratio as f64;
        self.active = (resample_ratio - 1.0).abs() >= 0.001;

        if self.active && resample_ratio > 1.05 {
            let want = 0.45 * self.sample_rate / resample_ratio;
            if (self.aa_filter.cutoff - want).abs() > want * 0.05 || !self.aa_filter.enabled {
                self.aa_filter
                    .set_lowpass(self.sample_rate, want, self.channels);
            }
        } else if self.aa_filter.enabled && !self.active {
            self.aa_filter.enabled = false;
            self.aa_filter.cutoff = 0.0;
            self.aa_filter.reset_state();
        }

        self.sample_rate_mode = false;
        self.rate_multiplier = 1.0;
        self.stretcher.set_stretch(stretch_factor);
    }

    pub fn effective_sample_rate(&self, inner_rate: u32) -> u32 {
        if self.sample_rate_mode {
            ((inner_rate as f32) * self.rate_multiplier)
                .round()
                .max(1.0) as u32
        } else {
            inner_rate
        }
    }

    fn fill_resampled<I: Source<Item = f32>>(&mut self, inner: &mut I, out: &mut [f32]) -> bool {
        let ch = self.channels;

        if !self.active {
            for c in 0..ch.min(out.len()) {
                match inner.next() {
                    Some(s) => out[c] = s,
                    None => {
                        self.eof = true;
                        return false;
                    }
                }
            }
            return true;
        }

        if !self.eof {
            self.ensure_input(inner);
        }
        let need_frames = (self.read_pos as usize) + 4;
        if self.input_buf.len() < need_frames * ch {
            if self.eof {
                let idx = self.read_pos as usize;
                if idx * ch < self.input_buf.len() {
                    for c in 0..ch.min(out.len()) {
                        out[c] = self.input_buf.get(idx * ch + c).copied().unwrap_or(0.0);
                    }
                    return true;
                }
                for c in 0..ch.min(out.len()) {
                    out[c] = 0.0;
                }
                return false;
            }
            for c in 0..ch.min(out.len()) {
                out[c] = 0.0;
            }
            return true;
        }

        let idx = self.read_pos.floor() as usize;
        let t = (self.read_pos - idx as f64) as f32;
        let t2 = t * t;
        let t3 = t2 * t;
        for c in 0..ch.min(out.len()) {
            let s0 = self.input_buf[idx * ch + c];
            let s1 = self.input_buf[(idx + 1) * ch + c];
            let s2 = self.input_buf[(idx + 2) * ch + c];
            let s3 = self.input_buf[(idx + 3) * ch + c];
            out[c] = 0.5
                * ((2.0 * s1)
                    + (-s0 + s2) * t
                    + (2.0 * s0 - 5.0 * s1 + 4.0 * s2 - s3) * t2
                    + (-s0 + 3.0 * s1 - 3.0 * s2 + s3) * t3);
        }
        self.read_pos += self.ratio;

        let consumed = self.read_pos.floor() as usize;
        if consumed > 0 {
            let to_remove = (consumed * ch).min(self.input_buf.len());
            for _ in 0..to_remove {
                self.input_buf.pop_front();
            }
            self.read_pos -= consumed as f64;
        }
        true
    }

    fn ensure_input<I: Source<Item = f32>>(&mut self, inner: &mut I) {
        if self.eof {
            return;
        }
        let consumption = self.ratio.max(1.0);
        let max_per_call = (consumption.ceil() as usize).max(1).min(32);
        let target = (self.read_pos as usize) + 4;
        let ch = self.channels;

        for _ in 0..max_per_call {
            let need_more = self.input_buf.len() < target * ch;
            if !need_more {
                break;
            }
            let mut frame_eof = false;
            for c in 0..ch {
                match inner.next() {
                    Some(s) => self.input_buf.push_back(self.aa_filter.tick(c, s)),
                    None => {
                        frame_eof = true;
                        self.input_buf.push_back(0.0);
                    }
                }
            }
            if frame_eof {
                self.eof = true;
                for _ in 0..ch * 4 {
                    self.input_buf.push_back(0.0);
                }
                break;
            }
        }
    }

    pub fn fill<I: Source<Item = f32>>(&mut self, inner: &mut I, out: &mut [f32]) -> bool {
        let ch = self.channels.min(out.len());
        let stretch_active = self.stretcher.is_active();

        if !self.active && !stretch_active && !self.sample_rate_mode {
            return self.fill_resampled(inner, out);
        }

        if self.sample_rate_mode {
            return self.fill_resampled(inner, out);
        }

        if !stretch_active {
            return self.fill_resampled(inner, out);
        }

        loop {
            if self.stretcher.emittable_frames() >= 1 {
                self.stretcher.pop_output(out);
                return true;
            }

            if self.stretcher.produce() {
                continue;
            }

            let mut frame_buf = [0.0f32; 8];
            let got = self.fill_resampled(inner, &mut frame_buf[..ch]);
            if got {
                self.stretcher.push_input(&frame_buf[..ch]);
                continue;
            }

            if !self.stretcher.is_drained() {
                self.stretcher.set_input_eof();
                self.stretcher.flush();
                if self.stretcher.emittable_frames() >= 1 {
                    self.stretcher.pop_output(out);
                    return true;
                }
                return false;
            }
            return false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn test_default_is_passthrough_bypass() {
        let mut proc = PitchRateProcessor::new(2, 44100);
        proc.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.pitch_shift = 100.0;
        s.playback_rate = 100.0;
        s.preserves_pitch = true;
        proc.update_params(&s);
        assert!(!proc.sample_rate_mode);
        assert!(!proc.stretcher.is_active());
        assert_eq!(proc.effective_sample_rate(48000), 48000);
    }

    #[test]
    fn test_chipmunk_rate_is_sample_rate_mode() {
        let mut proc = PitchRateProcessor::new(2, 44100);
        proc.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.pitch_shift = 100.0;
        s.playback_rate = 150.0;
        s.preserves_pitch = false;
        proc.update_params(&s);
        assert!(proc.sample_rate_mode);
        assert!(!proc.stretcher.is_active());
        assert_eq!(proc.effective_sample_rate(44100), 66150);
    }

    #[test]
    fn test_preserve_pitch_rate_uses_wsola() {
        let mut proc = PitchRateProcessor::new(2, 44100);
        proc.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.pitch_shift = 100.0;
        s.playback_rate = 150.0;
        s.preserves_pitch = true;
        proc.update_params(&s);
        assert!(!proc.sample_rate_mode);
        assert!(proc.stretcher.is_active());
        assert_eq!(proc.effective_sample_rate(44100), 44100);
    }

    #[test]
    fn test_pitch_shift_keeps_tempo() {
        let mut proc = PitchRateProcessor::new(2, 44100);
        proc.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.pitch_shift = 80.0;
        s.playback_rate = 100.0;
        s.preserves_pitch = true;
        proc.update_params(&s);
        assert!(proc.active);
        assert!(proc.stretcher.is_active());
        assert_eq!(proc.effective_sample_rate(44100), 44100);
    }

    #[test]
    fn test_no_nan_through_wsola_path() {
        let mut proc = PitchRateProcessor::new(2, 44100);
        let data: Vec<f32> = (0..48000 * 2)
            .map(|i| ((i as f32 / 44100.0) * 440.0 * std::f32::consts::TAU).sin() * 0.5)
            .collect();
        let sink = std::sync::Arc::new(std::sync::Mutex::new(data.clone()));
        let inner = rodio_test_source(sink);
        proc.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.pitch_shift = 100.0;
        s.playback_rate = 130.0;
        s.preserves_pitch = true;
        proc.update_params(&s);

        let mut out = [0.0f32; 2];
        let mut produced = 0usize;
        while proc.fill(&mut inner.clone(), &mut out) && produced < 200_000 {
            assert!(out.iter().all(|v| v.is_finite()), "产生 NaN");
            produced += 1;
        }
        assert!(produced > 1000, "拉伸路径产出过少: {produced}");
    }

    #[test]
    fn test_pitch_shift_semitone_accuracy() {
        let sr = 44100.0_f32;
        let freq = 440.0_f32;
        let semitones = 3.0_f32;
        let expected = freq * 2.0f32.powf(semitones / 12.0);

        let mut data: Vec<f32> = Vec::with_capacity((sr as usize) * 6 * 2);
        for i in 0..(sr as usize) * 6 {
            let s = (freq * (i as f32 / sr) * std::f32::consts::TAU).sin() * 0.5;
            data.push(s);
            data.push(s);
        }
        let sink = std::sync::Arc::new(std::sync::Mutex::new(data));
        let inner = rodio_test_source(sink);

        let mut proc = PitchRateProcessor::new(2, 44100);
        proc.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.pitch_shift = 100.0 * 2.0f32.powf(semitones / 12.0);
        s.playback_rate = 100.0;
        s.preserves_pitch = true;
        proc.update_params(&s);

        let mut out = [0.0f32; 2];
        let mut collected: Vec<f32> = Vec::new();
        let mut src = inner;
        while proc.fill(&mut src, &mut out) && collected.len() < 44100 * 6 {
            collected.push(out[0]);
            collected.push(out[1]);
        }
        assert!(collected.len() > 44100 * 2, "产出过少");

        let measured = measure_freq(&collected, sr);
        let err = (measured - expected).abs() / expected;
        assert!(
            err < 0.01,
            "+3 半音实测 {measured:.2}Hz 偏离期望 {expected:.2}Hz 达 {err:.4}"
        );
    }

    #[test]
    fn test_resampler_only_pitch_accuracy() {
        let sr = 44100.0_f32;
        let freq = 440.0_f32;
        let semitones = 3.0_f32;
        let expected = freq * 2.0f32.powf(semitones / 12.0);

        let mut data: Vec<f32> = Vec::with_capacity((sr as usize) * 6 * 2);
        for i in 0..(sr as usize) * 6 {
            let s = (freq * (i as f32 / sr) * std::f32::consts::TAU).sin() * 0.5;
            data.push(s);
            data.push(s);
        }
        let sink = std::sync::Arc::new(std::sync::Mutex::new(data));
        let inner = rodio_test_source(sink);

        let mut proc = PitchRateProcessor::new(2, 44100);
        proc.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        let p = 100.0 * 2.0f32.powf(semitones / 12.0);
        s.pitch_shift = p;
        s.playback_rate = p;
        s.preserves_pitch = true;
        proc.update_params(&s);
        assert!(!proc.stretcher.is_active(), "隔离条件失效");

        let mut out = [0.0f32; 2];
        let mut collected: Vec<f32> = Vec::new();
        let mut src = inner;
        while proc.fill(&mut src, &mut out) && collected.len() < 44100 * 6 {
            collected.push(out[0]);
            collected.push(out[1]);
        }
        let measured = measure_freq(&collected, sr);
        let err = (measured - expected).abs() / expected;
        assert!(
            err < 0.01,
            "纯重采样 +3 半音实测 {measured:.2}Hz 偏离期望 {expected:.2}Hz 达 {err:.4}"
        );
    }

    fn measure_freq(collected: &[f32], sr: f32) -> f32 {
        let begin = sr as usize;
        let end = (3.0 * sr) as usize;
        let mut crossings = 0usize;
        let mut prev = collected[begin * 2];
        for f in begin + 1..end {
            let v = collected[f * 2];
            if prev <= 0.0 && v > 0.0 {
                crossings += 1;
            }
            prev = v;
        }
        crossings as f32 / 2.0
    }

    #[test]
    fn test_cubic_kernel_pure() {
        let sr = 44100.0_f64;
        let freq = 440.0_f64;
        let ratio = 2.0f64.powf(3.0 / 12.0);
        let n = (sr * 3.0) as usize;
        let src: Vec<f32> = (0..n)
            .map(|i| (freq * i as f64 / sr * std::f64::consts::TAU).sin() as f32 * 0.5)
            .collect();
        let mut out: Vec<f32> = Vec::new();
        let mut pos = 0.0_f64;
        while pos + 3.0 < n as f64 - 1.0 {
            let idx = pos.floor() as usize;
            let t = (pos - idx as f64) as f32;
            let t2 = t * t;
            let t3 = t2 * t;
            let s0 = src[idx];
            let s1 = src[idx + 1];
            let s2 = src[idx + 2];
            let s3 = src[idx + 3];
            let v = 0.5
                * ((2.0 * s1)
                    + (-s0 + s2) * t
                    + (2.0 * s0 - 5.0 * s1 + 4.0 * s2 - s3) * t2
                    + (-s0 + 3.0 * s1 - 3.0 * s2 + s3) * t3);
            out.push(v);
            pos += ratio;
        }
        let begin = (sr as usize).min(out.len() - 1);
        let end = ((2.0 * sr) as usize).min(out.len());
        let mut crossings = 0usize;
        let mut prev = out[begin];
        for i in begin + 1..end {
            if prev <= 0.0 && out[i] > 0.0 {
                crossings += 1;
            }
            prev = out[i];
        }
        let measured = crossings as f32;
        let expected = (freq * ratio) as f32;
        let err = (measured - expected).abs() / expected;
        assert!(err < 0.01, "纯核实测 {measured:.2}Hz 期望 {expected:.2}Hz");
    }

    fn rodio_test_source(data: Arc<Mutex<Vec<f32>>>) -> TestSource {
        TestSource { data, pos: 0 }
    }

    struct TestSource {
        data: Arc<Mutex<Vec<f32>>>,
        pos: usize,
    }
    impl Clone for TestSource {
        fn clone(&self) -> Self {
            TestSource {
                data: self.data.clone(),
                pos: self.pos,
            }
        }
    }
    impl Iterator for TestSource {
        type Item = f32;
        fn next(&mut self) -> Option<f32> {
            let d = self.data.lock().unwrap();
            if self.pos < d.len() {
                let v = d[self.pos];
                self.pos += 1;
                Some(v)
            } else {
                None
            }
        }
    }
    impl rodio::Source for TestSource {
        fn current_frame_len(&self) -> Option<usize> {
            Some(4096)
        }
        fn channels(&self) -> u16 {
            2
        }
        fn sample_rate(&self) -> u32 {
            44100
        }
        fn total_duration(&self) -> Option<std::time::Duration> {
            let d = self.data.lock().unwrap();
            let secs = d.len() as f32 / 44100.0 / 2.0;
            Some(std::time::Duration::from_secs_f32(secs))
        }
    }
    impl std::fmt::Debug for TestSource {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("TestSource").finish()
        }
    }
}
