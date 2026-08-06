// 变调实现：基于 buffer 的线性插值重采样
// 原理：以 ratio = 2^(-semitones/12) 的速率重采样
//   ratio < 1 → 降调（音调变低，时长变长）
//   ratio > 1 → 升调（音调变高，时长变短）
//
// 流式处理：维护跨 buffer 的读取位置，保证连续性
// 通道同步：按帧（一个完整通道组）处理

pub struct PitchShift {
    ratio: f64,
    semitones: f32,
    /// 上一次 buffer 处理结束时的读取位置（浮点帧索引的小数部分）
    carry_pos: f64,
    /// 上一个 buffer 的最后一帧（用于跨 buffer 插值）
    last_frame: Vec<f32>,
    channels: u16,
}

impl PitchShift {
    pub fn new(semitones: f32, channels: u16) -> Self {
        let ratio = 2.0_f64.powf(-semitones as f64 / 12.0);
        Self {
            ratio,
            semitones,
            carry_pos: 0.0,
            last_frame: vec![0.0; channels as usize],
            channels,
        }
    }

    pub fn update_semitones(&mut self, semitones: f32) {
        if (semitones - self.semitones).abs() < 0.01 {
            return;
        }
        self.semitones = semitones;
        self.ratio = 2.0_f64.powf(-semitones as f64 / 12.0);
    }

    pub fn is_active(&self) -> bool {
        self.semitones.abs() >= 0.01
    }

    /// 处理一个 buffer 的输入，返回重采样后的 buffer
    /// 输入：交错样本（[L, R, L, R, ...]）
    /// 输出：重采样后的交错样本（长度可能不同）
    pub fn process_buffer(&mut self, input: &[f32]) -> Vec<f32> {
        let channels = self.channels as usize;
        if channels == 0 || input.len() < channels {
            return input.to_vec();
        }

        if !self.is_active() {
            // 记录最后一帧用于下次插值
            let last_idx = input.len() - channels;
            self.last_frame.copy_from_slice(&input[last_idx..]);
            return input.to_vec();
        }

        // 构造扩展输入：last_frame + input
        // 这样可以处理跨 buffer 的插值
        let mut extended: Vec<f32> = Vec::with_capacity(self.last_frame.len() + input.len());
        extended.extend_from_slice(&self.last_frame);
        extended.extend_from_slice(input);
        let total_frames = extended.len() / channels;

        // 计算输出帧数
        // carry_pos 表示从 extended 起始的读取位置
        // 可读范围：[carry_pos, total_frames - 1)
        let readable_frames = (total_frames as f64 - 1.0 - self.carry_pos) / self.ratio;
        if readable_frames <= 0.0 {
            // 缓冲不足，不输出（极端情况）
            return Vec::new();
        }
        let output_frames = readable_frames.floor() as usize;
        let mut output = Vec::with_capacity(output_frames * channels);

        let mut read_pos = self.carry_pos;
        for _ in 0..output_frames {
            let i = read_pos.floor() as usize;
            let frac = (read_pos - i as f64) as f32;
            let i_next = (i + 1).min(total_frames - 1);
            for c in 0..channels {
                let s0 = extended[i * channels + c];
                let s1 = extended[i_next * channels + c];
                output.push(s0 + (s1 - s0) * frac);
            }
            read_pos += self.ratio;
        }

        // 更新 carry_pos：相对于 extended 的位置减去已消耗的帧数
        // 转换为相对于下一个 buffer（即去掉 last_frame + input 中已消耗的部分）
        let consumed_frames = read_pos.floor() as usize;
        self.carry_pos = read_pos - consumed_frames as f64;

        // 更新 last_frame 为当前 input 的最后一帧
        let last_idx = input.len() - channels;
        self.last_frame.copy_from_slice(&input[last_idx..]);

        output
    }
}
