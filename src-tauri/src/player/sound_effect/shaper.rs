use super::dsp::{Biquad, SmoothedValue};
use super::SoundEffectSettings;

pub struct ShaperRack {
    sample_rate: f32,
    wet_distortion: SmoothedValue,
    wet_exciter: SmoothedValue,
    wet_subbass: SmoothedValue,
    wet_bitcrush: SmoothedValue,
    wet_lofi: SmoothedValue,
    exc_hp: Vec<Biquad>,
    sub_lp: Vec<Biquad>,
    lofi_ratio: f32,
    lofi_counter: f32,
    lofi_held: Vec<f32>,
}

impl ShaperRack {
    pub fn new() -> Self {
        Self {
            sample_rate: 44100.0,
            wet_distortion: SmoothedValue::new(0.0),
            wet_exciter: SmoothedValue::new(0.0),
            wet_subbass: SmoothedValue::new(0.0),
            wet_bitcrush: SmoothedValue::new(0.0),
            wet_lofi: SmoothedValue::new(0.0),
            exc_hp: Vec::new(),
            sub_lp: Vec::new(),
            lofi_ratio: 1.0,
            lofi_counter: 0.0,
            lofi_held: Vec::new(),
        }
    }

    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        let ch = channels.max(1);
        self.exc_hp = (0..ch).map(|_| Biquad::new(1)).collect();
        self.sub_lp = (0..ch).map(|_| Biquad::new(1)).collect();
        self.lofi_held = vec![0.0; ch];
        let tc = 0.05;
        self.wet_distortion.set_time_constant(tc, sample_rate);
        self.wet_exciter.set_time_constant(tc, sample_rate);
        self.wet_subbass.set_time_constant(tc, sample_rate);
        self.wet_bitcrush.set_time_constant(tc, sample_rate);
        self.wet_lofi.set_time_constant(tc, sample_rate);
    }

    pub fn reset(&mut self) {
        for f in &mut self.exc_hp {
            f.reset();
        }
        for f in &mut self.sub_lp {
            f.reset();
        }
        self.lofi_held.fill(0.0);
        self.lofi_counter = 0.0;
    }

    pub fn update_params(&mut self, s: &SoundEffectSettings) {
        self.wet_distortion
            .set_target(if s.distortion.enabled { 1.0 } else { 0.0 });
        self.wet_exciter
            .set_target(if s.exciter.enabled { 1.0 } else { 0.0 });
        self.wet_subbass
            .set_target(if s.sub_bass.enabled { 1.0 } else { 0.0 });
        self.wet_bitcrush
            .set_target(if s.bitcrush.enabled { 1.0 } else { 0.0 });
        self.wet_lofi
            .set_target(if s.lo_fi.enabled { 1.0 } else { 0.0 });

        for f in &mut self.exc_hp {
            f.set_highpass(
                s.exciter.frequency.clamp(1000.0, 8000.0),
                self.sample_rate,
                0.707,
            );
        }
        for f in &mut self.sub_lp {
            f.set_lowpass(
                s.sub_bass.frequency.clamp(50.0, 250.0),
                self.sample_rate,
                0.707,
            );
        }
        let target_sr = s.lo_fi.sample_rate.clamp(2000.0, self.sample_rate);
        self.lofi_ratio = self.sample_rate / target_sr;
    }

    pub fn process(&mut self, frame: &mut [f32], channels: u16, s: &SoundEffectSettings) {
        let ch = channels as usize;
        let sr = self.sample_rate;

        let w = self.wet_distortion.tick();
        if w > 0.001 {
            let amount = (s.distortion.amount / 100.0).clamp(0.0, 1.0);
            let drive = 1.0 + amount * 9.0;
            let makeup = 1.0 / (1.0 + amount * 2.0);
            for i in 0..ch.min(frame.len()) {
                let x = frame[i] * drive;
                let shaped = if s.distortion.distortion_type == super::DistortionType::Hard {
                    x.clamp(-1.0, 1.0)
                } else {
                    x.tanh()
                };
                frame[i] = frame[i] * (1.0 - w) + shaped * makeup * w;
            }
        }

        let w = self.wet_exciter.tick();
        if w > 0.001 {
            let amount = (s.exciter.amount / 100.0).clamp(0.0, 1.0);
            let mix = amount * 0.5 * w;
            for i in 0..ch.min(frame.len()) {
                if i < self.exc_hp.len() {
                    let hp = self.exc_hp[i].process(frame[i], 0);
                    let excited = hp.tanh() * amount;
                    frame[i] += excited * mix;
                }
            }
        }

        let w = self.wet_subbass.tick();
        if w > 0.001 {
            let amount = (s.sub_bass.amount / 100.0).clamp(0.0, 1.0);
            let mix = amount * 0.6 * w;
            for i in 0..ch.min(frame.len()) {
                if i < self.sub_lp.len() {
                    let lp = self.sub_lp[i].process(frame[i], 0);
                    let sub = lp.tanh() * amount;
                    frame[i] += sub * mix;
                }
            }
        }

        let w = self.wet_bitcrush.tick();
        if w > 0.001 {
            let bits = s.bitcrush.bits.clamp(2.0, 16.0);
            let levels = (2.0_f32).powf(bits - 1.0);
            for i in 0..ch.min(frame.len()) {
                let q = (frame[i] * levels).round() / levels;
                frame[i] = frame[i] * (1.0 - w) + q * w;
            }
        }

        let w = self.wet_lofi.tick();
        if w > 0.001 {
            let bits = s.lo_fi.bit_depth.clamp(4.0, 16.0);
            let levels = (2.0_f32).powf(bits - 1.0);
            let noise_amt = (s.lo_fi.noise / 100.0).clamp(0.0, 1.0) * 0.05;
            let ratio = self.lofi_ratio.max(1.0);
            self.lofi_counter += 1.0;
            let update = self.lofi_counter >= ratio;
            if update {
                self.lofi_counter -= ratio;
            }
            let noise = pseudo_noise();
            for i in 0..ch.min(frame.len()) {
                if i < self.lofi_held.len() {
                    if update {
                        self.lofi_held[i] = frame[i];
                    }
                    let held = self.lofi_held[i];
                    let q = (held * levels).round() / levels + noise * noise_amt;
                    frame[i] = frame[i] * (1.0 - w) + q * w;
                }
            }
            let _ = sr;
        }
    }
}

fn pseudo_noise() -> f32 {
    use std::cell::Cell;
    thread_local! {
        static STATE: Cell<u32> = Cell::new(0x12345678);
    }
    STATE.with(|s| {
        let mut x = s.get();
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        s.set(x);
        (x as f32 / u32::MAX as f32) * 2.0 - 1.0
    })
}
