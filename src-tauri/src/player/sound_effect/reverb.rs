//! 混响机架 —— 双引擎架构：Freeverb（算法混响）+ FFT 卷积混响（IR 混响）。
//!
//! 架构（2026-08-17 升级版）：
//! - **算法混响**（ReverbKind::Algorithmic）：纯 Freeverb（8 梳状 + 4 全通），逐样本处理
//! - **卷积混响**（ReverbKind::Convolution）：FFT overlap-add 分块卷积，加载真实 IR WAV 文件
//! - **无混响**（ReverbKind::None）：bypass
//!
//! 卷积混响特性：
//! - 块大小 B=2048，FFT 大小 N=4096，延迟 ~93ms（对混响可接受）
//! - 13 个卷积预设对应 13 个真实 IR 文件（编译时嵌入）
//! - 支持 1/2/4 声道 WAV 降混、采样率重采样、峰值归一化
//! - IR 频域分块预计算，热路径零分配
//!
//! 性能：Freeverb 路径零分配；卷积路径每 B 个样本一次 FFT 卷积，热路径零分配。

#![allow(dead_code)]

use super::convolution::ConvolutionReverb;
use super::dsp::{soft_clip, SmoothedValue};
use super::{ReverbKind, SoundEffectSettings};

// =========================================================================
// Freeverb 常量（标准 Dreampoint/STK 调谐）
// =========================================================================

const FIXED_GAIN: f32 = 0.04;
const WET_BOOST: f32 = 1.0;
const ER_GAIN: f32 = 0.0; // 禁用早期反射——消除回声感
const SCALE_ROOM: f32 = 0.28;
const OFFSET_ROOM: f32 = 0.7;
const ROOM_EXTEND_SLOPE: f32 = 0.015;
const FEEDBACK_MAX: f32 = 0.92; // 降低反馈上限，防止过长尾音
const SCALE_DAMP: f32 = 0.55; // 提高阻尼系数，更暖
const ALLPASS_FEEDBACK: f32 = 0.5;
const LIMITER_CEILING: f32 = 0.95;
// 房间尺度上限（= 山谷预设）。用于为 Freeverb 延迟线预分配容量，使预设切换
// 时按房间尺度缩放延迟线长度（真正的"空间大小"听感来源）而不触发热路径分配。
const MAX_ROOM_SCALE: f32 = 2.3;

const COMB_L: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const COMB_R: [usize; 8] = [1139, 1211, 1300, 1379, 1445, 1514, 1580, 1640];
const ALLPASS_L: [usize; 4] = [556, 441, 341, 225];
const ALLPASS_R: [usize; 4] = [579, 464, 364, 248];

const ER_DELAYS_MS: [f32; 6] = [11.0, 19.0, 29.0, 37.0, 47.0, 61.0];
const ER_GAINS: [f32; 6] = [0.65, 0.52, 0.45, 0.38, 0.32, 0.25];

// =========================================================================
// 梳状滤波器（低通反馈，Freeverb 核心）
// =========================================================================

struct Comb {
    buffer: Vec<f32>, // 容量（按 MAX_ROOM_SCALE 预先分配），热路径经 self.len 回绕
    idx: usize,
    len: usize, // 当前生效长度（≥1，随预设房间尺度变化）
    feedback: f32,
    filter_store: f32,
    damp1: f32,
    damp2: f32,
}

impl Comb {
    fn with_capacity(cap: usize) -> Self {
        Self {
            buffer: vec![0.0; cap.max(1)],
            idx: 0,
            len: cap.max(1),
            feedback: 0.5,
            filter_store: 0.0,
            damp1: 0.5,
            damp2: 0.5,
        }
    }

    /// 切换到新的生效长度（≤容量）。长度变化时清空缓冲，避免旧内容经周期回绕混叠。
    fn set_len(&mut self, new_len: usize) {
        let new_len = new_len.max(1).min(self.buffer.len());
        if new_len != self.len {
            self.buffer.fill(0.0);
            self.idx = 0;
            self.filter_store = 0.0;
            self.len = new_len;
        }
    }

    fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.idx = 0;
        self.filter_store = 0.0;
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.idx];
        self.filter_store = output * self.damp2 + self.filter_store * self.damp1;
        self.buffer[self.idx] = input + self.filter_store * self.feedback;
        self.idx = if self.idx + 1 >= self.len {
            0
        } else {
            self.idx + 1
        };
        output
    }
}

// =========================================================================
// 全通滤波器（Schroeder）
// =========================================================================

struct Allpass {
    buffer: Vec<f32>, // 容量（按 MAX_ROOM_SCALE 预先分配），热路径经 self.len 回绕
    idx: usize,
    len: usize, // 当前生效长度（≥1，随预设房间尺度变化）
    feedback: f32,
}

impl Allpass {
    fn with_capacity(cap: usize) -> Self {
        Self {
            buffer: vec![0.0; cap.max(1)],
            idx: 0,
            len: cap.max(1),
            feedback: ALLPASS_FEEDBACK,
        }
    }

    fn set_len(&mut self, new_len: usize) {
        let new_len = new_len.max(1).min(self.buffer.len());
        if new_len != self.len {
            self.buffer.fill(0.0);
            self.idx = 0;
            self.len = new_len;
        }
    }

    fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.idx = 0;
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let bufout = self.buffer[self.idx];
        let output = -input + bufout;
        self.buffer[self.idx] = input + bufout * self.feedback;
        self.idx = if self.idx + 1 >= self.len {
            0
        } else {
            self.idx + 1
        };
        output
    }
}

// =========================================================================
// 早期反射（6 抽头多抽头延迟）
// =========================================================================

struct EarlyReflections {
    delays: [Vec<f32>; 6],
    indices: [usize; 6],
    gains: [f32; 6],
}

impl EarlyReflections {
    fn new(sample_rate: f32) -> Self {
        let sr = sample_rate;
        let delays = std::array::from_fn(|i| {
            let len = ((ER_DELAYS_MS[i] * sr / 1000.0).round() as usize).max(1);
            vec![0.0; len]
        });
        Self {
            delays,
            indices: [0; 6],
            gains: ER_GAINS,
        }
    }

    fn clear(&mut self) {
        for d in &mut self.delays {
            d.fill(0.0);
        }
        self.indices = [0; 6];
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let mut sum = 0.0_f32;
        for i in 0..6 {
            let out = self.delays[i][self.indices[i]];
            self.delays[i][self.indices[i]] = input;
            self.indices[i] = if self.indices[i] + 1 >= self.delays[i].len() {
                0
            } else {
                self.indices[i] + 1
            };
            sum += out * self.gains[i];
        }
        sum
    }
}

// =========================================================================
// 延迟线构建：按采样率缩放基础长度，并按 MAX_ROOM_SCALE 预留容量（一次性分配）
// =========================================================================

fn build_combs(bases: [usize; 8], sample_rate: f32) -> [Comb; 8] {
    let cap = |b: usize| -> usize {
        (((b as f32 * sample_rate / 44100.0) * MAX_ROOM_SCALE).round() as usize).max(1)
    };
    let base = |b: usize| -> usize {
        ((b as f32 * sample_rate / 44100.0).round() as usize).max(1)
    };
    let mut arr: [Comb; 8] = std::array::from_fn(|i| Comb::with_capacity(cap(bases[i])));
    for (i, c) in arr.iter_mut().enumerate() {
        c.set_len(base(bases[i]));
    }
    arr
}

fn build_allpasses(bases: [usize; 4], sample_rate: f32) -> [Allpass; 4] {
    let cap = |b: usize| -> usize {
        (((b as f32 * sample_rate / 44100.0) * MAX_ROOM_SCALE).round() as usize).max(1)
    };
    let base = |b: usize| -> usize {
        ((b as f32 * sample_rate / 44100.0).round() as usize).max(1)
    };
    let mut arr: [Allpass; 4] = std::array::from_fn(|i| Allpass::with_capacity(cap(bases[i])));
    for (i, a) in arr.iter_mut().enumerate() {
        a.set_len(base(bases[i]));
    }
    arr
}

// =========================================================================
// ReverbRack（双引擎混响机架）
// =========================================================================

pub struct ReverbRack {
    sample_rate: f32,
    channels: usize,
    enabled: SmoothedValue,

    // --- FFT 卷积混响引擎（ReverbKind::Convolution 时使用）---
    convolution: ConvolutionReverb,

    // --- Freeverb 路径（ReverbKind::Algorithmic 时使用）---
    combs_l: [Comb; 8],
    combs_r: [Comb; 8],
    allpass_l: [Allpass; 4],
    allpass_r: [Allpass; 4],
    early_l: EarlyReflections,
    early_r: EarlyReflections,

    // --- 公共参数 ---
    cur_preset: String,
    cur_kind: ReverbKind,
    room_size: f32,
    damping: f32,
    width: f32,
    input_gain: f32,
    room_scale: f32,
    limiter_gain: f32,
}

impl ReverbRack {
    pub fn new() -> Self {
        Self {
            sample_rate: 44100.0,
            channels: 2,
            enabled: SmoothedValue::new(0.0),
            convolution: ConvolutionReverb::new(),
            combs_l: build_combs(COMB_L, 44100.0),
            combs_r: build_combs(COMB_R, 44100.0),
            allpass_l: build_allpasses(ALLPASS_L, 44100.0),
            allpass_r: build_allpasses(ALLPASS_R, 44100.0),
            early_l: EarlyReflections::new(44100.0),
            early_r: EarlyReflections::new(44100.0),
            cur_preset: String::new(),
            cur_kind: ReverbKind::None,
            room_size: 0.5,
            damping: 0.5,
            width: 1.0,
            input_gain: 1.0,
            room_scale: 1.0,
            limiter_gain: 1.0,
        }
    }

    /// 按采样率/声道初始化延迟线（一次性分配，热路径零分配）。
    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        self.channels = channels;
        self.enabled.set_time_constant(0.05, sample_rate);
        self.convolution.prepare(sample_rate);
        self.combs_l = build_combs(COMB_L, sample_rate);
        self.combs_r = build_combs(COMB_R, sample_rate);
        self.allpass_l = build_allpasses(ALLPASS_L, sample_rate);
        self.allpass_r = build_allpasses(ALLPASS_R, sample_rate);
        self.early_l = EarlyReflections::new(sample_rate);
        self.early_r = EarlyReflections::new(sample_rate);
        // 重置变更检测
        self.cur_kind = ReverbKind::None;
        self.cur_preset.clear();
        self.room_scale = 1.0;
        self.limiter_gain = 1.0;
    }

    pub fn reset(&mut self) {
        self.convolution.reset();
        for c in &mut self.combs_l {
            c.clear();
        }
        for c in &mut self.combs_r {
            c.clear();
        }
        for a in &mut self.allpass_l {
            a.clear();
        }
        for a in &mut self.allpass_r {
            a.clear();
        }
        self.early_l.clear();
        self.early_r.clear();
        self.limiter_gain = 1.0;
    }

    /// 同步参数（每 64 帧由音频线程调用）。
    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        let active = s.reverb_kind != ReverbKind::None && !s.reverb_preset.is_empty();
        self.enabled.set_target(if active { 1.0 } else { 0.0 });

        // 卷积混响：加载对应 IR 文件
        if s.reverb_kind == ReverbKind::Convolution && !s.reverb_preset.is_empty() {
            self.convolution.load_preset(&s.reverb_preset);
        }

        let (room, damp, width, gain, scale) = preset_params(&s.reverb_preset);

        if s.reverb_kind != self.cur_kind
            || s.reverb_preset != self.cur_preset
            || room != self.room_size
            || damp != self.damping
            || width != self.width
            || gain != self.input_gain
            || scale != self.room_scale
        {
            self.cur_kind = s.reverb_kind.clone();
            self.cur_preset = s.reverb_preset.clone();
            self.room_size = room;
            self.damping = damp;
            self.width = width;
            self.input_gain = gain;
            self.room_scale = scale;

            // 按房间尺度缩放延迟线长度：这是"空间大小/回声间隔"听感的真正来源，
            // 让不同算法预设拥有不同的房间几何。set_len 在长度未变时是空操作。
            let want_len = |base: usize| -> usize {
                (((base as f32 * self.sample_rate / 44100.0) * scale).round() as usize).max(1)
            };
            for (i, c) in self.combs_l.iter_mut().enumerate() {
                c.set_len(want_len(COMB_L[i]));
            }
            for (i, c) in self.combs_r.iter_mut().enumerate() {
                c.set_len(want_len(COMB_R[i]));
            }
            for (i, a) in self.allpass_l.iter_mut().enumerate() {
                a.set_len(want_len(ALLPASS_L[i]));
            }
            for (i, a) in self.allpass_r.iter_mut().enumerate() {
                a.set_len(want_len(ALLPASS_R[i]));
            }

            // Freeverb comb 系数更新
            let fb = feedback_from_room(room);
            let damp1 = damp * SCALE_DAMP;
            let damp2 = 1.0 - damp1;
            for c in &mut self.combs_l {
                c.feedback = fb;
                c.damp1 = damp1;
                c.damp2 = damp2;
            }
            for c in &mut self.combs_r {
                c.feedback = fb;
                c.damp1 = damp1;
                c.damp2 = damp2;
            }
        }
    }

    /// 处理一帧（frame[0]=L, frame[1]=R），原地修改。
    ///
    /// 双引擎架构：
    /// - ReverbKind::Convolution → FFT 卷积混响（真实 IR）
    /// - ReverbKind::Algorithmic → Freeverb（8 梳状 + 4 全通）
    pub fn process(&mut self, frame: &mut [f32], channels: u16, s: &SoundEffectSettings) {
        if channels != 2 || frame.len() < 2 {
            return;
        }
        let w = self.enabled.tick();
        if w < 0.001 {
            return;
        }

        let in_l = frame[0];
        let in_r = frame[1];

        // 选择混响引擎：卷积混响优先，算法混响回退
        let (wet_l, wet_r) =
            if s.reverb_kind == ReverbKind::Convolution && self.convolution.is_loaded() {
                self.convolution.process(in_l, in_r)
            } else {
                self.process_freeverb(in_l, in_r)
            };

        // 干/湿混合（与旧版语义一致 + 立体声宽度交叉混合）。
        // dry ∈[0,1]、wet ∈[0,1] 夹取：任何来源（含历史坏预设、用户滑杆触顶）都不得
        // 把干声/湿声放大超过原始信号，否则会削波破音、混响尾音噪声被放大成沙沙声。
        let dry_gain = 1.0 + (s.reverb_dry.clamp(0.0, 1.0) - 1.0) * w;
        let wet = s.reverb_wet.clamp(0.0, 1.0) * w;
        let wet1 = wet * (self.width * 0.5 + 0.5);
        let wet2 = wet * (self.width * 0.5 - 0.5);
        let wet_out_l = wet_l * wet1 + wet_r * wet2;
        let wet_out_r = wet_r * wet1 + wet_l * wet2;
        let mixed_l = in_l * dry_gain + wet_out_l;
        let mixed_r = in_r * dry_gain + wet_out_r;

        // 砖墙限制器
        let peak = mixed_l.abs().max(mixed_r.abs()).max(1e-9);
        let target_gain = if peak > LIMITER_CEILING {
            LIMITER_CEILING / peak
        } else {
            1.0
        };
        let coeff = if target_gain < self.limiter_gain {
            0.5
        } else {
            0.0005
        };
        self.limiter_gain += (target_gain - self.limiter_gain) * coeff;
        let comp = 1.0 + (self.limiter_gain - 1.0) * w;
        frame[0] = soft_clip(mixed_l * comp);
        frame[1] = soft_clip(mixed_r * comp);
    }

    // --- Freeverb 处理 ---

    #[inline]
    fn process_freeverb(&mut self, in_l: f32, in_r: f32) -> (f32, f32) {
        // 早期反射
        let er_l = self.early_l.process(in_l) * ER_GAIN;
        let er_r = self.early_r.process(in_r) * ER_GAIN;

        let ig = FIXED_GAIN * self.input_gain;
        let input_l = in_l * ig;
        let input_r = in_r * ig;

        // 左声道：8 梳状并联 → 4 全通串联
        let mut out_l = 0.0_f32;
        for c in &mut self.combs_l {
            out_l += c.process(input_l);
        }
        for a in &mut self.allpass_l {
            out_l = a.process(out_l);
        }

        // 右声道
        let mut out_r = 0.0_f32;
        for c in &mut self.combs_r {
            out_r += c.process(input_r);
        }
        for a in &mut self.allpass_r {
            out_r = a.process(out_r);
        }

        (out_l * WET_BOOST + er_l, out_r * WET_BOOST + er_r)
    }
}

// =========================================================================
// room_size → 反馈增益
// =========================================================================

#[inline]
fn feedback_from_room(room: f32) -> f32 {
    if room <= 1.0 {
        (room * SCALE_ROOM + OFFSET_ROOM).min(FEEDBACK_MAX)
    } else {
        (OFFSET_ROOM + SCALE_ROOM + (room - 1.0) * ROOM_EXTEND_SLOPE).min(FEEDBACK_MAX)
    }
}

// =========================================================================
// 预设 → Freeverb 参数映射
// =========================================================================

/// 预设 → 混响参数映射，返回 (room_size, damping, width, input_gain, room_scale)。
/// room_size 决定尾音长度（feedback），damping 决定明暗，width 决定立体声宽度，
/// room_scale 决定梳状/全通延迟线的缩放（即"空间/回声间隔"）。
fn preset_params(preset: &str) -> (f32, f32, f32, f32, f32) {
    match preset {
        // --- 13 个卷积混响预设（IR 路径使用；延迟线与 Freeverb 无关，统一 scale=1.0）---
        "phone" => (0.10, 0.80, 0.0, 1.0, 1.0),
        "church" => (0.55, 0.55, 0.70, 1.0, 1.0),
        "hall" => (0.60, 0.50, 0.70, 1.0, 1.0),
        "cinema" => (0.50, 0.55, 0.60, 1.0, 1.0),
        "restaurant" => (0.30, 0.65, 0.50, 1.0, 1.0),
        "bathroom" => (0.20, 0.70, 0.40, 1.0, 1.0),
        "room" => (0.30, 0.60, 0.50, 1.0, 1.0),
        "stereo" => (0.45, 0.50, 0.65, 1.0, 1.0),
        "matrixReverb1" => (0.40, 0.55, 0.60, 1.0, 1.0),
        "matrixReverb2" => (0.45, 0.60, 0.60, 1.0, 1.0),
        "cardioidSpread" => (0.40, 0.55, 0.65, 1.0, 1.0),
        "magneticStereo" => (0.50, 0.55, 0.65, 1.0, 1.0),
        "feedbackSuppressor" => (0.35, 0.70, 0.50, 1.0, 1.0),
        // --- 5 个算法混响预设（Freeverb 表达能力内，room_size/damping/width/room_scale 均差异化）---
        // room_scale 缩放延迟线长度，制造不同"房间几何"，是听感差异的主要来源：
        //   小房间 0.70（紧致）、暖房 1.00（标准 Freeverb）、大厅 1.40（开阔）、
        //   隧道 1.70（窄长）、山谷 2.10（超长开阔）
        "algoRoom" => (0.20, 0.62, 0.30, 1.0, 0.70), // 小房间：短促紧实
        "algoChamber" => (0.44, 0.88, 0.45, 1.0, 1.00), // 暖房：中、温暖偏暗
        "algoHall" => (0.60, 0.45, 0.75, 1.0, 1.40), // 大厅：中长、明亮、开阔
        "algoTunnel" => (0.70, 0.55, 0.25, 1.0, 1.70), // 隧道：较长、窄
        "algoValley" => (0.78, 0.35, 0.80, 1.0, 2.10), // 山谷：最长、明亮、很宽
        _ => (0.40, 0.55, 0.60, 1.0, 1.0),
    }
}

// =========================================================================
// 单元测试
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_for(preset: &str) -> SoundEffectSettings {
        let mut s = SoundEffectSettings::default();
        s.reverb_kind = if preset.starts_with("algo") {
            ReverbKind::Algorithmic
        } else {
            ReverbKind::Convolution
        };
        s.reverb_preset = preset.to_string();
        s.reverb_dry = 0.8;
        s.reverb_wet = 0.5;
        s
    }

    #[test]
    fn test_freeverb_process_no_nan() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for("church");
        rack.update_params(&s);
        let mut nonzero = false;
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "L NaN/Inf");
            assert!(frame[1].is_finite(), "R NaN/Inf");
            if frame[0].abs() > 1e-6 || frame[1].abs() > 1e-6 {
                nonzero = true;
            }
        }
        assert!(nonzero, "输出全零，混响未生效");
    }

    #[test]
    fn test_preset_mapping_all_22() {
        let presets = [
            "phone",
            "church",
            "hall",
            "cinema",
            "restaurant",
            "bathroom",
            "room",
            "stereo",
            "matrixReverb1",
            "matrixReverb2",
            "cardioidSpread",
            "magneticStereo",
            "feedbackSuppressor",
            "algoRoom",
            "algoHall",
            "algoChamber",
            "algoTunnel",
            "algoValley",
        ];
        for p in &presets {
            let (room, damp, width, gain, scale) = preset_params(p);
            assert!(room >= 0.0, "preset {} room {} 为负", p, room);
            assert!(
                damp >= 0.0 && damp <= 1.0,
                "preset {} damp {} 越界",
                p,
                damp
            );
            assert!(
                width >= 0.0 && width <= 1.0,
                "preset {} width {} 越界",
                p,
                width
            );
            assert!(gain > 0.0, "preset {} gain {} 非正", p, gain);
            assert!(
                scale > 0.0 && scale <= MAX_ROOM_SCALE,
                "preset {} room_scale {} 越界",
                p,
                scale
            );
        }
    }

    #[test]
    fn test_preset_switch_no_rebuild() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let len_after_prepare = rack.combs_l[0].buffer.len();
        for p in ["church", "phone", "hall", "algoTunnel", "room"] {
            let s = settings_for(p);
            rack.update_params(&s);
            assert_eq!(
                rack.combs_l[0].buffer.len(),
                len_after_prepare,
                "切换到 {} 后 Freeverb 缓冲被重建",
                p
            );
        }
        let s_church = settings_for("church");
        rack.update_params(&s_church);
        let fb_church = rack.combs_l[0].feedback;
        let s_phone = settings_for("phone");
        rack.update_params(&s_phone);
        let fb_phone = rack.combs_l[0].feedback;
        assert_ne!(fb_church, fb_phone, "切换预设后 feedback 未变");
    }

    #[test]
    fn test_sample_rate_scaling() {
        let mut rack44 = ReverbRack::new();
        rack44.prepare(44100.0, 2);
        // 容量按 MAX_ROOM_SCALE 预留，生效长度等于基础延迟线长度
        let cap44 = rack44.combs_l[0].buffer.len();
        let len44 = rack44.combs_l[0].len;

        let mut rack48 = ReverbRack::new();
        rack48.prepare(48000.0, 2);
        let len48 = rack48.combs_l[0].len;

        assert!(
            len48 > len44,
            "48000Hz 梳状有效长度({})应 > 44100Hz({})",
            len48,
            len44
        );
        assert_eq!(len44, 1116);
        assert_eq!(len48, 1215);
        assert!(
            cap44 >= (1116.0_f32 * MAX_ROOM_SCALE) as usize,
            "容量应预留到最大房间尺度，实际 {}",
            cap44
        );
    }

    #[test]
    fn test_bypass_passthrough() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.reverb_kind = ReverbKind::None;
        s.reverb_preset = String::new();
        s.reverb_dry = 0.8;
        s.reverb_wet = 0.5;
        rack.update_params(&s);
        for _ in 0..20000 {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
        }
        let mut frame = [0.42_f32, -0.17];
        rack.process(&mut frame, 2, &s);
        assert!(
            (frame[0] - 0.42).abs() < 1e-6,
            "bypass 后 L 不等于输入: {}",
            frame[0]
        );
        assert!(
            (frame[1] + 0.17).abs() < 1e-6,
            "bypass 后 R 不等于输入: {}",
            frame[1]
        );
    }

    #[test]
    fn test_feedback_extension_long_tail() {
        // 线性范围内：room 越大 feedback 越高
        let fb_small = feedback_from_room(0.2);
        let fb_mid = feedback_from_room(0.5);
        let fb_large = feedback_from_room(0.8);
        assert!(
            fb_mid > fb_small,
            "room=0.5 feedback({})应 > room=0.2({})",
            fb_mid,
            fb_small
        );
        assert!(
            fb_large > fb_mid,
            "room=0.8 feedback({})应 > room=0.5({})",
            fb_large,
            fb_mid
        );
        // 极端值被钳位到 FEEDBACK_MAX
        let fb_clamped = feedback_from_room(2.0);
        assert!(
            fb_clamped <= FEEDBACK_MAX,
            "feedback 超过上限 {}",
            fb_clamped
        );
    }

    #[test]
    fn test_early_reflections_nonzero() {
        let mut er = EarlyReflections::new(44100.0);
        for _ in 0..5000 {
            er.process(0.5);
        }
        let out = er.process(0.0);
        assert!(out.abs() > 1e-6, "早期反射输出为零，未生效");
    }

    #[test]
    fn test_wet_boost_louder_than_before() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.reverb_kind = ReverbKind::Convolution;
        s.reverb_preset = "hall".to_string();
        s.reverb_dry = 0.8;
        s.reverb_wet = 2.4;
        rack.update_params(&s);
        let mut sum_sq = 0.0_f32;
        let n = 44100_usize;
        for _ in 0..n {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            sum_sq += frame[0] * frame[0] + frame[1] * frame[1];
        }
        let rms = (sum_sq / (2.0 * n as f32)).sqrt();
        assert!(rms > 0.1, "hall 预设 RMS={} 过低", rms);
    }

    // --- 新增：专用算法测试 ---

    #[test]
    fn test_tunnel_process_no_nan() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for("algoTunnel");
        rack.update_params(&s);
        let mut nonzero = false;
        for _ in 0..44100 * 2 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "Tunnel L NaN/Inf");
            assert!(frame[1].is_finite(), "Tunnel R NaN/Inf");
            if frame[0].abs() > 1e-6 {
                nonzero = true;
            }
        }
        assert!(nonzero, "Tunnel 输出全零，算法未生效");
    }

    #[test]
    fn test_valley_process_no_nan() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for("algoValley");
        rack.update_params(&s);
        let mut nonzero = false;
        for _ in 0..44100 * 2 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "Valley L NaN/Inf");
            assert!(frame[1].is_finite(), "Valley R NaN/Inf");
            if frame[0].abs() > 1e-6 {
                nonzero = true;
            }
        }
        assert!(nonzero, "Valley 输出全零，算法未生效");
    }

    #[test]
    fn test_room_process_no_nan() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for("algoRoom");
        rack.update_params(&s);
        let mut nonzero = false;
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "Room L NaN/Inf");
            assert!(frame[1].is_finite(), "Room R NaN/Inf");
            if frame[0].abs() > 1e-6 {
                nonzero = true;
            }
        }
        assert!(nonzero, "Room 输出全零，算法未生效");
    }

    #[test]
    fn test_chamber_process_no_nan() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for("algoChamber");
        rack.update_params(&s);
        let mut nonzero = false;
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "Chamber L NaN/Inf");
            assert!(frame[1].is_finite(), "Chamber R NaN/Inf");
            if frame[0].abs() > 1e-6 {
                nonzero = true;
            }
        }
        assert!(nonzero, "Chamber 输出全零，算法未生效");
    }

    #[test]
    fn test_hall_process_no_nan() {
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for("algoHall");
        rack.update_params(&s);
        let mut nonzero = false;
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "Hall L NaN/Inf");
            assert!(frame[1].is_finite(), "Hall R NaN/Inf");
            if frame[0].abs() > 1e-6 {
                nonzero = true;
            }
        }
        assert!(nonzero, "Hall 输出全零，算法未生效");
    }

    #[test]
    fn test_algorithm_switch_no_panic() {
        // 在所有预设间切换不应 panic
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        for p in [
            "church",
            "algoRoom",
            "algoTunnel",
            "algoValley",
            "algoChamber",
            "algoHall",
            "hall",
            "phone",
        ] {
            let s = settings_for(p);
            rack.update_params(&s);
            // 切换后处理若干帧不应崩溃
            for _ in 0..100 {
                let mut frame = [0.5_f32, 0.4];
                rack.process(&mut frame, 2, &s);
            }
        }
    }

    #[test]
    fn test_algo_presets_are_distinct() {
        // 算法预设彼此听感应显著不同（不退化回趋同），以防日后参数再次收窄。
        // 关键：room_scale（房间几何）必须拉开差距，否则延迟线相同会导致听感趋同。
        let labels = ["algoRoom", "algoHall", "algoChamber", "algoTunnel", "algoValley"];
        let mut feedbacks: Vec<f32> = Vec::new();
        let mut prev: Option<(f32, f32, f32, f32)> = None;
        for l in &labels {
            let p = preset_params(l);
            let fb = feedback_from_room(p.0);
            if let Some(pv) = prev {
                let diff =
                    (p.0 - pv.0).abs() + (p.1 - pv.1).abs() + (p.2 - pv.2).abs() + (p.4 - pv.3).abs();
                assert!(diff > 0.05, "预设 {l} 与前一预设参数过于接近");
            }
            prev = Some((p.0, p.1, p.2, p.4));
            feedbacks.push(fb);
        }
        // 房间尺度必须单调拉开，且至少出现 1.0 以下的"小空间"与 1.5 以上的"大空间"
        let scales: Vec<f32> = labels.iter().map(|l| preset_params(l).4).collect();
        let (min_s, max_s) = (
            scales.iter().cloned().fold(f32::MAX, f32::min),
            scales.iter().cloned().fold(f32::MIN, f32::max),
        );
        assert!(
            min_s <= 1.0 && max_s >= 1.5,
            "算法预设房间尺度未拉开（{}~{}），听感近似",
            min_s,
            max_s
        );
        let min_fb = feedbacks.iter().cloned().fold(f32::MAX, f32::min);
        let max_fb = feedbacks.iter().cloned().fold(f32::MIN, f32::max);
        assert!(max_fb - min_fb > 0.1, "算法预设 feedback 差值过小，听感趋同");
    }

    // --- 卷积混响集成测试 ---

    #[test]
    fn test_convolution_reverb_integration() {
        // 卷积混响应产生非零、有限的输出
        let mut rack = ReverbRack::new();
        rack.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.reverb_kind = ReverbKind::Convolution;
        s.reverb_preset = "hall".to_string();
        s.reverb_dry = 0.8;
        s.reverb_wet = 0.5;
        rack.update_params(&s);

        let mut nonzero = false;
        for _ in 0..44100 * 2 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "Convolution L NaN/Inf");
            assert!(frame[1].is_finite(), "Convolution R NaN/Inf");
            if frame[0].abs() > 1e-6 || frame[1].abs() > 1e-6 {
                nonzero = true;
            }
        }
        assert!(nonzero, "卷积混响输出全零，IR 未加载或处理失败");
    }

    #[test]
    fn test_convolution_vs_algorithm_different() {
        // 卷积混响和算法混响对相同输入应产生不同输出
        let mut rack_conv = ReverbRack::new();
        rack_conv.prepare(44100.0, 2);
        let mut s_conv = SoundEffectSettings::default();
        s_conv.reverb_kind = ReverbKind::Convolution;
        s_conv.reverb_preset = "church".to_string();
        s_conv.reverb_dry = 0.5;
        s_conv.reverb_wet = 0.5;
        rack_conv.update_params(&s_conv);

        let mut rack_algo = ReverbRack::new();
        rack_algo.prepare(44100.0, 2);
        let mut s_algo = SoundEffectSettings::default();
        s_algo.reverb_kind = ReverbKind::Algorithmic;
        s_algo.reverb_preset = "algoHall".to_string();
        s_algo.reverb_dry = 0.5;
        s_algo.reverb_wet = 0.5;
        rack_algo.update_params(&s_algo);

        let mut diff_found = false;
        for _ in 0..44100 {
            let mut f_conv = [0.5_f32, 0.4];
            let mut f_algo = [0.5_f32, 0.4];
            rack_conv.process(&mut f_conv, 2, &s_conv);
            rack_algo.process(&mut f_algo, 2, &s_algo);
            if (f_conv[0] - f_algo[0]).abs() > 0.01 || (f_conv[1] - f_algo[1]).abs() > 0.01 {
                diff_found = true;
                break;
            }
        }
        assert!(
            diff_found,
            "卷积混响和算法混响输出完全相同，卷积路径可能未生效"
        );
    }
}
