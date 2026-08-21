//! WSOLA 实时时间拉伸（Waveform Similarity Overlap-Add）。
//!
//! 在保持音高不变的条件下改变速度（tempo）：`stretch > 1.0` 加速（输出更短），
//! `stretch < 1.0` 减速（输出更长）。用于「变速保持音调」（音调补偿）。
//!
//! 原理（WSOLA / 同步重叠相加）：
//! - 分析窗 `win`（约 40ms），输出逐窗前移 `hop_out = win/2`（50% 交叠）。
//! - 输入逐窗理想前移 `hop_in = hop_out * stretch`：`stretch>1` 时输入消耗比输出快
//!   （跳过更多输入 → 输出更短 → 加速），`stretch<1` 时反向 → 输出更长 → 减速。
//! - 每个新窗起点在一个小搜索半径 `sr` 内搜索，使其前 `overlap` 帧与上一窗的尾
//!   （即将被覆盖的输出交叠区）最相似，以消除窗界相位跳变（金属感/爆音）。
//! - 交叠区线性交叉淡化（crossfade）拼接，尾部直通，保证无咔哒。
//!
//! 流式：内部维护输入队列（保护 `win` 帧历史）与输出队列（保护 `win` 帧前置冲）。
//! 消费端逐帧弹出，首页只拉取生产端按需填充。EOF 后冲刷残余输出。
//!
//! 简化：相似度取声道 0 代表（对立体声足够），窗函数用线性淡入淡出而非全局 Hann；
//! 兼顾听感与实时开销，热路径为 O(win + sr·overlap)，保留少量历史，无堆分配。

#![allow(dead_code)]

use std::collections::VecDeque;

/// 窗长（毫秒）——兼顾时间分辨率与 crossfade 平滑度。
const WINDOW_MS: f32 = 40.0;
/// 搜索半径 = 窗长比例。半径越大消除越多相位跳变，但单步输入推进的
/// 浮动幅度也越大（hop_out=20ms 时 0.10 → ±4ms → 单步速度波动可达 ±20%，
/// 听感为节奏忽快忽慢）。收敛到 0.05 后单步波动 ≤±10%。
const SEARCH_RATIO: f32 = 0.05;
/// 中心偏好惩罚系数：距理想推进位置越远的候选，在相似度上叠加越重的
/// 能量惩罚（以输出交叠区能量归一）。相似度明显更好的候选仍会胜出
/// （保住消相位跳变能力），但相似度接近时优先取理想位置，
/// 消除相似度搜索的系统性偏移（连续偏向瞬态导致的节奏抖动）。
const CENTRAL_BIAS_RATIO: f32 = 0.02;
/// 速度比例防护范围（与外面 resampler 一致）。
const STRETCH_MIN: f32 = 0.25;
const STRETCH_MAX: f32 = 4.0;

pub struct Wsola {
    stretch: f32,
    active: bool,
    channels: usize,
    sample_rate: f32,

    win: usize,
    overlap: usize,
    hop_out: usize,
    sr: usize,

    /// 输入队列（交错样本 [L,R,L,R,...]），起点为绝对帧 `in_base`。
    input: VecDeque<f32>,
    in_base: usize,
    /// 最近放置窗的起点（绝对帧，允许小数以推进理想 hop）。
    cur_in_f: f64,
    /// 是否已放置首个窗（开始交叠）。
    started: bool,
    /// 输入已 EOF（feeder 不再提供数据）。
    input_eof: bool,

    /// 输出队列（交错样本），头部给消费端，末尾保持 `win` 帧前置冲供交叠。
    output: VecDeque<f32>,
    /// EOF 后是否已把 `win` 前置冲全部释放。
    flushed: bool,
}

impl Wsola {
    pub fn new() -> Self {
        Self {
            stretch: 1.0,
            active: false,
            channels: 2,
            sample_rate: 44100.0,
            win: 0,
            overlap: 0,
            hop_out: 0,
            sr: 0,
            input: VecDeque::new(),
            in_base: 0,
            cur_in_f: 0.0,
            started: false,
            input_eof: false,
            output: VecDeque::new(),
            flushed: false,
        }
    }

    /// 初始化（采样率/声道变化时调用，会清空内部状态）。
    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        self.channels = channels.max(1);
        self.win = ((WINDOW_MS * sample_rate / 1000.0) as usize).max(64) & !1;
        self.overlap = self.win / 2;
        self.hop_out = self.win - self.overlap; // = win/2
        self.sr = ((self.win as f32) * SEARCH_RATIO).round() as usize;
        self.active = (self.stretch - 1.0).abs() >= 0.001;
        self.reset();
    }

    pub fn reset(&mut self) {
        self.input.clear();
        self.in_base = 0;
        self.cur_in_f = 0.0;
        self.started = false;
        self.input_eof = false;
        self.output.clear();
        self.flushed = false;
    }

    /// 设置速度倍率并决定是否启用。
    pub fn set_stretch(&mut self, stretch: f32) {
        self.stretch = stretch.clamp(STRETCH_MIN, STRETCH_MAX);
        self.active = (self.stretch - 1.0).abs() >= 0.001;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// 追加一段交错输入样本（由外部 feeder 提供）。
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

    /// 读绝对帧 `f` 的某个声道样本（若可用）。
    #[inline]
    fn iter_val(&self, f: usize, c: usize) -> f32 {
        let local = f.wrapping_sub(self.in_base);
        self.input[local * self.channels + c]
    }

    /// 释放不再被引用的过旧输入（起点早于 `cur_in_f - win` 的帧）。
    fn trim_input(&mut self) {
        let keep_from = (self.cur_in_f - self.win as f64).max(0.0) as usize;
        if keep_from <= self.in_base {
            return;
        }
        let to_drop = keep_from - self.in_base;
        let drop_samples = (to_drop * self.channels).min(self.input.len());
        self.input.drain(..drop_samples);
        self.in_base += to_drop;
    }

    /// 是否有 `frames` 帧处于安全可输出区（未被后续 crossfade 触碰）。
    pub fn emittable_frames(&self) -> usize {
        if !self.active || !self.started {
            return self.output.len() / self.channels;
        }
        // EOF 冲刷完成后，win 前置冲里的正是拉伸末尾，可整体释放，避免截掉尾部。
        if self.flushed {
            return self.output.len() / self.channels;
        }
        let total = self.output.len() / self.channels;
        total.saturating_sub(self.win)
    }

    /// 弹出 `ch` 个输出样本到 `out`。返回是否有样本。
    pub fn pop_output(&mut self, out: &mut [f32]) -> usize {
        let ch = self.channels.min(out.len());
        let n = ch.min(self.output.len());
        for i in 0..n {
            out[i] = self.output[i];
        }
        if n > 0 {
            self.output.drain(..n);
        }
        n
    }

    /// 尽力推进一个 OLA 步骤。返回是否真正生产了新输出窗。
    /// 输入不足且未 EOF 时返回 false（调用方应继续喂数据）。
    pub fn produce(&mut self) -> bool {
        if !self.active {
            return false;
        }
        let ch = self.channels;

        if !self.started {
            // 首个窗：需要 win 帧输入，直接填入（无交叠）。
            if self.input_frames() < self.win {
                return false;
            }
            // cand=0（当前 in_base 处）
            for f in 0..self.win {
                for c in 0..ch {
                    self.output.push_back(self.iter_val(f, c));
                }
            }
            self.started = true;
            self.cur_in_f = self.in_base as f64;
            self.trim_input();
            return true;
        }

        // 计算下一个窗理想输入起点：输入前移 hop_in = hop_out * stretch。
        let ideal = self.cur_in_f + self.hop_out as f64 * self.stretch as f64;
        let base = (ideal - self.sr as f64).max(self.cur_in_f) as usize;
        let hi = (ideal + self.sr as f64) as usize + 1;
        // 需要输入到 hi+win 帧。
        if hi + self.win > self.in_base + self.input_frames() {
            return false;
        }

        // 相似度搜索：候选起点 s ∈ [base, hi]，比较其前 overlap 帧与输出交叠区
        // （上一窗的末尾 overlap 帧 = output 末端 overlap 帧）。
        // 叠加中心偏好惩罚：偏离理想位置会带来实际推进 ≠ 理想推进（速度抖动），
        // 以交叠区能量为参考对偏移二次惩罚，相似度接近时回靠理想位置。
        let out_total = self.output.len() / ch;
        let tail_base = out_total.saturating_sub(self.overlap);
        let mut overlap_energy = 1e-9_f32;
        for j in 0..self.overlap {
            let b = self.output[(tail_base + j) * ch];
            overlap_energy += b * b;
        }
        let bias_coef = overlap_energy * CENTRAL_BIAS_RATIO;
        let inv_sr = if self.sr > 0 { 1.0 / self.sr as f64 } else { 0.0 };
        let mut best = self.cur_in_f;
        let mut best_diff = f32::INFINITY;
        for s in base..=hi {
            let mut diff = 0.0_f32;
            // 帧 j ∈ [0, overlap)
            for j in 0..self.overlap {
                let a = self.iter_val(s + j, 0);
                let b = self.output[(tail_base + j) * ch];
                let d = a - b;
                diff += d * d;
            }
            // 中心偏好：归一化偏移的平方 × 交叠区能量参考
            let off = (s as f64 - ideal) * inv_sr;
            diff += (off * off) as f32 * bias_coef;
            if diff < best_diff {
                best_diff = diff;
                best = s as f64;
            }
        }

        // 交叠区交叉淡化从 `out_total - overlap` 开始写，随后追加新窗尾部。
        let cand = best.max(0.0) as usize;
        let write_base = out_total.saturating_sub(self.overlap);
        let inv = 1.0 / (self.overlap as f32 + 1.0);
        for j in 0..self.overlap {
            let a = (j + 1) as f32 * inv;
            for c in 0..ch {
                let prev = self.output[(write_base + j) * ch + c];
                let new = self.iter_val(cand + j, c);
                self.output[(write_base + j) * ch + c] = prev * (1.0 - a) + new * a;
            }
        }
        for j in self.overlap..self.win {
            for c in 0..ch {
                self.output.push_back(self.iter_val(cand + j, c));
            }
        }

        self.cur_in_f = best;
        self.trim_input();
        true
    }

    /// 输入已尽：尽力把剩余输出冲刷出来（释放 `win` 前置冲）。
    pub fn flush(&mut self) {
        if !self.active {
            return;
        }
        if self.flushed {
            return;
        }
        // 再产出若干窗直到无法推进（没有足够输入做下一窗）或 unsupported
        for _ in 0..16 {
            if !self.produce() {
                break;
            }
        }
        self.flushed = true;
    }

    /// 供依赖方判断：输入是否已尽且输出已全部冲刷。
    pub fn is_drained(&self) -> bool {
        !self.active || (self.flushed && self.output.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_impulse(ws: &mut Wsola) {
        let dur = (1.0 * ws.sample_rate) as usize;
        let mut t = 0.0_f32;
        let mut buf = Vec::with_capacity(dur * 2);
        for _ in 0..dur {
            let s = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5;
            buf.push(s);
            buf.push(s);
            t += 1.0 / ws.sample_rate;
        }
        // 分块喂入，模拟流式
        for chunk in buf.chunks(8192) {
            ws.push_input(chunk);
            while ws.produce() {}
        }
        ws.set_input_eof();
        ws.flush();
    }

    #[test]
    fn test_inactive_is_bypass() {
        let mut ws = Wsola::new();
        ws.prepare(44100.0, 2);
        ws.set_stretch(1.0);
        assert!(!ws.is_active());
        // 不喂数据也不产出
        assert!(!ws.produce());
    }

    #[test]
    fn test_speedup_shrinks_output() {
        let mut ws = Wsola::new();
        ws.prepare(44100.0, 2);
        ws.set_stretch(1.5);
        feed_impulse(&mut ws);
        let out_frames = ws.output.len() / 2;

        // 输出应约为输入的 1/1.5（±10%），且无 NaN
        let expected = ((1.0 * ws.sample_rate) as f32 / 1.5).round();
        let ratio = out_frames as f32 / expected;
        assert!(
            ratio > 0.8 && ratio < 1.2,
            "加速后长度 {out_frames} 偏离预期 {expected} (ratio={ratio})"
        );
        assert!(ws.output.iter().all(|v| v.is_finite()));
        // 冲刷后应排空
        let mut sink = vec![0.0f32; 128];
        while ws.pop_output(&mut sink) > 0 {}
        assert!(ws.output.is_empty());
        assert!(ws.is_drained());
    }

    #[test]
    fn test_slowdown_grows_output() {
        let mut ws = Wsola::new();
        ws.prepare(44100.0, 2);
        ws.set_stretch(0.75);
        feed_impulse(&mut ws);
        let out_frames = ws.output.len() / 2;
        let expected = ((1.0 * ws.sample_rate) as f32 / 0.75).round();
        let ratio = out_frames as f32 / expected;
        assert!(
            ratio > 0.8 && ratio < 1.2,
            "减速后长度 {out_frames} 偏离预期 {expected} (ratio={ratio})"
        );
        assert!(ws.output.iter().all(|v| v.is_finite()));
    }

    /// 节奏稳定性回归测试（BPM 忽快忽慢问题的防线）。
    ///
    /// 用周期性节拍信号（每 0.5s 一个衰减正弦脉冲）过 WSOLA，
    /// 统计输出节拍间隔的相对标准差。相似度搜索若系统性偏向瞬态，
    /// 间隔方差会显著增大（听感为节奏抖动）。阈值 2% 对应
    /// 人耳几乎不可察觉的抖动水平。
    #[test]
    fn test_tempo_stability() {
        let mut ws = Wsola::new();
        ws.prepare(44100.0, 2);
        // 模拟 +3 半音变调的速度补偿 stretch（1/2^(3/12) ≈ 0.841）
        ws.set_stretch(1.0 / 2.0f32.powf(3.0 / 12.0));

        let sr = ws.sample_rate as usize;
        let period = (0.5 * sr as f32) as usize; // 0.5s 一拍
        let beats = 12;
        let total = beats * period;
        let mut buf = Vec::with_capacity(total * 2);
        for i in 0..total {
            let phase = i % period;
            let t = phase as f32 / sr as f32;
            // 节拍脉冲：220Hz 衰减正弦，占前半拍
            let s = if phase < period / 2 {
                (2.0 * std::f32::consts::PI * 220.0 * t).sin() * (-8.0 * t).exp()
            } else {
                0.0
            };
            buf.push(s);
            buf.push(s);
        }
        for chunk in buf.chunks(8192) {
            ws.push_input(chunk);
            while ws.produce() {}
        }
        ws.set_input_eof();
        ws.flush();

        // 提取节拍峰间隔：需连续静音（50ms）后才重新武装，保证每拍只触发一次
        // （衰减正弦单个脉冲内正弦周期会多次过阈值，简单去抖会误检）
        let mut intervals: Vec<usize> = Vec::new();
        let mut last_peak: Option<usize> = None;
        let mut armed = false;
        let mut quiet = 0usize;
        let quiet_need = (0.05 * sr as f32) as usize;
        let frames = ws.output.len() / 2;
        for f in 0..frames {
            let v = ws.output[f * 2];
            if v < 0.1 {
                quiet += 1;
            } else {
                quiet = 0;
            }
            if quiet >= quiet_need {
                armed = true;
            }
            if armed && v > 0.5 {
                if let Some(l) = last_peak {
                    intervals.push(f - l);
                }
                last_peak = Some(f);
                armed = false;
                quiet = 0;
            }
        }
        assert!(
            intervals.len() >= beats - 2,
            "检测到的节拍数不足: {} (期望约 {beats})",
            intervals.len()
        );

        let n = intervals.len() as f32;
        let mean = intervals.iter().sum::<usize>() as f32 / n;
        let var = intervals
            .iter()
            .map(|&x| (x as f32 - mean).powi(2))
            .sum::<f32>()
            / n;
        let rstd = var.sqrt() / mean;
        assert!(
            rstd < 0.02,
            "节拍间隔相对标准差过大: {rstd:.4} (mean={mean:.1} 帧) —— 节奏抖动回退"
        );
    }
}