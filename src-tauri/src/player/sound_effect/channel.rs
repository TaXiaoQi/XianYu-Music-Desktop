use super::dsp::{db_to_gain, gain_to_db, soft_clip, Biquad, EnvelopeFollower, SmoothedValue};
use super::SoundEffectSettings;

pub struct ChannelRack {
    sample_rate: f32,

    // ---- wet 混合平滑 ----
    wet_vocal: SmoothedValue,
    wet_mono: SmoothedValue,
    wet_swap: SmoothedValue,
    wet_widen: SmoothedValue,
    wet_sep: SmoothedValue,
    wet_crossfeed: SmoothedValue,
    wet_bass: SmoothedValue,
    wet_dyn_eq: SmoothedValue,

    // ---- Crossfeed（模块 12）----
    cross_lp: [Biquad; 2],

    // ---- Bass Boost（模块 5）----
    bass_shelf: [Biquad; 2],
    bass_detect_lp: [Biquad; 2],
    bass_env: EnvelopeFollower,
    bass_dyn_gain: SmoothedValue,
    bass_last_gain: f32,

    // ---- 动态均衡（模块 6）----
    dyn_low_boost: [Biquad; 2],
    dyn_split_lp: [Biquad; 2],
    dyn_split_hp: [Biquad; 2],
    dyn_comp_env: EnvelopeFollower,
    dyn_comp_reduction: [f32; 2],
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
            bass_shelf: [Biquad::new(2), Biquad::new(2)],
            bass_detect_lp: [Biquad::new(2), Biquad::new(2)],
            bass_env: EnvelopeFollower::new(5.0, 80.0, 44100.0),
            bass_dyn_gain: SmoothedValue::new(1.0),
            bass_last_gain: f32::NAN,
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
            self.bass_detect_lp[i].resize_channels(ch);
            self.dyn_low_boost[i].resize_channels(ch);
            self.dyn_split_lp[i].resize_channels(ch);
            self.dyn_split_hp[i].resize_channels(ch);
        }
        let tc = 0.05;
        self.wet_vocal.set_time_constant(tc, sample_rate);
        self.wet_mono.set_time_constant(tc, sample_rate);
        self.wet_swap.set_time_constant(tc, sample_rate);
        self.wet_widen.set_time_constant(tc, sample_rate);
        self.wet_sep.set_time_constant(tc, sample_rate);
        self.wet_crossfeed.set_time_constant(tc, sample_rate);
        self.wet_bass.set_time_constant(tc, sample_rate);
        self.wet_dyn_eq.set_time_constant(tc, sample_rate);
        self.bass_dyn_gain.set_time_constant(tc, sample_rate);

        for i in 0..2 {
            self.cross_lp[i].set_lowpass(1800.0, sample_rate, 0.707);
        }
        for i in 0..2 {
            self.bass_detect_lp[i].set_lowpass(250.0, sample_rate, 0.707);
        }
        self.dyn_comp_env.set_times(1.0, 50.0, sample_rate);
    }

    pub fn reset(&mut self) {
        for i in 0..2 {
            self.cross_lp[i].reset();
            self.bass_shelf[i].reset();
            self.bass_detect_lp[i].reset();
            self.dyn_low_boost[i].reset();
            self.dyn_split_lp[i].reset();
            self.dyn_split_hp[i].reset();
        }
        self.bass_env.reset();
        self.bass_dyn_gain.set_immediate(1.0);
        self.dyn_comp_env.reset();
        self.dyn_comp_reduction = [1.0, 1.0];
    }

    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        self.wet_vocal
            .set_target(if s.vocal_removal { 1.0 } else { 0.0 });
        self.wet_mono
            .set_target(if s.mono_merge { 1.0 } else { 0.0 });
        self.wet_swap
            .set_target(if s.channel_swap { 1.0 } else { 0.0 });
        self.wet_widen
            .set_target(if s.stereo_widen.enabled { 1.0 } else { 0.0 });
        self.wet_sep.set_target(if s.stereo_separation.enabled {
            1.0
        } else {
            0.0
        });
        self.wet_crossfeed
            .set_target(if s.crossfeed.enabled { 1.0 } else { 0.0 });
        self.wet_bass
            .set_target(if s.bass_boost.enabled { 1.0 } else { 0.0 });
        self.wet_dyn_eq
            .set_target(if s.dynamic_eq.enabled { 1.0 } else { 0.0 });

        let bg = s.bass_boost.gain.clamp(0.0, 15.0);
        if !self.bass_last_gain.is_finite() || (bg - self.bass_last_gain).abs() > 0.01 {
            self.bass_last_gain = bg;
            for i in 0..2 {
                self.bass_shelf[i].set_lowshelf(120.0, self.sample_rate, bg, 0.707);
            }
        }

        for i in 0..2 {
            self.dyn_low_boost[i].set_lowshelf(80.0, self.sample_rate, 3.0, 0.707);
            self.dyn_split_lp[i].set_lowpass(5000.0, self.sample_rate, 0.707);
            self.dyn_split_hp[i].set_highpass(5000.0, self.sample_rate, 0.707);
        }
    }

    pub fn process(&mut self, frame: &mut [f32], channels: u16, s: &SoundEffectSettings) {
        if channels != 2 || frame.len() < 2 {
            return;
        }

        // ====== 消人声（模块 1）======
        let w = self.wet_vocal.tick();
        if w > 0.001 {
            let l = frame[0];
            let r = frame[1];
            let side = r - l;
            frame[0] = soft_clip(l * (1.0 - w) + side * w);
            frame[1] = soft_clip(r * (1.0 - w) + side * w);
        }

        // ====== 单声道合并（模块 14）======
        let w = self.wet_mono.tick();
        if w > 0.001 {
            let l = frame[0];
            let r = frame[1];
            let mid = (l + r) * 0.5;
            frame[0] = l * (1.0 - w) + mid * w;
            frame[1] = r * (1.0 - w) + mid * w;
        }

        // ====== 声道交换（模块 15）======
        let w = self.wet_swap.tick();
        if w > 0.001 {
            let l = frame[0];
            let r = frame[1];
            frame[0] = l * (1.0 - w) + r * w;
            frame[1] = r * (1.0 - w) + l * w;
        }

        // ====== 立体声拓宽（模块 13）======
        let w = self.wet_widen.tick();
        if w > 0.001 {
            let amount = s.stereo_widen.amount.clamp(0.0, 3.0);
            let l = frame[0];
            let r = frame[1];
            let mid = (l + r) * 0.5;
            let side = (l - r) * 0.5 * amount;
            frame[0] = l * (1.0 - w) + (mid + side) * w;
            frame[1] = r * (1.0 - w) + (mid - side) * w;
        }

        // ====== 立体声分离度 M/S ======
        let w = self.wet_sep.tick();
        if w > 0.001 {
            let width = (s.stereo_separation.width / 100.0).clamp(0.0, 2.0);
            let center = (s.stereo_separation.center_level / 100.0).clamp(0.0, 2.0);
            let l = frame[0];
            let r = frame[1];
            let mid = (l + r) * 0.5 * center;
            let side = (l - r) * 0.5 * width;
            frame[0] = l * (1.0 - w) + (mid + side) * w;
            frame[1] = r * (1.0 - w) + (mid - side) * w;
        }

        // ====== Crossfeed（模块 12）======
        let w = self.wet_crossfeed.tick();
        if w > 0.001 {
            let strength = (s.crossfeed.strength / 100.0).clamp(0.0, 1.0) * 0.4 * w;
            let l = frame[0];
            let r = frame[1];
            let cf_l = self.cross_lp[0].process(r, 0);
            let cf_r = self.cross_lp[1].process(l, 1);
            frame[0] = l + cf_l * strength;
            frame[1] = r + cf_r * strength;
        }

        // ====== Bass 重低音增强（模块 5）======
        let w = self.wet_bass.tick();
        if w > 0.001 {
            if s.bass_boost.dynamic {
                let lp_l = self.bass_detect_lp[0].process(frame[0], 0);
                let lp_r = self.bass_detect_lp[1].process(frame[1], 1);
                let energy = self.bass_env.process(lp_l.abs().max(lp_r.abs()));
                let boost = 1.0 + (energy * 0.5).min(0.5);
                self.bass_dyn_gain.set_target(boost);
            } else {
                self.bass_dyn_gain.set_target(1.0);
            }
            let dyn_g = self.bass_dyn_gain.tick();
            let l = frame[0];
            let r = frame[1];
            let nl = self.bass_shelf[0].process(l, 0) * dyn_g;
            let nr = self.bass_shelf[1].process(r, 1) * dyn_g;
            frame[0] = l * (1.0 - w) + nl * w;
            frame[1] = r * (1.0 - w) + nr * w;
        }

        // ====== 动态均衡（模块 6）======
        let w = self.wet_dyn_eq.tick();
        if w > 0.001 {
            for i in 0..2 {
                let in_s = frame[i];
                let boosted = self.dyn_low_boost[i].process(in_s, i);
                let low = self.dyn_split_lp[i].process(boosted, i);
                let high = self.dyn_split_hp[i].process(boosted, i);
                let env = self.dyn_comp_env.process(high.abs());
                let threshold = 0.25;
                let ratio = 8.0;
                let target = if env > threshold {
                    let env_db = gain_to_db(env);
                    let thr_db = gain_to_db(threshold);
                    db_to_gain(-((env_db - thr_db) * (1.0 - 1.0 / ratio)))
                } else {
                    1.0
                };
                self.dyn_comp_reduction[i] = smooth_gain(
                    self.dyn_comp_reduction[i],
                    target,
                    1.0,
                    50.0,
                    self.sample_rate,
                );
                let merged = low + high * self.dyn_comp_reduction[i];
                frame[i] = in_s * (1.0 - w) + merged * w;
            }
        }
    }
}

#[inline]
fn smoothing_amount(ms: f32, sr: f32) -> f32 {
    let ms = ms.max(0.1);
    let sr = sr.max(1.0);
    1.0 - (-1.0 / (ms * 0.001 * sr)).exp()
}

#[inline]
fn smooth_gain(current: f32, target: f32, attack_ms: f32, release_ms: f32, sr: f32) -> f32 {
    let t = if target.is_finite() {
        target.clamp(0.0, 32.0)
    } else {
        1.0
    };
    let c = if t < current {
        smoothing_amount(attack_ms, sr)
    } else {
        smoothing_amount(release_ms, sr)
    };
    current + (t - current) * c
}
