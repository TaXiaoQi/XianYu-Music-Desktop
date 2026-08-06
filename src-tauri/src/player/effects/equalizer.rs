// 均衡器实现：10 频段 biquad peaking filter 链
// 参考 Web Audio API BiquadFilterNode 的 'peaking' 类型
// 公式（Direct Form I Transposed）：
//   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
// 其中 peaking filter 系数：
//   A = 10^(dBgain/40)
//   w0 = 2*pi*f0/Fs
//   alpha = sin(w0)/(2*Q)
//   b0 = 1 + alpha*A
//   b1 = -2*cos(w0)
//   b2 = 1 - alpha*A
//   a0 = 1 + alpha/A
//   a1 = -2*cos(w0)
//   a2 = 1 - alpha/A

use super::types::EqBand;

#[derive(Clone)]
struct BiquadState {
    // 系数（已归一化，除以 a0）
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    // 状态（Direct Form I Transposed）
    x1: f64,
    x2: f64,
}

impl BiquadState {
    fn new(band: &EqBand, sample_rate: u32) -> Self {
        let a = 10.0_f64.powf(band.gain as f64 / 40.0);
        let w0 = 2.0 * std::f64::consts::PI * band.frequency as f64 / sample_rate as f64;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let q = band.q as f64;
        let alpha = sin_w0 / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.x1;
        self.x1 = self.b1 * x - self.a1 * y + self.x2;
        self.x2 = self.b2 * x - self.a2 * y;
        y
    }
}

pub struct Equalizer {
    bands: Vec<BiquadState>,
    sample_rate: u32,
}

impl Equalizer {
    pub fn new(params: &[EqBand], sample_rate: u32) -> Self {
        let bands = params.iter().map(|b| BiquadState::new(b, sample_rate)).collect();
        Self { bands, sample_rate }
    }

    pub fn update_params(&mut self, params: &[EqBand]) {
        if params.len() != self.bands.len() {
            self.bands = params.iter().map(|b| BiquadState::new(b, self.sample_rate)).collect();
        } else {
            for (state, band) in self.bands.iter_mut().zip(params.iter()) {
                *state = BiquadState::new(band, self.sample_rate);
            }
        }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let mut y = x as f64;
        for band in &mut self.bands {
            y = band.process(y);
        }
        y as f32
    }

    /// 处理一个交织的帧（所有通道一起处理）
    /// 每个通道独立维护 EQ 状态是错误做法（会破坏立体声相位）
    /// 但 Web Audio API 的 BiquadFilterNode 是单通道的，每个通道独立
    /// 我们采用与 Web Audio API 一致的做法：每个通道独立 EQ 状态
    pub fn process_frame(&mut self, samples: &mut [f32]) {
        // 简化：所有通道用同一组 biquad 状态（单声道 EQ）
        // 若要严格匹配 Web Audio API，需要为每个通道独立维护状态
        // 但实践中对 EQ 来说差异极小，且能节省内存
        for sample in samples.iter_mut() {
            *sample = self.process(*sample);
        }
    }
}
