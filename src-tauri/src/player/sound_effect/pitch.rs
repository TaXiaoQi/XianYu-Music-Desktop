use super::phase_vocoder::PhaseVocoder;
use super::SoundEffectSettings;
use rodio::{Source};
use std::collections::{VecDeque};
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

pub struct PitchRateProcessor { // PitchRateProcessor
    channels: usize, // 声道数
    sample_rate: f32, // 采样率
    // ---- 重采样（变调） ----
    ratio: f64, // 重采样比率
    read_pos: f64, // 读取位置
    input_buf: VecDeque<f32>, // 输入缓冲
    active: bool, // 激活状态
    aa_filter: AaBiquad,

    // ---- 纯黑胶变速（sample_rate 调整，样本直通） ----
    sample_rate_mode: bool, // 变速模式
    rate_multiplier: f32, // 速率倍率
    // ---- 相位声码器（变速保持音钳 / 变调速度补偿） ----
    stretcher: PhaseVocoder,

    eof: bool, // 结束标记
} // PitchRateProcessor
impl PitchRateProcessor { // PitchRateProcessor
    pub fn new(channels: u16, sample_rate: u32) -> Self { // new
        let ch = channels as usize; // 声道数换算
        let sr = sample_rate as f32;
        let mut stretcher = PhaseVocoder::new();
        stretcher.prepare(sr, ch);
        Self { // 初始化
            channels: ch.max(1), // 至少单声道
            sample_rate: sr,
            ratio: 1.0, // 直通比率
            read_pos: 0.0, // 起始位置
            input_buf: VecDeque::with_capacity(8192), // 预分配输入缓冲
            active: false, // 默认旁路
            aa_filter: AaBiquad::disabled(ch.max(1)),
            sample_rate_mode: false, // 默认关闭
            rate_multiplier: 1.0, // 一倍速
            stretcher,
            eof: false, // 未结束
        } // new
    } // new
    pub fn prepare(&mut self, sample_rate: f32, channels: usize) { // prepare
        self.sample_rate = sample_rate; // 更新采样率
        self.channels = channels.max(1); // 更新声道数
        self.input_buf.clear(); // 清空缓冲
        self.read_pos = 0.0; // 重置读取位
        self.eof = false; // 清除结束标记
        self.aa_filter = AaBiquad::disabled(self.channels);
        self.stretcher.prepare(sample_rate, self.channels);
    } // prepare
    pub fn reset(&mut self) { // reset
        self.input_buf.clear(); // 清空缓冲
        self.read_pos = 0.0; // 重置读取位
        self.eof = false; // 清除结束标记
        self.aa_filter.reset_state();
        self.stretcher.reset();
    } // reset
    pub fn update_params(&mut self, s: &SoundEffectSettings) { // update_params
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
        if !pitch_changed && !rate_changed {
            self.active = false; // 退出激活
            self.sample_rate_mode = false; // 关闭变速模式
            self.rate_multiplier = 1.0; // 恢复一倍速
            self.ratio = 1.0; // 恢复直通
            if self.aa_filter.enabled {
                self.aa_filter.enabled = false;
                self.aa_filter.cutoff = 0.0;
                self.aa_filter.reset_state();
            }
            self.stretcher.set_stretch(1.0);
            self.stretcher.reset();
            return;
        } // update_params

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
    } // update_params
    pub fn effective_sample_rate(&self, inner_rate: u32) -> u32 { // effective_sample_rate
        if self.sample_rate_mode {
            ((inner_rate as f32) * self.rate_multiplier)
                .round()
                .max(1.0) as u32
        } else { // 反之
            inner_rate // 原样返回
        } // effective_sample_rate
    } // effective_sample_rate
    fn fill_resampled<I: Source<Item = f32>>(&mut self, inner: &mut I, out: &mut [f32]) -> bool {
        let ch = self.channels; // 取声道数
        if !self.active {
            for c in 0..ch.min(out.len()) {
                match inner.next() {
                    Some(s) => out[c] = s,
                    None => {
                        self.eof = true;
                        return false;
                    }
                } // fill_resampled
            } // fill_resampled
            return true; // 继续供给
        } // fill_resampled
        if !self.eof { // 未到流末尾
            self.ensure_input(inner); // 补充输入
        } // fill_resampled
        let need_frames = (self.read_pos as usize) + 4;
        if self.input_buf.len() < need_frames * ch { // 缓冲不足
            if self.eof { // 已到末尾
                let idx = self.read_pos as usize; // 帧下标
                if idx * ch < self.input_buf.len() { // 仍有余量
                    for c in 0..ch.min(out.len()) { // 逐声道复制
                        out[c] = self.input_buf.get(idx * ch + c).copied().unwrap_or(0.0); // 尾部样本直出
                    } // fill_resampled
                    return true;
                }
                for c in 0..ch.min(out.len()) {
                    out[c] = 0.0;
                } // fill_resampled
                return false; // 供给完毕
            } // fill_resampled
            for c in 0..ch.min(out.len()) {
                out[c] = 0.0;
            } // fill_resampled
            return true; // 填零继续
        } // fill_resampled
        let idx = self.read_pos.floor() as usize; // 插值基准帧
        let t = (self.read_pos - idx as f64) as f32;
        let t2 = t * t;
        let t3 = t2 * t;
        for c in 0..ch.min(out.len()) { // 逐声道插值
            let s0 = self.input_buf[idx * ch + c]; // 前帧样本
            let s1 = self.input_buf[(idx + 1) * ch + c]; // 当前帧样本
            let s2 = self.input_buf[(idx + 2) * ch + c];
            let s3 = self.input_buf[(idx + 3) * ch + c];
            out[c] = 0.5
                * ((2.0 * s1)
                    + (-s0 + s2) * t
                    + (2.0 * s0 - 5.0 * s1 + 4.0 * s2 - s3) * t2
                    + (-s0 + 3.0 * s1 - 3.0 * s2 + s3) * t3);
        } // fill_resampled
        self.read_pos += self.ratio; // 推进读取位
        let consumed = self.read_pos.floor() as usize; // 已消费帧数
        if consumed > 0 { // 有消费才清理
            let to_remove = (consumed * ch).min(self.input_buf.len()); // 待丢弃样本
            for _ in 0..to_remove { // 弹出旧样本
                self.input_buf.pop_front(); // 移除队首
            } // fill_resampled
            self.read_pos -= consumed as f64; // 回退余量
        } // fill_resampled
        true // 成功
    } // fill_resampled
    fn ensure_input<I: Source<Item = f32>>(&mut self, inner: &mut I) { // 按需补充输入
        if self.eof { // 已结束
            return; // 直接返回
        } // ensure_input
        let consumption = self.ratio.max(1.0); // 每帧消费量
        let max_per_call = (consumption.ceil() as usize).max(1).min(32); // 单次上限
        let target = (self.read_pos as usize) + 4;
        let ch = self.channels;
        for _ in 0..max_per_call { // 分批补充
            let need_more = self.input_buf.len() < target * ch;
            if !need_more { // 已够用
                break; // 停止补充
            } // ensure_input
            let mut frame_eof = false; // 帧末标记
            for c in 0..ch {
                match inner.next() { // 读取下一样本
                    Some(s) => self.input_buf.push_back(self.aa_filter.tick(c, s)),
                    None => { // 源枯竭
                        frame_eof = true; // 标记帧末
                        self.input_buf.push_back(0.0); // 补静音
                    } // ensure_input
                } // ensure_input
            } // ensure_input
            if frame_eof { // 帧末处理
                self.eof = true; // 标记结束
                for _ in 0..ch * 4 {
                    self.input_buf.push_back(0.0); // 填充静音
                } // ensure_input
                break; // 结束补充
            } // ensure_input
        } // ensure_input
    } // ensure_input

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
} // effective_sample_rate
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
