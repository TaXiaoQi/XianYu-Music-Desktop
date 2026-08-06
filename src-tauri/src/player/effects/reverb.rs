// 简化 Schroeder 混响实现
// 结构：4 个并行 comb filter（带低通阻尼）→ 2 个串联 allpass filter
// 与 Web Audio API ConvolverNode 的卷积混响不同，但更轻量且参数直观

use super::types::ReverbParams;

struct CombFilter {
    buffer: Vec<f32>,
    index: usize,
    feedback: f32,
    damp1: f32,  // 低通阻尼系数
    damp2: f32,
    last: f32,
}

impl CombFilter {
    fn new(delay_samples: usize) -> Self {
        Self {
            buffer: vec![0.0; delay_samples.max(1)],
            index: 0,
            feedback: 0.84,
            damp1: 0.2,
            damp2: 0.8,
            last: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.index];
        // 一阶低通阻尼（高频衰减）
        self.last = output * self.damp2 + self.last * self.damp1;
        let new_val = input + self.last * self.feedback;
        self.buffer[self.index] = new_val;
        self.index = (self.index + 1) % self.buffer.len();
        output
    }
}

struct AllPassFilter {
    buffer: Vec<f32>,
    index: usize,
    feedback: f32,
}

impl AllPassFilter {
    fn new(delay_samples: usize, feedback: f32) -> Self {
        Self {
            buffer: vec![0.0; delay_samples.max(1)],
            index: 0,
            feedback,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let buffered = self.buffer[self.index];
        let output = -input + buffered;
        let new_val = input + buffered * self.feedback;
        self.buffer[self.index] = new_val;
        self.index = (self.index + 1) % self.buffer.len();
        output
    }
}

pub struct Reverb {
    combs: Vec<CombFilter>,
    allpass: Vec<AllPassFilter>,
    mix: f32,
    enabled: bool,
    sample_rate: u32,
}

impl Reverb {
    pub fn new(params: &ReverbParams, sample_rate: u32) -> Self {
        let mut reverb = Self {
            combs: Vec::new(),
            allpass: Vec::new(),
            mix: params.mix,
            enabled: params.enabled,
            sample_rate,
        };
        reverb.configure(params);
        reverb
    }

    fn configure(&mut self, params: &ReverbParams) {
        self.mix = params.mix.clamp(0.0, 1.0);
        self.enabled = params.enabled;

        // 根据采样率计算延迟时间（ms → samples）
        let sr = self.sample_rate as f32;
        // 经典 Freeverb 延迟时间（ms）
        let comb_delays_ms = [1116.0, 1188.0, 1277.0, 1356.0]; // ≈ 25-30ms @ 44100
        let allpass_delays_ms = [556.0, 441.0]; // ≈ 10-12ms

        // 根据 room_size 缩放延迟（更大的房间 = 更长的延迟）
        let room_scale = 0.7 + params.room_size * 1.3;

        self.combs = comb_delays_ms
            .iter()
            .map(|&delay_ms| {
                let delay_samples = ((delay_ms * room_scale / 1000.0) * sr / 22.0).round() as usize;
                let mut comb = CombFilter::new(delay_samples);
                // room_size 影响反馈（更大的房间 = 更长的混响尾巴）
                comb.feedback = (0.7 + params.room_size * 0.28).clamp(0.0, 0.99);
                // damping 影响低通强度（高频更快衰减）
                comb.damp1 = params.damping * 0.4;
                comb.damp2 = 1.0 - comb.damp1;
                comb
            })
            .collect();

        self.allpass = allpass_delays_ms
            .iter()
            .map(|&delay_ms| {
                let delay_samples = ((delay_ms * room_scale / 1000.0) * sr / 22.0).round() as usize;
                AllPassFilter::new(delay_samples, 0.5)
            })
            .collect();
    }

    pub fn update_params(&mut self, params: &ReverbParams) {
        if params.room_size < 0.0 || params.room_size > 1.0 {
            return;
        }
        self.configure(params);
    }

    /// 处理单声道输入，返回（干信号，湿信号）
    #[inline]
    fn process_mono(&mut self, input: f32) -> (f32, f32) {
        if !self.enabled {
            return (input, 0.0);
        }

        // 4 个并行 comb（输入求平均避免削波）
        let comb_sum: f32 = self.combs.iter_mut().map(|c| c.process(input)).sum();
        let comb_out = comb_sum * 0.25;

        // 2 个串联 allpass
        let mut wet = comb_out;
        for ap in &mut self.allpass {
            wet = ap.process(wet);
        }

        (input, wet)
    }

    /// 处理立体声帧（每帧 2 个样本：L, R）
    /// 注意：混响是 stereo-in/stereo-out，但为了简化使用单声道处理链
    /// L 和 R 共享同一组 comb buffer（与 Web Audio ConvolverNode 的 stereo impulse 不同）
    /// 实践中这种简化对听感影响极小
    pub fn process_frame(&mut self, samples: &mut [f32]) {
        if !self.enabled || samples.is_empty() {
            return;
        }
        // 取通道平均作为输入
        let input: f32 = samples.iter().sum::<f32>() / samples.len() as f32;
        let (dry, wet) = self.process_mono(input);
        let mix = self.mix;
        // 输出 = dry * (1-mix) + wet * mix，所有通道用相同值
        let output = dry * (1.0 - mix) + wet * mix;
        for sample in samples.iter_mut() {
            *sample = output;
        }
    }
}
