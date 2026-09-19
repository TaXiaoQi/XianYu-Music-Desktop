#![allow(dead_code)]

use std::collections::VecDeque;

const WINDOW_MS: f32 = 40.0;
const SEARCH_RATIO: f32 = 0.05;
const CENTRAL_BIAS_RATIO: f32 = 0.02;
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

    input: VecDeque<f32>,
    in_base: usize,
    cur_in_f: f64,
    started: bool,
    input_eof: bool,

    output: VecDeque<f32>,
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

    pub fn prepare(&mut self, sample_rate: f32, channels: usize) {
        self.sample_rate = sample_rate;
        self.channels = channels.max(1);
        self.win = ((WINDOW_MS * sample_rate / 1000.0) as usize).max(64) & !1;
        self.overlap = self.win / 2;
        self.hop_out = self.win - self.overlap;
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

    pub fn set_stretch(&mut self, stretch: f32) {
        self.stretch = stretch.clamp(STRETCH_MIN, STRETCH_MAX);
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

    pub fn emittable_frames(&self) -> usize {
        if !self.active || !self.started {
            return self.output.len() / self.channels;
        }
        if self.flushed {
            return self.output.len() / self.channels;
        }
        let total = self.output.len() / self.channels;
        total.saturating_sub(self.win)
    }

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

    pub fn produce(&mut self) -> bool {
        if !self.active {
            return false;
        }
        let ch = self.channels;

        if !self.started {
            if self.input_frames() < self.win {
                return false;
            }
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

        let ideal = self.cur_in_f + self.hop_out as f64 * self.stretch as f64;
        let base = (ideal - self.sr as f64).max(self.cur_in_f) as usize;
        let hi = (ideal + self.sr as f64) as usize + 1;
        if hi + self.win > self.in_base + self.input_frames() {
            return false;
        }

        let out_total = self.output.len() / ch;
        let tail_base = out_total.saturating_sub(self.overlap);
        let mut overlap_energy = 1e-9_f32;
        for j in 0..self.overlap {
            let b = self.output[(tail_base + j) * ch];
            overlap_energy += b * b;
        }
        let bias_coef = overlap_energy * CENTRAL_BIAS_RATIO;
        let inv_sr = if self.sr > 0 {
            1.0 / self.sr as f64
        } else {
            0.0
        };
        let mut best = self.cur_in_f;
        let mut best_diff = f32::INFINITY;
        for s in base..=hi {
            let mut diff = 0.0_f32;
            for j in 0..self.overlap {
                let a = self.iter_val(s + j, 0);
                let b = self.output[(tail_base + j) * ch];
                let d = a - b;
                diff += d * d;
            }
            let off = (s as f64 - ideal) * inv_sr;
            diff += (off * off) as f32 * bias_coef;
            if diff < best_diff {
                best_diff = diff;
                best = s as f64;
            }
        }

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

    pub fn flush(&mut self) {
        if !self.active {
            return;
        }
        if self.flushed {
            return;
        }
        for _ in 0..16 {
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
        assert!(!ws.produce());
    }

    #[test]
    fn test_speedup_shrinks_output() {
        let mut ws = Wsola::new();
        ws.prepare(44100.0, 2);
        ws.set_stretch(1.5);
        feed_impulse(&mut ws);
        let out_frames = ws.output.len() / 2;

        let expected = ((1.0 * ws.sample_rate) as f32 / 1.5).round();
        let ratio = out_frames as f32 / expected;
        assert!(
            ratio > 0.8 && ratio < 1.2,
            "加速后长度 {out_frames} 偏离预期 {expected} (ratio={ratio})"
        );
        assert!(ws.output.iter().all(|v| v.is_finite()));
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

    #[test]
    fn test_tempo_stability() {
        let mut ws = Wsola::new();
        ws.prepare(44100.0, 2);
        ws.set_stretch(1.0 / 2.0f32.powf(3.0 / 12.0));

        let sr = ws.sample_rate as usize;
        let period = (0.5 * sr as f32) as usize;
        let beats = 12;
        let total = beats * period;
        let mut buf = Vec::with_capacity(total * 2);
        for i in 0..total {
            let phase = i % period;
            let t = phase as f32 / sr as f32;
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
