//! 变调/变速机架 —— 线性插值重采样 + WSOLA 时间拉伸（独立音高/速度）。
//!
//! 设计目标（相对原「黑胶式变调」的增强）：
//! - **变调**（pitch_shift）：只改音钳、保持速度。由「重采样 + 反向 WSOLA 补偿」实现。
//! - **变速**（playback_rate）：
//!   - `preserves_pitch=true`（音调补偿）：只改速度、保持音钳，由 WSOLA 时间拉伸实现。
//!   - `preserves_pitch=false`（黑胶式）：速度与音钳同步变，走 sample_rate 调整（高效，原机制）。
//!
//! 组合模型：目标 速度倍率 `T`、音钳倍率 `P`，两段级联「重采样(ratio=R) + WSOLA(stretch=S)」：
//! - `R = P`（重采样定音钳），`S = T / P`（WSOLA 稀释重采样带来的速度偏移，使净速度 = T）。
//!   - P = p·(preserves?1:t)（黑胶变速把 t 并入音钳），T = t。
//!   - `R`、`S` 任一为 1 时跳过对应段，减少开销与延迟。
//!
//! 两侧流式：保持跨帧的浮点读取位置 `read_pos` 与 WSOLA 内部窗状态，保证连续性。
//! 按帧（一个完整声道组）处理，保持立体声声道关系。

use super::phase_vocoder::PhaseVocoder;
use super::SoundEffectSettings;
use rodio::Source;
use std::collections::VecDeque;

/// 二阶 Butterworth 低通（RBJ 双二阶，Direct Form I）。
/// 升调重采样前预滤波，防止高于 Nyquist/ratio 的成分（镲片高频）折叠混叠。
#[derive(Clone)]
struct AaBiquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    /// 每声道 x1/x2/y1/y2
    x1: Vec<f32>,
    x2: Vec<f32>,
    y1: Vec<f32>,
    y2: Vec<f32>,
    /// 构建时的截止（0 = 未启用）
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

    /// Butterworth Q=1/√2 低通。fc 单位 Hz。
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

/// 变调/变速处理器（三次 Hermite 重采样 + 相位声码器拉伸）
pub struct PitchRateProcessor {
    channels: usize,
    sample_rate: f32,

    // ---- 重采样（变调） ----
    /// 重采样比率（read_pos 每输出帧推进的输入帧数），ratio>1 → 升调+压缩
    ratio: f64,
    /// 输入缓冲中的浮点读取位置（帧单位）
    read_pos: f64,
    /// 输入缓冲（交错样本 [L, R, L, R, ...]）
    input_buf: VecDeque<f32>,
    /// 是否激活重采样
    active: bool,
    /// 抗混叠预滤波（ratio > 阈值时启用）
    aa_filter: AaBiquad,

    // ---- 纯黑胶变速（sample_rate 调整，样本直通） ----
    /// 是否仅调整 sample_rate（preservesPitch=false 且无变调时）
    sample_rate_mode: bool,
    /// sample_rate 倍率
    rate_multiplier: f32,

    // ---- 相位声码器（变速保持音钳 / 变调速度补偿） ----
    stretcher: PhaseVocoder,

    /// inner 是否已 EOF
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

    /// 同步参数（每 64 帧由音频线程调用）。
    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        // 防御：0/负/NaN 视为 100（原调原速）
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
        let t = (raw_rate / 100.0).clamp(0.25, 4.0); // 变速倍率
        let p = (raw_pitch / 100.0).clamp(0.25, 4.0); // 变调倍率
        let pitch_changed = (p - 1.0).abs() >= 0.001;
        let rate_changed = (t - 1.0).abs() >= 0.001;
        let preserves = s.preserves_pitch;

        // ================================================================
        // 路由：
        // 1) 什么都没改 → 直通
        // 2) 纯黑胶变速（!preserves 且无变调）→ sample_rate 调整（原机制，顺滑高效）
        // 3) 其余（独立变速/变调/组合）→ 重采样 R + 声码器拉伸 S 级联，输出恒为原生采样率
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
            // 纯黑胶变速：样本直通，靠 sample_rate 改变速度与音钳
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

        // 独立变速/变调：
        //   变调倍率 P：preserves 时恒等于 p；黑胶时变速也会连带升调，P = p·t
        //   变速倍率 T = t
        let pitch_eff = if preserves { p } else { p * t };
        let tempo = t;
        let resample_ratio = pitch_eff;
        let stretch_factor = (tempo / pitch_eff).clamp(0.25, 4.0);
        self.ratio = resample_ratio as f64;
        self.active = (resample_ratio - 1.0).abs() >= 0.001;

        // 升调（ratio>1）读取快于 Nyquist 折叠点 → 启用抗混叠预滤波。
        // cutoff 变化超过 5% 才重建系数，避免微调时重置滤波状态。
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

    /// 有效采样率。
    /// - sample_rate_mode（纯黑胶变速）：inner_rate * rate_multiplier
    /// - 独立变速/变调（WSOLA 路径）：恒为 inner_rate（WSOLA 在本机采样率下拉伸/重采样）
    pub fn effective_sample_rate(&self, inner_rate: u32) -> u32 {
        if self.sample_rate_mode {
            ((inner_rate as f32) * self.rate_multiplier)
                .round()
                .max(1.0) as u32
        } else {
            inner_rate
        }
    }

    /// 重采样出一帧（交错样本写入 `out[..ch]`），从 `inner` 拉取并线性插值。
    /// 返回 false 表示已 EOF 且缓冲耗尽。
    fn fill_resampled<I: Source<Item = f32>>(&mut self, inner: &mut I, out: &mut [f32]) -> bool {
        let ch = self.channels;

        if !self.active {
            // 无重采样：直通一帧（供 WSOLA 输入 / 纯黑胶直通）
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

        // 重采样模式：三次 Hermite（Catmull-Rom）插值
        if !self.eof {
            self.ensure_input(inner);
        }
        let need_frames = (self.read_pos as usize) + 4;
        if self.input_buf.len() < need_frames * ch {
            if self.eof {
                // EOF 且缓冲不足：探测是否仍有残余
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
            // 缓冲不足但未 EOF：输出零占位
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
            // Catmull-Rom：输出位于 s1 与 s2 之间
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

    /// 非阻塞增量读取补充输入缓冲。
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

    /// 从 inner 读取并填充一帧（channels 个样本）到 out。
    /// 返回 false 表示 inner 已结束且缓冲已耗尽。
    pub fn fill<I: Source<Item = f32>>(&mut self, inner: &mut I, out: &mut [f32]) -> bool {
        let ch = self.channels.min(out.len());
        let stretch_active = self.stretcher.is_active();

        // 无重采样、无拉伸、非黑胶变速 → 直通
        if !self.active && !stretch_active && !self.sample_rate_mode {
            return self.fill_resampled(inner, out);
        }

        // 纯黑胶变速：样本直通，采样率已调整
        if self.sample_rate_mode {
            return self.fill_resampled(inner, out);
        }

        // 仅重采样激活（stretch 恰为 1，如 rate==pitch 的组合）：
        // 声码器不消费输入，必须直通，否则 fill 循环会无限堆积输入
        if !stretch_active {
            return self.fill_resampled(inner, out);
        }

        // 独立变速/变调（相位声码器路径）：重采样 → 时间拉伸 → 产出
        loop {
            // 1) 尝试直接弹出一帧安全输出
            if self.stretcher.emittable_frames() >= 1 {
                self.stretcher.pop_output(out);
                return true;
            }

            // 2) 推进 STFT 帧
            if self.stretcher.produce() {
                continue;
            }

            // 3) 无进步：喂入一帧重采样输入
            let mut frame_buf = [0.0f32; 8];
            let got = self.fill_resampled(inner, &mut frame_buf[..ch]);
            if got {
                self.stretcher.push_input(&frame_buf[..ch]);
                continue;
            }

            // 4) 输入已尽：冲刷残余输出
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
        // 保持音钳、变速走相位声码器：采样率应保持原生
        assert_eq!(proc.effective_sample_rate(44100), 44100);
    }

    #[test]
    fn test_pitch_shift_keeps_tempo() {
        let mut proc = PitchRateProcessor::new(2, 44100);
        proc.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.pitch_shift = 80.0; // 降调
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
        // 用最小 Source 封装以喂给 fill
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

    /// 半音变调精度测试：+3 半音 = ×2^(3/12)（440Hz → 523.25Hz）。
    /// 覆盖完整链路（重采样 + 相位声码器补偿），在稳态段过零计数测频。
    #[test]
    fn test_pitch_shift_semitone_accuracy() {
        let sr = 44100.0_f32;
        let freq = 440.0_f32;
        let semitones = 3.0_f32;
        let expected = freq * 2.0f32.powf(semitones / 12.0); // ≈ 523.25Hz

        let mut data: Vec<f32> = Vec::with_capacity((sr as usize) * 6 * 2);
        for i in 0..(sr as usize) * 6 {
            let s = (freq * (i as f32 / sr) * std::f32::consts::TAU).sin() * 0.5;
            data.push(s); // L
            data.push(s); // R（交错立体声）
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

    /// 隔离实验：rate == pitch 使 stretch=1，仅重采样路径生效。
    /// 验证三次插值重采样单独的变调精度。
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
        s.playback_rate = p; // stretch = t/p = 1 → 声码器不激活
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

    /// 稳态段（1s~3s）上升过零计数测频。
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

    /// 纯 Catmull-Rom 重采样核（无缓冲管理），验证插值公式本身。
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
        // 稳态段过零测频
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
        let measured = crossings as f32; // 1s 窗口
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