//! ### 音量保持（旧版最大问题）
//! ### 8D/36D 双耳合成（Binaural Synthesis）
//! ### 3D 环绕（非 HRTF，立体声旋转）
//! ### 速度映射修正

use super::dsp::{Biquad, DelayLine, SmoothedValue};
use super::{SoundEffectSettings, SpatialMode, VirtualSurroundMode};
use std::f32::consts::PI;

const SQRT_2: f32 = 1.41421356;

const MAX_ITD_MS: f32 = 0.6;
const ILD_MAX_ATTEN: f32 = 0.3;
const SHADOW_CUTOFF_MIN: f32 = 5000.0;
const SHADOW_CUTOFF_MAX: f32 = 20000.0;
const AIR_CUTOFF_MIN: f32 = 2500.0;
const AIR_CUTOFF_MAX: f32 = 20000.0;
const REAR_CUTOFF: f32 = 6000.0;
const FRONT_CUTOFF: f32 = 20000.0;

pub struct SpatialRack {
    sample_rate: f32,
    enabled: SmoothedValue,
    angle: f32,
    cross_dl: [DelayLine; 2],
    head_shadow_lp: [Biquad; 2],
    air_lp: [Biquad; 2],
    dist_lp: [Biquad; 2],
    last_shadow_cutoff: f32,
    last_air_cutoff: f32,
    last_dist_cutoff: f32,
    virt_delay: [DelayLine; 2],
    virt_delay2: [DelayLine; 2],
    cur_mode: SpatialMode,
}

impl SpatialRack {
    pub fn new() -> Self {
        Self {
            sample_rate: 44100.0,
            enabled: SmoothedValue::new(0.0),
            angle: 0.0,
            cross_dl: [DelayLine::new(128), DelayLine::new(128)],
            head_shadow_lp: [Biquad::new(2), Biquad::new(2)],
            air_lp: [Biquad::new(2), Biquad::new(2)],
            dist_lp: [Biquad::new(2), Biquad::new(2)],
            last_shadow_cutoff: f32::NAN,
            last_air_cutoff: f32::NAN,
            last_dist_cutoff: f32::NAN,
            virt_delay: [DelayLine::new(8192), DelayLine::new(8192)],
            virt_delay2: [DelayLine::new(8192), DelayLine::new(8192)],
            cur_mode: SpatialMode::None,
        }
    }

    pub fn prepare(&mut self, sample_rate: f32, _channels: usize) {
        self.sample_rate = sample_rate;
        self.enabled.set_time_constant(0.08, sample_rate);
        let cross_size = ((sample_rate * MAX_ITD_MS / 500.0) as usize)
            .next_power_of_two()
            .max(128);
        for d in &mut self.cross_dl {
            d.resize(cross_size);
        }
        for d in &mut self.virt_delay {
            d.resize(((sample_rate * 0.1) as usize).next_power_of_two().max(8192));
        }
        for d in &mut self.virt_delay2 {
            d.resize(((sample_rate * 0.1) as usize).next_power_of_two().max(8192));
        }
        for f in &mut self.head_shadow_lp {
            f.resize_channels(2);
        }
        for f in &mut self.air_lp {
            f.resize_channels(2);
        }
        for f in &mut self.dist_lp {
            f.resize_channels(2);
        }
        self.last_shadow_cutoff = f32::NAN;
        self.last_air_cutoff = f32::NAN;
        self.last_dist_cutoff = f32::NAN;
    }

    pub fn reset(&mut self) {
        for d in &mut self.cross_dl {
            d.clear();
        }
        for d in &mut self.virt_delay {
            d.clear();
        }
        for d in &mut self.virt_delay2 {
            d.clear();
        }
        for f in &mut self.head_shadow_lp {
            f.reset();
        }
        for f in &mut self.air_lp {
            f.reset();
        }
        for f in &mut self.dist_lp {
            f.reset();
        }
        self.angle = 0.0;
        self.last_shadow_cutoff = f32::NAN;
        self.last_air_cutoff = f32::NAN;
        self.last_dist_cutoff = f32::NAN;
    }

    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        let active = s.spatial_mode != SpatialMode::None;
        self.enabled.set_target(if active { 1.0 } else { 0.0 });

        if s.spatial_mode != self.cur_mode {
            self.cur_mode = s.spatial_mode.clone();
            self.angle = 0.0;
            self.last_shadow_cutoff = f32::NAN;
            self.last_air_cutoff = f32::NAN;
            self.last_dist_cutoff = f32::NAN;
        }
    }

    #[inline]
    fn set_shadow_cutoff(&mut self, cutoff: f32) {
        let cutoff = cutoff.clamp(SHADOW_CUTOFF_MIN, SHADOW_CUTOFF_MAX);
        if !self.last_shadow_cutoff.is_finite() || (cutoff - self.last_shadow_cutoff).abs() > 100.0
        {
            self.last_shadow_cutoff = cutoff;
            self.head_shadow_lp[0].set_lowpass(cutoff, self.sample_rate, 0.707);
            self.head_shadow_lp[1].set_lowpass(cutoff, self.sample_rate, 0.707);
        }
    }

    #[inline]
    fn set_air_cutoff(&mut self, cutoff: f32) {
        let cutoff = cutoff.clamp(AIR_CUTOFF_MIN, AIR_CUTOFF_MAX);
        if !self.last_air_cutoff.is_finite() || (cutoff - self.last_air_cutoff).abs() > 100.0 {
            self.last_air_cutoff = cutoff;
            self.air_lp[0].set_lowpass(cutoff, self.sample_rate, 0.5);
            self.air_lp[1].set_lowpass(cutoff, self.sample_rate, 0.5);
        }
    }

    #[inline]
    fn set_dist_cutoff(&mut self, cutoff: f32) {
        let cutoff = cutoff.clamp(2000.0, FRONT_CUTOFF);
        if !self.last_dist_cutoff.is_finite() || (cutoff - self.last_dist_cutoff).abs() > 100.0 {
            self.last_dist_cutoff = cutoff;
            self.dist_lp[0].set_lowpass(cutoff, self.sample_rate, 0.707);
            self.dist_lp[1].set_lowpass(cutoff, self.sample_rate, 0.707);
        }
    }

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

        let out = match s.spatial_mode {
            SpatialMode::Surround3d => self.process_3d(in_l, in_r, s),
            SpatialMode::D8 => self.process_8d(in_l, in_r, s),
            SpatialMode::D36 => self.process_36d(in_l, in_r, s),
            SpatialMode::Virtual => self.process_virtual(in_l, in_r, s),
            SpatialMode::None => (in_l, in_r),
        };

        frame[0] = in_l * (1.0 - w) + out.0 * w;
        frame[1] = in_r * (1.0 - w) + out.1 * w;
    }

    #[inline]
    fn update_angle(&mut self, seconds_per_rev: f32) -> f32 {
        let spr = seconds_per_rev.max(0.1);
        self.angle += 2.0 * PI / (spr * self.sample_rate);
        if self.angle >= 2.0 * PI {
            self.angle -= 2.0 * PI;
        }
        self.angle
    }

    // =====================================================================
    // =====================================================================

    fn process_3d(&mut self, in_l: f32, in_r: f32, s: &SoundEffectSettings) -> (f32, f32) {
        let spr = 3.6 * s.spatial_speed.max(0.1);
        let rad = self.update_angle(spr);
        let radius = s.spatial_radius.max(0.1);

        let x = rad.sin() * radius;
        let z = rad.cos() * radius;
        let dist = (x * x + z * z).sqrt();

        let dist_gain = 1.0 / dist.max(1.0);

        let azimuth = x.atan2(-z);
        let pan = azimuth.sin().clamp(-1.0, 1.0);

        let pa = (pan + 1.0) * 0.25 * PI;
        let l_gain = pa.cos() * SQRT_2;
        let r_gain = pa.sin() * SQRT_2;

        let front_back = rad.cos();
        let cutoff = if front_back < 0.0 {
            FRONT_CUTOFF + (REAR_CUTOFF - FRONT_CUTOFF) * (-front_back)
        } else {
            FRONT_CUTOFF
        };
        self.set_dist_cutoff(cutoff);

        let src = (in_l + in_r) * 0.5;

        let panned_l = src * l_gain * dist_gain;
        let panned_r = src * r_gain * dist_gain;
        let out_l = self.dist_lp[0].process(panned_l, 0);
        let out_r = self.dist_lp[1].process(panned_r, 1);

        let intensity = (s.spatial_intensity / 10.0).clamp(0.1, 1.0);
        (
            in_l * (1.0 - intensity) + out_l * intensity,
            in_r * (1.0 - intensity) + out_r * intensity,
        )
    }

    // =====================================================================
    // =====================================================================

    fn process_8d(&mut self, in_l: f32, in_r: f32, s: &SoundEffectSettings) -> (f32, f32) {
        let spr = s.spatial_speed.max(0.5);
        let rad = self.update_angle(spr);
        let radius = s.spatial_radius.max(0.1);

        let x = rad.cos() * radius;
        let z = rad.sin() * radius;
        let dist = (x * x + z * z).sqrt();

        self.binaural(in_l, in_r, x, 0.0, z, dist)
    }

    // =====================================================================
    // =====================================================================

    fn process_36d(&mut self, in_l: f32, in_r: f32, s: &SoundEffectSettings) -> (f32, f32) {
        let spr = s.spatial_speed.max(0.5);
        let rad = self.update_angle(spr);
        let base_radius = s.spatial_radius.max(0.1);

        let r = (base_radius * (1.0 + 0.6 * (rad * 0.5).sin())).max(0.3);

        let x = rad.cos() * r;
        let z = rad.sin() * r;

        let y = (rad * 1.5).sin() * base_radius;

        let dist = (r * r + y * y).sqrt();

        let dist_ratio = (dist / (base_radius * 1.8 + 0.01)).min(1.0);
        let air_cutoff = AIR_CUTOFF_MAX - dist_ratio * (AIR_CUTOFF_MAX - AIR_CUTOFF_MIN);
        self.set_air_cutoff(air_cutoff);

        self.binaural_with_air_lp(in_l, in_r, x, y, z, dist)
    }

    // =====================================================================
    // =====================================================================

    #[inline]
    fn binaural(&mut self, in_l: f32, in_r: f32, x: f32, _y: f32, z: f32, dist: f32) -> (f32, f32) {
        let src = (in_l + in_r) * 0.5;
        let dist_gain = 1.0 / dist.max(1.0);
        let src_d = src * dist_gain;

        let azimuth = x.atan2(-z);
        let pan = azimuth.sin().clamp(-1.0, 1.0);
        let pan_abs = pan.abs();

        let max_itd_samples = self.sample_rate * MAX_ITD_MS / 1000.0;
        let itd = pan_abs * max_itd_samples;

        let ild_gain = 1.0 - pan_abs * ILD_MAX_ATTEN;

        let shadow_cutoff = SHADOW_CUTOFF_MAX - pan_abs * (SHADOW_CUTOFF_MAX - SHADOW_CUTOFF_MIN);
        self.set_shadow_cutoff(shadow_cutoff);

        self.cross_dl[0].write(src_d);
        self.cross_dl[1].write(src_d);

        let near = src_d;

        let (out_l, out_r) = if pan >= 0.0 {
            let far = self.cross_dl[0].read(itd);
            let far = self.head_shadow_lp[0].process(far, 0) * ild_gain;
            (far, near)
        } else {
            let far = self.cross_dl[1].read(itd);
            let far = self.head_shadow_lp[1].process(far, 1) * ild_gain;
            (near, far)
        };

        (out_l, out_r)
    }

    #[inline]
    fn binaural_with_air_lp(
        &mut self,
        in_l: f32,
        in_r: f32,
        x: f32,
        y: f32,
        z: f32,
        dist: f32,
    ) -> (f32, f32) {
        let (l, r) = self.binaural(in_l, in_r, x, y, z, dist);
        let out_l = self.air_lp[0].process(l, 0);
        let out_r = self.air_lp[1].process(r, 1);
        (out_l, out_r)
    }

    // =====================================================================
    // =====================================================================

    fn process_virtual(&mut self, in_l: f32, in_r: f32, s: &SoundEffectSettings) -> (f32, f32) {
        let sr = self.sample_rate;
        let spread = (s.virtual_surround_spread / 10.0).clamp(0.3, 2.0);
        let is_71 = s.virtual_surround_mode == VirtualSurroundMode::SevenOne;

        let center = (in_l + in_r) * 0.5 * 0.6;

        let sl_delay = (sr * 0.015) as f32;
        let sr_delay = (sr * 0.015) as f32;
        self.virt_delay[0].write(in_l * 0.5);
        self.virt_delay[1].write(in_r * 0.5);
        let sl = self.virt_delay[0].read(sl_delay);
        let sr = self.virt_delay[1].read(sr_delay);

        let mut out_l = in_l * 0.9 + center * 0.7 + sl * 0.5 * spread;
        let mut out_r = in_r * 0.9 + center * 0.7 + sr * 0.5 * spread;

        if is_71 {
            let rl_delay = (sr * 0.030) as f32;
            let rr_delay = (sr * 0.030) as f32;
            self.virt_delay2[0].write(in_l * 0.4);
            self.virt_delay2[1].write(in_r * 0.4);
            let rl = self.virt_delay2[0].read(rl_delay);
            let rr = self.virt_delay2[1].read(rr_delay);
            out_l += rl * 0.4 * spread;
            out_r += rr * 0.4 * spread;
        }

        let cross = 0.1 * spread;
        out_l = out_l * (1.0 - cross) + in_r * cross;
        out_r = out_r * (1.0 - cross) + in_l * cross;

        (out_l, out_r)
    }
}

// =========================================================================
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_for(mode: SpatialMode) -> SoundEffectSettings {
        let mut s = SoundEffectSettings::default();
        s.spatial_mode = mode;
        s.spatial_speed = 10.0;
        s.spatial_radius = 1.0;
        s.spatial_intensity = 10.0;
        s
    }

    #[test]
    fn test_no_nan_8d() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for(SpatialMode::D8);
        rack.update_params(&s);
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "L NaN/Inf");
            assert!(frame[1].is_finite(), "R NaN/Inf");
        }
    }

    #[test]
    fn test_no_nan_36d() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for(SpatialMode::D36);
        rack.update_params(&s);
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "L NaN/Inf");
            assert!(frame[1].is_finite(), "R NaN/Inf");
        }
    }

    #[test]
    fn test_no_nan_3d() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for(SpatialMode::Surround3d);
        rack.update_params(&s);
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.4];
            rack.process(&mut frame, 2, &s);
            assert!(frame[0].is_finite(), "L NaN/Inf");
            assert!(frame[1].is_finite(), "R NaN/Inf");
        }
    }

    #[test]
    fn test_volume_preserved_8d() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for(SpatialMode::D8);
        rack.update_params(&s);

        let mut sum_sq = 0.0_f32;
        let n = 44100_usize;
        for _ in 0..n {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
            sum_sq += frame[0] * frame[0] + frame[1] * frame[1];
        }
        let rms = (sum_sq / (2.0 * n as f32)).sqrt();
        assert!(rms > 0.35, "8D RMS={} 过低（音量损失过大）", rms);
    }

    #[test]
    fn test_volume_preserved_36d() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for(SpatialMode::D36);
        rack.update_params(&s);

        let mut sum_sq = 0.0_f32;
        let n = 44100_usize;
        for _ in 0..n {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
            sum_sq += frame[0] * frame[0] + frame[1] * frame[1];
        }
        let rms = (sum_sq / (2.0 * n as f32)).sqrt();
        assert!(rms > 0.3, "36D RMS={} 过低（音量损失过大）", rms);
    }

    #[test]
    fn test_volume_preserved_3d() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let s = settings_for(SpatialMode::Surround3d);
        rack.update_params(&s);

        let mut sum_sq = 0.0_f32;
        let n = 44100_usize;
        for _ in 0..n {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
            sum_sq += frame[0] * frame[0] + frame[1] * frame[1];
        }
        let rms = (sum_sq / (2.0 * n as f32)).sqrt();
        assert!(rms > 0.35, "3D RMS={} 过低（音量损失过大）", rms);
    }

    #[test]
    fn test_bypass_passthrough() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let mut s = SoundEffectSettings::default();
        s.spatial_mode = SpatialMode::None;
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
    fn test_rotation_produces_stereo_variation() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let mut s = settings_for(SpatialMode::D8);
        s.spatial_speed = 2.0;
        rack.update_params(&s);

        let mut max_diff = 0.0_f32;
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
            max_diff = max_diff.max((frame[0] - frame[1]).abs());
        }
        assert!(
            max_diff > 0.05,
            "8D 旋转未产生 L/R 差异（max_diff={}）",
            max_diff
        );
    }

    #[test]
    fn test_3d_speed_conversion() {
        let mut rack = SpatialRack::new();
        rack.prepare(44100.0, 2);
        let mut s = settings_for(SpatialMode::Surround3d);
        s.spatial_speed = 1.0;
        rack.update_params(&s);
        for _ in 0..44100 {
            let mut frame = [0.5_f32, 0.5];
            rack.process(&mut frame, 2, &s);
        }
        let expected = 2.0 * PI / 3.6;
        assert!(
            (rack.angle - expected).abs() < 0.15,
            "3D 速度转换错误: angle={} expected≈{}",
            rack.angle,
            expected
        );
    }
}
