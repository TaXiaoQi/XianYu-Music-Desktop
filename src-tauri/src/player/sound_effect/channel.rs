//! 声道处理机架（阶段 2）。
//!
//! 处理需要同时访问 L/R 的立体声效果：
//! 消人声 / 单声道合并 / 声道交换 / 立体声拓宽 / 立体声分离度(M-S) /
//! Crossfeed 耳机互馈 / Bass 重低音增强（含动态回弹）/ 动态均衡。
//!
//! 全部按帧（L,R 同时）处理。每个效果带 wet mix 平滑（0↔1，50ms），
//! 启停无 click。非立体声输入时整体直通。

use super::dsp::{Biquad, EnvelopeFollower, SmoothedValue, db_to_gain, gain_to_db};
use super::SoundEffectSettings;

pub struct ChannelRack {
    sample_rate: f32,
    // 各效果 wet 混合平滑（启用→1，停用→0）
    wet_vocal: SmoothedValue,
    wet_mono: SmoothedValue,
    wet_swap: SmoothedValue,
    wet_widen: SmoothedValue,
    wet_sep: SmoothedValue,
    wet_crossfeed: SmoothedValue,
    wet_bass: SmoothedValue,
    wet_dyn_eq: SmoothedValue,
    // Crossfeed：低通 + 延迟
    cross_lp: [Biquad; 2],
    cross_delay_samples: f32,
    // Bass boost：低 shelf（固定系数，仅 gain 变更时重算）+ 动态增益乘法（独立于滤波器）
    // 匹配 YinDongMusic：lowshelf(120Hz, Q=0.7) 固定 + dynamicGain 独立乘法（鼓点增强非减弱）
    bass_shelf: [Biquad; 2],
    bass_env: EnvelopeFollower,
    bass_dynamic_gain: SmoothedValue, // 动态增强乘法（1.0~1.5）
    bass_last_gain: f32,              // 跟踪上次 gain 值，避免每帧重设系数
    // 动态均衡：低频增强 + 二分频 + 高频压缩（匹配 YinDongMusic 二分频 DynamicsCompressor 方案）
    dyn_low_boost: [Biquad; 2],  // lowshelf @ 80Hz, +3dB（始终启用）
    dyn_split_lp: [Biquad; 2],   // lowpass @ 5000Hz 分频
    dyn_split_hp: [Biquad; 2],   // highpass @ 5000Hz 分频
    dyn_comp_env: EnvelopeFollower, // 高频压缩包络（attack=1ms, release=50ms）
    dyn_comp_reduction: [f32; 2],   // 各声道当前压缩增益
}

impl ChannelRack {
    pub fn new() -> Self {
        Self {
            sample_rate: 44100.0,
            wet_vocal: SmoothedValue::new(0.0),
            wet_mono: SmoothedValue::new(0.0),
            wet_swap: SmoothedValue::new(0.0),
            wet_widen: SmoothedValue::new(0.0),
            wet_sep: SmoothedValue::new(0.0),
            wet_crossfeed: SmoothedValue::new(0.0),
            wet_bass: SmoothedValue::new(0.0),
            wet_dyn_eq: SmoothedValue::new(0.0),
            cross_lp: [Biquad::new(2), Biquad::new(2)],
            cross_delay_samples: 0.0,
            bass_shelf: [Biquad::new(2), Biquad::new(2)],
            bass_env: EnvelopeFollower::new(5.0, 80.0, 44100.0),
            bass_dynamic_gain: SmoothedValue::new(1.0),
            bass_last_gain: f32::NAN, // 初始 NaN 强制首次设系数
            dyn_low_boost: [Biquad::new(2), Biquad::new(2)],
            dyn_split_lp: [Biquad::new(2), Biquad::new(2)],
            dyn_split_hp: [Biquad::new(2), Biquad::new(2)],
            dyn_comp_env: EnvelopeFollower::new(1.0, 50.0, 44100.0),
            dyn_comp_reduction: [1.0, 1.0],
        }
    }

    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        let ch = channels.max(1);
        for i in 0..2 {
            self.cross_lp[i].resize_channels(ch);
            self.bass_shelf[i].resize_channels(ch);
            self.dyn_low_boost[i].resize_channels(ch);
            self.dyn_split_lp[i].resize_channels(ch);
            self.dyn_split_hp[i].resize_channels(ch);
        }
        // 50ms 时间常数
        let tc = 0.05;
        self.wet_vocal.set_time_constant(tc, sample_rate);
        self.wet_mono.set_time_constant(tc, sample_rate);
        self.wet_swap.set_time_constant(tc, sample_rate);
        self.wet_widen.set_time_constant(tc, sample_rate);
        self.wet_sep.set_time_constant(tc, sample_rate);
        self.wet_crossfeed.set_time_constant(tc, sample_rate);
        self.wet_bass.set_time_constant(tc, sample_rate);
        self.wet_dyn_eq.set_time_constant(tc, sample_rate);
        self.bass_dynamic_gain.set_time_constant(tc, sample_rate);
        // Crossfeed 低通 ~1.8kHz
        for i in 0..2 {
            self.cross_lp[i].set_lowpass(1800.0, sample_rate, 0.707);
        }
        self.cross_delay_samples = (sample_rate * 0.0002).max(1.0); // ~0.2ms
        // 动态均衡压缩包络：attack=1ms, release=50ms
        self.dyn_comp_env.set_times(1.0, 50.0, sample_rate);
    }

    pub fn reset(&mut self) {
        for i in 0..2 {
            self.cross_lp[i].reset();
            self.bass_shelf[i].reset();
            self.dyn_low_boost[i].reset();
            self.dyn_split_lp[i].reset();
            self.dyn_split_hp[i].reset();
        }
        self.bass_env.reset();
        self.bass_dynamic_gain.set_immediate(1.0);
        self.dyn_comp_env.reset();
        self.dyn_comp_reduction = [1.0, 1.0];
    }

    /// 更新各效果系数（参数变更时调用）
    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        // wet 目标
        self.wet_vocal.set_target(if s.vocal_removal { 1.0 } else { 0.0 });
        self.wet_mono.set_target(if s.mono_merge { 1.0 } else { 0.0 });
        self.wet_swap.set_target(if s.channel_swap { 1.0 } else { 0.0 });
        self.wet_widen.set_target(if s.stereo_widen.enabled { 1.0 } else { 0.0 });
        self.wet_sep.set_target(if s.stereo_separation.enabled { 1.0 } else { 0.0 });
        self.wet_crossfeed.set_target(if s.crossfeed.enabled { 1.0 } else { 0.0 });
        self.wet_bass.set_target(if s.bass_boost.enabled { 1.0 } else { 0.0 });
        self.wet_dyn_eq.set_target(if s.dynamic_eq.enabled { 1.0 } else { 0.0 });

        // Bass boost 低 shelf（仅 gain 变化时重设系数，避免每帧重算产生 zipper noise）
        let bass_gain = s.bass_boost.gain.clamp(0.0, 15.0);
        if !self.bass_last_gain.is_finite() || (bass_gain - self.bass_last_gain).abs() > 0.01 {
            self.bass_last_gain = bass_gain;
            for i in 0..2 {
                self.bass_shelf[i].set_lowshelf(120.0, self.sample_rate, bass_gain, 0.707);
            }
        }
        // 动态均衡：低频增强 lowshelf @ 80Hz +3dB，分频 lowpass/highpass @ 5000Hz
        // 高频通过独立压缩器处理（attack=1ms, release=50ms, threshold=-12dB, ratio=8）
        for i in 0..2 {
            self.dyn_low_boost[i].set_lowshelf(80.0, self.sample_rate, 3.0, 0.707);
            self.dyn_split_lp[i].set_lowpass(5000.0, self.sample_rate, 0.707);
            self.dyn_split_hp[i].set_highpass(5000.0, self.sample_rate, 0.707);
        }
    }

    /// 处理一帧（frame[0]=L, frame[1]=R）。非立体声直通。
    pub fn process(&mut self, frame: &mut [f32], channels: u16, s: &SoundEffectSettings) {
        if channels != 2 || frame.len() < 2 {
            return;
        }

        // 消人声：center 去除，输出 side 信号
        let w = self.wet_vocal.tick();
        if w > 0.001 {
            let l = frame[0];
            let r = frame[1];
            let side = (l - r) * 0.5;
            frame[0] = l * (1.0 - w) + side * w;
            frame[1] = r * (1.0 - w) + side * w;
        }

        // 单声道合并
        let w = self.wet_mono.tick();
        if w > 0.001 {
            let l = frame[0];
            let r = frame[1];
            let mid = (l + r) * 0.5;
            frame[0] = l * (1.0 - w) + mid * w;
            frame[1] = r * (1.0 - w) + mid * w;
        }

        // 声道交换
        let w = self.wet_swap.tick();
        if w > 0.001 {
            let l = frame[0];
            let r = frame[1];
            frame[0] = l * (1.0 - w) + r * w;
            frame[1] = r * (1.0 - w) + l * w;
        }

        // 立体声拓宽（M/S：side *= amount）
        let w = self.wet_widen.tick();
        if w > 0.001 {
            let amount = s.stereo_widen.amount.clamp(0.0, 3.0);
            let l = frame[0];
            let r = frame[1];
            let mid = (l + r) * 0.5;
            let side = (l - r) * 0.5 * amount;
            let nl = mid + side;
            let nr = mid - side;
            frame[0] = l * (1.0 - w) + nl * w;
            frame[1] = r * (1.0 - w) + nr * w;
        }

        // 立体声分离度（M/S：mid *= centerLevel/100, side *= width/100）
        let w = self.wet_sep.tick();
        if w > 0.001 {
            let width = (s.stereo_separation.width / 100.0).clamp(0.0, 2.0);
            let center = (s.stereo_separation.center_level / 100.0).clamp(0.0, 2.0);
            let l = frame[0];
            let r = frame[1];
            let mid = (l + r) * 0.5 * center;
            let side = (l - r) * 0.5 * width;
            let nl = mid + side;
            let nr = mid - side;
            frame[0] = l * (1.0 - w) + nl * w;
            frame[1] = r * (1.0 - w) + nr * w;
        }

        // Crossfeed 耳机互馈：L/R 互相馈入低通+延迟的对方信号
        let w = self.wet_crossfeed.tick();
        if w > 0.001 {
            let strength = (s.crossfeed.strength / 100.0).clamp(0.0, 1.0) * 0.4 * w;
            let l = frame[0];
            let r = frame[1];
            // 用 biquad 低通近似（含相位延迟），简化处理
            let cf_l = self.cross_lp[0].process(r, 0);
            let cf_r = self.cross_lp[1].process(l, 1);
            frame[0] = l + cf_l * strength;
            frame[1] = r + cf_r * strength;
        }

        // Bass 重低音增强（动态增强：鼓点时 boost，匹配 YinDongMusic）
        let w = self.wet_bass.tick();
        if w > 0.001 {
            // 动态模式：低频能量大时增强增益（1.0~1.5 倍），非减弱
            // YinDongMusic: boost = 1 + avg * 0.5，鼓点时低音更 punchy
            if s.bass_boost.dynamic {
                let bass_energy = self.bass_env.process(frame[0].abs().max(frame[1].abs()));
                let boost = 1.0 + (bass_energy * 0.5).min(0.5);
                self.bass_dynamic_gain.set_target(boost);
            } else {
                self.bass_dynamic_gain.set_target(1.0);
            }
            let dyn_g = self.bass_dynamic_gain.tick();
            // lowshelf 系数在 update_params 中按 gain 设置（不每帧重设）
            let l = frame[0];
            let r = frame[1];
            let nl = self.bass_shelf[0].process(l, 0) * dyn_g;
            let nr = self.bass_shelf[1].process(r, 1) * dyn_g;
            frame[0] = l * (1.0 - w) + nl * w;
            frame[1] = r * (1.0 - w) + nr * w;
        }

        // 动态均衡：低频 +3dB 增强 + 二分频 + 高频压缩（匹配 YinDongMusic 二分频方案）
        // 链路：input → lowshelf(+3dB@80Hz) → 分频(lowpass@5kHz / highpass@5kHz)
        //       低频直通 + 高频经压缩器(threshold=-12dB, ratio=8, attack=1ms, release=50ms) → 合并
        let w = self.wet_dyn_eq.tick();
        if w > 0.001 {
            for i in 0..2 {
                let in_s = frame[i];
                // 1. 低频增强
                let boosted = self.dyn_low_boost[i].process(in_s, i);
                // 2. 分频
                let low = self.dyn_split_lp[i].process(boosted, i);
                let high = self.dyn_split_hp[i].process(boosted, i);
                // 3. 高频压缩（threshold=-12dB ≈ 0.25 线性, ratio=8）
                let env = self.dyn_comp_env.process(high.abs());
                let threshold = 0.25;
                let ratio = 8.0;
                let target_gain = if env > threshold {
                    let env_db = gain_to_db(env);
                    let thr_db = gain_to_db(threshold);
                    db_to_gain(-((env_db - thr_db) * (1.0 - 1.0 / ratio)))
                } else {
                    1.0
                };
                // 平滑跟随（attack/release 由包络跟随器处理，此处额外平滑防抖）
                self.dyn_comp_reduction[i] += (target_gain - self.dyn_comp_reduction[i]) * 0.1;
                let compressed = high * self.dyn_comp_reduction[i];
                // 4. 合并 + wet mix
                let merged = low + compressed;
                frame[i] = in_s * (1.0 - w) + merged * w;
            }
        }
    }
}
