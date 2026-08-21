//! 流式相位声码器（Phase Vocoder）实时时间拉伸 —— 替代 WSOLA 的高质量路径。
//!
//! 为什么换掉 WSOLA：WSOLA 靠时域波形相似度拼接，窗沿处相似度搜索会系统性
//! 偏向瞬态，产生节奏抖动与"金属感/相位含糊"（尤其变调时 stretch 大、听感失真）。
//! 相位声码器在频域按 bins 传播相位，频率精度由 FFT 保证，配合两条关键增强：
//! - **峰值相位锁定**（Laroche & Dolson, 1999）：每个 bin 的相位锁定到其所属
//!   频谱峰，保持峰内各分量的原始相位关系，大幅抑制"相位涣散"（phasiness）。
//! - **瞬态相位重置**：帧能量突增（鼓点冲击）时跳过相位传播、直接取分析相位，
//!   减少打击乐拖影。
//!
//! 语义与 Wsola 完全一致：`stretch > 1` 加速（输出更短），`< 1` 减速（输出更长）。
//! 接口（push_input / produce / emittable_frames / pop_output / flush / is_drained）
//! 与 Wsola 逐一对齐，可无缝替换。
//!
//! 参数：FFT 长度 N=2048（46ms@44.1k，频率分辨率 ~21.5Hz），合成 hop = N/4
//! （75% 交叠，Hann² 恒和 1.5 归一）。分析 hop = Hs·stretch（随 stretch 浮动，
//! 用浮点位置累计、逐帧取整，长期平均 stretch 无偏差）。
//!
//! 立体声：两声道独立传播相位（标准做法；峰/瞬态各自检测，代价小）。

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;
use std::collections::VecDeque;
use std::f64::consts::TAU;
use std::sync::Arc;

/// FFT 长度（帧）。2048 在音乐素材上是频率分辨率/瞬态保真/延迟的良好折中。
const FFT_SIZE: usize = 2048;
/// 合成 hop = FFT_SIZE/4（75% 交叠，Hann 分析×合成窗满足恒和）。
const HOP_OUT: usize = FFT_SIZE / 4;
/// Hann² 恒和（75% 交叠周期 Hann）→ 归一化因子。
const COLA_NORM: f32 = 1.5;
/// 瞬态判定：帧 RMS 超过上一帧的该倍数 → 相位重置帧。
const TRANSIENT_RATIO: f32 = 2.2;
/// stretch 防护范围（与 Wsola/重采样一致）。
const STRETCH_MIN: f32 = 0.25;
const STRETCH_MAX: f32 = 4.0;

/// 主相位包裹到 (-π, π]。
#[inline]
fn princ(x: f64) -> f64 {
    x - TAU * (x / TAU).round()
}

pub struct PhaseVocoder {
    stretch: f32,
    active: bool,
    channels: usize,
    sample_rate: f32,

    n: usize,
    hs: usize,
    ha: f64,
    nbins: usize,
    window: Vec<f32>,
    fft_fwd: Arc<dyn rustfft::Fft<f32>>,
    fft_inv: Arc<dyn rustfft::Fft<f32>>,
    /// 每声道相位状态：[ch][bin]（f64 累计，避免长序列漂移）
    prev_phase: Vec<Vec<f64>>,
    synth_phase: Vec<Vec<f64>>,
    prev_rms: Vec<f32>,

    input: VecDeque<f32>,
    in_base: usize,
    analysis_pos_f: f64,
    started: bool,
    input_eof: bool,

    output: VecDeque<f32>,
    out_base: usize,
    /// 已完成 OLA 标记的绝对帧数（不含）
    marked_abs: usize,
    flushed: bool,
}

impl PhaseVocoder {
    pub fn new() -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft_fwd = planner.plan_fft_forward(FFT_SIZE);
        let fft_inv = planner.plan_fft_inverse(FFT_SIZE);
        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|j| 0.5 * (1.0 - (TAU * j as f64 / FFT_SIZE as f64).cos()) as f32)
            .collect();
        Self {
            stretch: 1.0,
            active: false,
            channels: 2,
            sample_rate: 44100.0,
            n: FFT_SIZE,
            hs: HOP_OUT,
            ha: HOP_OUT as f64,
            nbins: FFT_SIZE / 2 + 1,
            window,
            fft_fwd,
            fft_inv,
            prev_phase: Vec::new(),
            synth_phase: Vec::new(),
            prev_rms: Vec::new(),
            input: VecDeque::new(),
            in_base: 0,
            analysis_pos_f: 0.0,
            started: false,
            input_eof: false,
            output: VecDeque::new(),
            out_base: 0,
            marked_abs: 0,
            flushed: false,
        }
    }

    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        self.channels = channels.max(1);
        self.ha = self.hs as f64 * self.stretch as f64;
        self.prev_phase = vec![vec![0.0; self.nbins]; self.channels];
        self.synth_phase = vec![vec![0.0; self.nbins]; self.channels];
        self.prev_rms = vec![0.0; self.channels];
        self.active = (self.stretch - 1.0).abs() >= 0.001;
        self.reset();
    }

    pub fn reset(&mut self) {
        self.input.clear();
        self.in_base = 0;
        self.analysis_pos_f = 0.0;
        self.started = false;
        self.input_eof = false;
        self.output.clear();
        self.out_base = 0;
        self.marked_abs = 0;
        self.flushed = false;
        for ch in 0..self.channels {
            for v in &mut self.prev_phase[ch] {
                *v = 0.0;
            }
            for v in &mut self.synth_phase[ch] {
                *v = 0.0;
            }
            self.prev_rms[ch] = 0.0;
        }
    }

    pub fn set_stretch(&mut self, stretch: f32) {
        self.stretch = stretch.clamp(STRETCH_MIN, STRETCH_MAX);
        self.ha = self.hs as f64 * self.stretch as f64;
        self.active = (self.stretch - 1.0).abs() >= 0.001;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn push_input(&mut self, samples: &[f32]) {
        if samples.is_empty() || samples.len() % self.channels != 0 {
            return;
        }
        self.input.extend(samples.iter().copied());
    }

    pub fn set_input_eof(&mut self) {
        self.input_eof = true;
    }

    fn input_frames(&self) -> usize {
        self.input.len() / self.channels
    }

    #[inline]
    fn iter_val(&self, f: usize, c: usize) -> f32 {
        let local = f.wrapping_sub(self.in_base);
        self.input[local * self.channels + c]
    }

    /// 释放早于当前分析窗起点的输入。
    fn trim_input(&mut self, keep_from: usize) {
        if keep_from <= self.in_base {
            return;
        }
        let to_drop = keep_from - self.in_base;
        let drop_samples = (to_drop * self.channels).min(self.input.len());
        self.input.drain(..drop_samples);
        self.in_base += to_drop;
    }

    /// 是否有 `frames` 帧处于安全输出区（后续 OLA 不会再触碰）。
    pub fn emittable_frames(&self) -> usize {
        if !self.active {
            return self.output.len() / self.channels;
        }
        if self.flushed {
            return self.output.len() / self.channels;
        }
        let total = self.marked_abs.saturating_sub(self.out_base);
        total.saturating_sub(self.n - self.hs)
    }

    /// 弹出至多 `out.len()` 个样本。返回实际弹出数。
    pub fn pop_output(&mut self, out: &mut [f32]) -> usize {
        let n = out.len().min(self.output.len());
        for i in 0..n {
            out[i] = self.output[i];
        }
        if n > 0 {
            self.output.drain(..n);
            self.out_base += n / self.channels;
        }
        n
    }

    /// 推进一个 STFT 帧。输入不足时返回 false。
    pub fn produce(&mut self) -> bool {
        if !self.active {
            return false;
        }
        let ch = self.channels;
        let n = self.n;

        let start = if self.started {
            self.analysis_pos_f.round() as usize
        } else {
            self.in_base
        };
        if start + n > self.in_base + self.input_frames() {
            return false;
        }

        let ha = self.ha;
        let hs = self.hs as f64;
        let synth_write = self.marked_abs; // 本帧 OLA 起点（绝对帧）

        // 输出队列补零至覆盖 [synth_write, synth_write + n)
        let need_total_frames = synth_write + n;
        let cur_frames = self.out_base + self.output.len() / ch;
        if need_total_frames > cur_frames {
            let extra = (need_total_frames - cur_frames) * ch;
            self.output.extend(std::iter::repeat(0.0).take(extra));
        }

        let scale = 1.0 / (n as f32 * COLA_NORM);

        let mut buf: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); n];
        let mut mags: Vec<f32> = vec![0.0; self.nbins];
        let mut phases: Vec<f64> = vec![0.0; self.nbins];

        for c in 0..ch {
            // ---- 时域取窗 + RMS（瞬态检测） ----
            let mut energy = 0.0_f64;
            for j in 0..n {
                let s = self.iter_val(start + j, c);
                energy += (s * s) as f64;
                buf[j] = Complex::new(s * self.window[j], 0.0);
            }
            let rms = energy.sqrt() as f32;

            // ---- 正变换 ----
            self.fft_fwd.process(&mut buf);

            for k in 0..self.nbins {
                let (m, p) = (buf[k].norm(), buf[k].arg() as f64);
                mags[k] = m;
                phases[k] = p;
            }

            let first = !self.started;
            let transient = !first
                && self.prev_rms[c] > 1e-6
                && rms > self.prev_rms[c] * TRANSIENT_RATIO;
            self.prev_rms[c] = rms;

            if first || transient {
                // 首帧 / 瞬态帧：直接采用分析相位（identity lock）
                self.synth_phase[c][..self.nbins].copy_from_slice(&phases);
            } else {
                // ---- 相位传播：ψt[k] = ψ(t-1)[k] + ω[k]·hs + Δφ·(hs/ha) ----
                let ratio_hop = hs / ha;
                for k in 0..self.nbins {
                    let omega_ha = TAU * k as f64 / n as f64 * ha;
                    let dp = princ(phases[k] - self.prev_phase[c][k] - omega_ha);
                    self.synth_phase[c][k] += omega_ha * (hs / ha) + dp * ratio_hop;
                }

                // ---- 峰值相位锁定（Laroche & Dolson）----
                // 1) 找局部极大峰
                let mut peaks: Vec<usize> = Vec::new();
                for k in 1..self.nbins - 1 {
                    if mags[k] > mags[k - 1] && mags[k] >= mags[k + 1] {
                        peaks.push(k);
                    }
                }
                if !peaks.is_empty() {
                    // 2) 相邻峰之间以幅度谷底划分区域
                    let mut region_ends: Vec<usize> = Vec::with_capacity(peaks.len());
                    for w in 0..peaks.len() - 1 {
                        let (a, b) = (peaks[w], peaks[w + 1]);
                        let mut valley = a;
                        let mut vmin = f32::INFINITY;
                        for k in a..=b {
                            if mags[k] < vmin {
                                vmin = mags[k];
                                valley = k;
                            }
                        }
                        region_ends.push(valley);
                    }
                    region_ends.push(self.nbins - 1);

                    // 3) 区域内 bins 锁定到峰：ψ[b] = ψ[p] + princ(φ[b] − φ[p])
                    let mut lo = 0usize;
                    for (w, &p) in peaks.iter().enumerate() {
                        let hi = region_ends[w];
                        for b in lo..=hi {
                            self.synth_phase[c][b] = self.synth_phase[c][p]
                                + princ(phases[b] - phases[p]);
                        }
                        lo = hi + 1;
                    }
                }
            }

            self.prev_phase[c][..self.nbins].copy_from_slice(&phases);

            // ---- 重建谱（共轭对称）+ 逆变换 ----
            for k in 0..self.nbins {
                let mag = mags[k];
                let ph = self.synth_phase[c][k] as f32;
                buf[k] = Complex::new(mag * ph.cos(), mag * ph.sin());
            }
            for k in self.nbins..n {
                let m = n - k;
                buf[k] = buf[m].conj();
            }
            self.fft_inv.process(&mut buf);

            // ---- 加合成窗 OLA ----
            for j in 0..n {
                let frame = synth_write + j;
                let local = frame - self.out_base;
                let idx = local * ch + c;
                if idx < self.output.len() {
                    self.output[idx] += buf[j].re * self.window[j] * scale;
                }
            }
        }

        self.marked_abs = synth_write + self.hs;
        self.analysis_pos_f = start as f64 + ha;
        self.started = true;
        self.trim_input(start);
        true
    }

    /// 输入已尽：产出剩余可产出的帧并释放输出保护。
    pub fn flush(&mut self) {
        if !self.active || self.flushed {
            return;
        }
        for _ in 0..64 {
            if !self.produce() {
                break;
            }
        }
        self.flushed = true;
    }

    pub fn is_drained(&self) -> bool {
        !self.active || (self.flushed && self.output.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(ws: &mut PhaseVocoder) {
        let dur = (1.0 * ws.sample_rate) as usize;
        let mut t = 0.0_f32;
        let mut buf = Vec::with_capacity(dur * 2);
        for _ in 0..dur {
            let s = (TAU as f32 * 440.0 * t).sin() * 0.5;
            buf.push(s);
            buf.push(s);
            t += 1.0 / ws.sample_rate;
        }
        for chunk in buf.chunks(8192) {
            ws.push_input(chunk);
            while ws.produce() {}
        }
        ws.set_input_eof();
        ws.flush();
    }

    #[test]
    fn test_inactive_is_bypass() {
        let mut pv = PhaseVocoder::new();
        pv.prepare(44100.0, 2);
        pv.set_stretch(1.0);
        assert!(!pv.is_active());
        assert!(!pv.produce());
    }

    #[test]
    fn test_speedup_shrinks_output() {
        let mut pv = PhaseVocoder::new();
        pv.prepare(44100.0, 2);
        pv.set_stretch(1.5);
        feed(&mut pv);
        let out_frames = pv.output.len() / 2;
        let expected = (44100.0_f32 / 1.5).round();
        let ratio = out_frames as f32 / expected;
        assert!(
            ratio > 0.9 && ratio < 1.1,
            "加速后长度 {out_frames} 偏离预期 {expected} (ratio={ratio})"
        );
        assert!(pv.output.iter().all(|v| v.is_finite()));
        let mut sink = vec![0.0f32; 128];
        while pv.pop_output(&mut sink) > 0 {}
        assert!(pv.is_drained());
    }

    #[test]
    fn test_slowdown_grows_output() {
        let mut pv = PhaseVocoder::new();
        pv.prepare(44100.0, 2);
        pv.set_stretch(0.75);
        feed(&mut pv);
        let out_frames = pv.output.len() / 2;
        let expected = (44100.0_f32 / 0.75).round();
        let ratio = out_frames as f32 / expected;
        assert!(
            ratio > 0.9 && ratio < 1.1,
            "减速后长度 {out_frames} 偏离预期 {expected} (ratio={ratio})"
        );
        assert!(pv.output.iter().all(|v| v.is_finite()));
    }

    /// 频率保持精度：时间拉伸后的正弦应保持原频率（±0.5%）。
    /// 相位声码器相对 WSOLA 的核心优势：频率由相位传播精确锁定。
    #[test]
    fn test_tone_frequency_accuracy() {
        let mut pv = PhaseVocoder::new();
        pv.prepare(44100.0, 2);
        // +3 半音变调的补偿 stretch
        pv.set_stretch(1.0 / 2.0f32.powf(3.0 / 12.0));
        feed(&mut pv);

        let sr = 44100.0_f32;
        let frames = pv.output.len() / 2;
        // 跳过开头 0.3s（含 OLA 建立过程），对后半段做过零计数
        let begin = (0.3 * sr) as usize;
        let mut crossings = 0usize;
        let mut prev = pv.output[begin * 2];
        for f in begin + 1..frames {
            let v = pv.output[f * 2];
            if prev <= 0.0 && v > 0.0 {
                crossings += 1;
            }
            prev = v;
        }
        let secs = (frames - begin) as f32 / sr;
        let freq = crossings as f32 / secs;
        assert!(
            (freq - 440.0).abs() < 440.0 * 0.005,
            "拉伸后频率 {freq:.2}Hz 偏离 440Hz 超过 0.5%"
        );
    }
}
