//! FFT 卷积混响引擎 —— 基于分块 overlap-add 算法实现实时流式卷积。
//!
//! 架构：
//! - 块大小 B = 2048，FFT 大小 N = 2B = 4096
//! - IR 预处理：WAV 解析 → 降混为立体声 → 重采样 → 峰值归一化 → 分块 FFT
//! - 流式处理：逐样本累积输入，满 B 个样本做一次 FFT 卷积，产生 B 个输出
//! - 延迟：2B 个样本（~93ms @ 44100Hz），对混响效果可接受
//!
//! 性能：
//! - 所有 Vec 在 load_ir() 一次性分配，process_sample() 热路径零分配
//! - FFT(input_history) 每块只计算一次，对所有 IR 块复用
//! - IR 频域表示在 load_ir() 时预计算并缓存

use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::Arc;

/// 输入块大小 B（每次累积的样本数）
const BLOCK_SIZE: usize = 2048;

// =========================================================================
// 单声道 FFT 卷积引擎（流式 overlap-add）
// =========================================================================

struct ConvolutionChannel {
    /// IR 频域分块（每块 N 个复数，预计算）
    ir_blocks: Vec<Vec<Complex<f32>>>,
    /// FFT 大小 N = 2 * BLOCK_SIZE
    fft_size: usize,
    /// 块大小 B
    block_size: usize,
    /// IR 块数
    num_blocks: usize,
    /// 输入历史（大小 N，前 B 个是上一块，后 B 个是当前块）
    input_history: Vec<Complex<f32>>,
    /// 输入 FFT 结果 X（保存副本，避免被 IFFT 覆盖后重复 FFT）
    x_freq: Vec<Complex<f32>>,
    /// IFFT 工作区
    ifft_buf: Vec<Complex<f32>>,
    /// 输出重叠缓冲（大小 (num_blocks + 1) * B）
    overlap_buf: Vec<f32>,
    /// 输入累积（大小 B，逐帧积累）
    input_accum: Vec<f32>,
    /// 当前输入累积计数
    input_count: usize,
    /// 输出缓冲（大小 B，逐帧输出）
    output_buf: Vec<f32>,
    /// 当前输出读取位置
    output_pos: usize,
    /// 前向 FFT
    fft: Arc<dyn Fft<f32>>,
    /// 反向 FFT
    ifft: Arc<dyn Fft<f32>>,
    /// 是否已加载 IR
    loaded: bool,
}

impl ConvolutionChannel {
    fn new() -> Self {
        let block_size = BLOCK_SIZE;
        let fft_size = block_size * 2;
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(fft_size);
        let ifft = planner.plan_fft_inverse(fft_size);

        Self {
            ir_blocks: Vec::new(),
            fft_size,
            block_size,
            num_blocks: 0,
            input_history: vec![Complex::new(0.0, 0.0); fft_size],
            x_freq: vec![Complex::new(0.0, 0.0); fft_size],
            ifft_buf: vec![Complex::new(0.0, 0.0); fft_size],
            overlap_buf: Vec::new(),
            input_accum: vec![0.0; block_size],
            input_count: 0,
            output_buf: vec![0.0; block_size],
            output_pos: block_size,
            fft,
            ifft,
            loaded: false,
        }
    }

    /// 加载 IR（f32 样本数组），预计算分块 FFT。
    fn load_ir(&mut self, ir: &[f32]) {
        if ir.is_empty() {
            self.loaded = false;
            return;
        }

        self.num_blocks = (ir.len() + self.block_size - 1) / self.block_size;
        self.ir_blocks.clear();
        self.ir_blocks.reserve(self.num_blocks);

        for i in 0..self.num_blocks {
            let mut block = vec![Complex::new(0.0, 0.0); self.fft_size];
            let start = i * self.block_size;
            let end = (start + self.block_size).min(ir.len());
            for (j, &s) in ir[start..end].iter().enumerate() {
                block[j] = Complex::new(s, 0.0);
            }
            self.fft.process(&mut block);
            self.ir_blocks.push(block);
        }

        self.input_history.fill(Complex::new(0.0, 0.0));
        self.overlap_buf = vec![0.0; (self.num_blocks + 1) * self.block_size];
        self.input_accum.fill(0.0);
        self.input_count = 0;
        self.output_buf.fill(0.0);
        self.output_pos = self.block_size;
        self.loaded = true;
    }

    fn reset(&mut self) {
        self.input_history.fill(Complex::new(0.0, 0.0));
        if !self.overlap_buf.is_empty() {
            self.overlap_buf.fill(0.0);
        }
        self.input_accum.fill(0.0);
        self.input_count = 0;
        self.output_buf.fill(0.0);
        self.output_pos = self.block_size;
    }

    /// 处理一个输入样本，返回一个输出样本（延迟 = 2 * block_size 个样本）。
    #[inline]
    fn process_sample(&mut self, input: f32) -> f32 {
        self.input_accum[self.input_count] = input;
        self.input_count += 1;

        if self.input_count == self.block_size {
            self.input_count = 0;
            self.process_block();
        }

        if self.output_pos < self.block_size {
            let out = self.output_buf[self.output_pos];
            self.output_pos += 1;
            out
        } else {
            0.0
        }
    }

    /// 处理一个完整块（block_size 个样本已累积到 input_accum）。
    fn process_block(&mut self) {
        if !self.loaded || self.num_blocks == 0 {
            self.output_buf.fill(0.0);
            self.output_pos = 0;
            return;
        }

        // 滑动输入历史：[old_front, old_back] → [old_back, new_input]
        for i in 0..self.block_size {
            self.input_history[i] = self.input_history[i + self.block_size];
            self.input_history[i + self.block_size] = Complex::new(self.input_accum[i], 0.0);
        }

        // FFT(input_history) → x_freq
        self.x_freq.copy_from_slice(&self.input_history);
        self.fft.process(&mut self.x_freq);

        // 输出重叠缓冲：左移 B（丢弃已输出的前 B 个），后面补零
        let overlap_len = self.overlap_buf.len();
        self.overlap_buf.copy_within(self.block_size..overlap_len, 0);
        for i in overlap_len - self.block_size..overlap_len {
            self.overlap_buf[i] = 0.0;
        }

        // 对每个 IR 块：频域乘 → IFFT → 重叠相加（Overlap-Save）
        // OLS: 使用滑动窗口 [x_{k-1}, x_k] 作为输入，IFFT 结果的前 B 个样本
        // 包含循环卷积混叠（丢弃），后 B 个样本是有效线性卷积结果（保留）
        let scale = 1.0 / self.fft_size as f32;
        for (block_idx, ir_block) in self.ir_blocks.iter().enumerate() {
            for i in 0..self.fft_size {
                self.ifft_buf[i] = self.x_freq[i] * ir_block[i];
            }
            self.ifft.process(&mut self.ifft_buf);

            let offset = block_idx * self.block_size;
            // 只取 IFFT[B..2B]（有效部分），添加到 overlap_buf 的对应位置
            let valid_len = self.block_size.min(overlap_len - offset);
            for i in 0..valid_len {
                self.overlap_buf[offset + i] +=
                    self.ifft_buf[i + self.block_size].re * scale;
            }
        }

        // 取前 B 个样本作为本块输出
        self.output_buf.copy_from_slice(&self.overlap_buf[..self.block_size]);
        self.output_pos = 0;
    }
}

// =========================================================================
// 立体声 FFT 卷积混响
// =========================================================================

/// 立体声 FFT 卷积混响（管理 L/R 两个卷积引擎）。
pub struct ConvolutionReverb {
    channel_l: ConvolutionChannel,
    channel_r: ConvolutionChannel,
    sample_rate: f32,
    current_preset: String,
}

impl ConvolutionReverb {
    pub fn new() -> Self {
        Self {
            channel_l: ConvolutionChannel::new(),
            channel_r: ConvolutionChannel::new(),
            sample_rate: 44100.0,
            current_preset: String::new(),
        }
    }

    pub fn prepare(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        // 采样率变化时需要重新加载 IR
        if !self.current_preset.is_empty() {
            let preset = self.current_preset.clone();
            self.current_preset.clear();
            self.load_preset(&preset);
        }
    }

    /// 加载预设对应的 IR。相同预设不重复加载。
    /// 未知预设或 IR 解析失败时不更新状态，保留上一次的有效 IR。
    pub fn load_preset(&mut self, preset: &str) {
        if preset == self.current_preset {
            return;
        }

        if let Some(wav_data) = preset_to_ir_data(preset) {
            let (ir_l, ir_r) = parse_wav_ir(wav_data, self.sample_rate);
            if !ir_l.is_empty() {
                self.channel_l.load_ir(&ir_l);
                self.channel_r.load_ir(&ir_r);
                self.current_preset = preset.to_string();
            }
        }
    }

    pub fn reset(&mut self) {
        self.channel_l.reset();
        self.channel_r.reset();
    }

    /// 处理一帧，返回 (wet_l, wet_r)。输入为 frame[0]=L, frame[1]=R。
    #[inline]
    pub fn process(&mut self, in_l: f32, in_r: f32) -> (f32, f32) {
        let wet_l = self.channel_l.process_sample(in_l);
        let wet_r = self.channel_r.process_sample(in_r);
        (wet_l, wet_r)
    }

    pub fn is_loaded(&self) -> bool {
        self.channel_l.loaded && self.channel_r.loaded
    }
}

// =========================================================================
// 预设 → IR 文件映射（编译时嵌入）
// =========================================================================

/// 预设名 → IR WAV 二进制数据。13 个卷积预设对应 13 个 IR 文件。
fn preset_to_ir_data(preset: &str) -> Option<&'static [u8]> {
    match preset {
        "phone" => Some(include_bytes!(
            "../../../resources/filters/filter-telephone.wav"
        )),
        "church" => Some(include_bytes!("../../../resources/filters/s3_r1_bd.wav")),
        "hall" => Some(include_bytes!("../../../resources/filters/bright-hall.wav")),
        "cinema" => Some(include_bytes!(
            "../../../resources/filters/cinema-diningroom.wav"
        )),
        "restaurant" => Some(include_bytes!(
            "../../../resources/filters/dining-living-true-stereo.wav"
        )),
        "bathroom" => Some(include_bytes!(
            "../../../resources/filters/living-bedroom-leveled.wav"
        )),
        "room" => Some(include_bytes!("../../../resources/filters/medium-room1.wav")),
        "stereo" => Some(include_bytes!(
            "../../../resources/filters/dining-living-true-stereo.wav"
        )),
        "matrixReverb1" => Some(include_bytes!(
            "../../../resources/filters/matrix-reverb1.wav"
        )),
        "matrixReverb2" => Some(include_bytes!(
            "../../../resources/filters/matrix-reverb2.wav"
        )),
        "cardioidSpread" => Some(include_bytes!(
            "../../../resources/filters/cardiod-35-10-spread.wav"
        )),
        "magneticStereo" => Some(include_bytes!(
            "../../../resources/filters/tim-omni-35-10-magnetic.wav"
        )),
        "feedbackSuppressor" => Some(include_bytes!(
            "../../../resources/filters/feedback-spring.wav"
        )),
        _ => None,
    }
}

// =========================================================================
// WAV 解析 + IR 预处理
// =========================================================================

/// 解析 16-bit PCM WAV，返回 (左声道 IR, 右声道 IR)。
/// 支持 1/2/4 声道，自动降混为立体声。采样率不匹配时线性重采样。
fn parse_wav_ir(data: &[u8], target_sample_rate: f32) -> (Vec<f32>, Vec<f32>) {
    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return (Vec::new(), Vec::new());
    }

    let mut pos = 12;
    let mut channels: u16 = 0;
    let mut sample_rate: u32 = 0;
    let mut bits_per_sample: u16 = 0;
    let mut audio_format: u16 = 0;
    let mut data_offset: usize = 0;
    let mut data_size: usize = 0;

    while pos + 8 <= data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([
            data[pos + 4],
            data[pos + 5],
            data[pos + 6],
            data[pos + 7],
        ]) as usize;

        if chunk_id == b"fmt " {
            if pos + 8 + chunk_size > data.len() {
                break;
            }
            audio_format = u16::from_le_bytes([data[pos + 8], data[pos + 9]]);
            channels = u16::from_le_bytes([data[pos + 10], data[pos + 11]]);
            sample_rate = u32::from_le_bytes([
                data[pos + 12],
                data[pos + 13],
                data[pos + 14],
                data[pos + 15],
            ]);
            bits_per_sample = u16::from_le_bytes([data[pos + 22], data[pos + 23]]);
        } else if chunk_id == b"data" {
            data_offset = pos + 8;
            data_size = chunk_size;
            break;
        }

        pos += 8 + chunk_size;
        if chunk_size % 2 == 1 {
            pos += 1;
        }
    }

    if data_offset == 0
        || data_size == 0
        || audio_format != 1
        || bits_per_sample != 16
        || channels == 0
    {
        return (Vec::new(), Vec::new());
    }

    let data_end = (data_offset + data_size).min(data.len());
    let raw = &data[data_offset..data_end];
    let ch_count = channels as usize;
    let frame_size = ch_count * 2; // 16-bit = 2 bytes per sample
    let num_frames = raw.len() / frame_size;

    // 提取各声道 f32 数据
    let mut ch_data: Vec<Vec<f32>> = (0..ch_count).map(|_| Vec::with_capacity(num_frames)).collect();
    for i in 0..num_frames {
        let frame_start = i * frame_size;
        for c in 0..ch_count {
            let s = i16::from_le_bytes([
                raw[frame_start + c * 2],
                raw[frame_start + c * 2 + 1],
            ]);
            ch_data[c].push(s as f32 / 32768.0);
        }
    }

    // 降混为立体声
    let (mut ir_l, mut ir_r) = match ch_count {
        1 => (ch_data[0].clone(), ch_data[0].clone()),
        2 => (ch_data[0].clone(), ch_data[1].clone()),
        4 => {
            // True stereo: ch0=L→L, ch1=L→R, ch2=R→L, ch3=R→R
            // 降混: L = (ch0 + ch2) / 2, R = (ch1 + ch3) / 2
            let l: Vec<f32> = ch_data[0]
                .iter()
                .zip(ch_data[2].iter())
                .map(|(a, b)| (a + b) * 0.5)
                .collect();
            let r: Vec<f32> = ch_data[1]
                .iter()
                .zip(ch_data[3].iter())
                .map(|(a, b)| (a + b) * 0.5)
                .collect();
            (l, r)
        }
        _ => (
            ch_data[0].clone(),
            ch_data.get(1).cloned().unwrap_or_else(|| ch_data[0].clone()),
        ),
    };

    // 采样率不匹配时线性重采样
    let ir_sr = sample_rate as f32;
    if (ir_sr - target_sample_rate).abs() > 1.0 {
        ir_l = linear_resample(&ir_l, ir_sr, target_sample_rate);
        ir_r = linear_resample(&ir_r, ir_sr, target_sample_rate);
    }

    // 峰值归一化到 0.5（留 headroom 防止卷积后削波）
    let peak = ir_l
        .iter()
        .chain(ir_r.iter())
        .fold(0.0f32, |max, &v| max.max(v.abs()));
    if peak > 1e-6 {
        let scale = 0.5 / peak;
        for s in &mut ir_l {
            *s *= scale;
        }
        for s in &mut ir_r {
            *s *= scale;
        }
    }

    (ir_l, ir_r)
}

/// 线性重采样。
fn linear_resample(input: &[f32], src_rate: f32, dst_rate: f32) -> Vec<f32> {
    if input.is_empty() || src_rate <= 0.0 {
        return Vec::new();
    }
    let ratio = dst_rate / src_rate;
    let output_len = ((input.len() as f32) * ratio).round() as usize;
    let mut output = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let src_pos = i as f32 / ratio;
        let src_idx = src_pos.floor() as usize;
        let frac = src_pos - src_idx as f32;
        let s0 = input[src_idx.min(input.len() - 1)];
        let s1 = input[(src_idx + 1).min(input.len() - 1)];
        output.push(s0 + (s1 - s0) * frac);
    }
    output
}

// =========================================================================
// 单元测试
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convolution_channel_impulse_response() {
        // 单位脉冲 IR → 卷积输出应等于输入（延迟 ~BLOCK_SIZE 后）
        let mut ch = ConvolutionChannel::new();
        let ir = vec![1.0_f32];
        ch.load_ir(&ir);

        // 前 BLOCK_SIZE-1 个样本是输入累积延迟（输出 0）
        for i in 0..BLOCK_SIZE - 1 {
            let out = ch.process_sample(0.5);
            assert!(
                out.abs() < 0.01,
                "延迟期内输出应接近 0, i={}, out={}",
                i,
                out
            );
        }

        // 第 BLOCK_SIZE 个样本触发第一次块处理，输出应接近输入
        for _ in 0..100 {
            let out = ch.process_sample(0.5);
            assert!(
                (out - 0.5).abs() < 0.01,
                "单位脉冲卷积输出应等于输入, out={}",
                out
            );
        }
    }

    #[test]
    fn test_convolution_channel_no_nan() {
        let mut ch = ConvolutionChannel::new();
        let ir = vec![0.5, 0.3, 0.1, -0.2, 0.05];
        ch.load_ir(&ir);

        for _ in 0..44100 {
            let out = ch.process_sample(0.5);
            assert!(out.is_finite(), "卷积输出 NaN/Inf");
        }
    }

    #[test]
    fn test_convolution_reverb_load_preset() {
        let mut conv = ConvolutionReverb::new();
        conv.prepare(44100.0);
        conv.load_preset("hall");
        assert!(conv.is_loaded(), "hall 预设应加载成功");

        let mut conv2 = ConvolutionReverb::new();
        conv2.prepare(44100.0);
        conv2.load_preset("nonexistent");
        assert!(!conv2.is_loaded(), "不存在的预设不应加载");
    }

    #[test]
    fn test_convolution_reverb_process_no_nan() {
        let mut conv = ConvolutionReverb::new();
        conv.prepare(44100.0);
        conv.load_preset("phone");

        for _ in 0..44100 {
            let (l, r) = conv.process(0.5, 0.4);
            assert!(l.is_finite(), "L NaN/Inf");
            assert!(r.is_finite(), "R NaN/Inf");
        }
    }

    #[test]
    fn test_parse_wav_ir_valid() {
        let wav_data = preset_to_ir_data("hall").expect("hall IR 应存在");
        let (ir_l, ir_r) = parse_wav_ir(wav_data, 44100.0);
        assert!(!ir_l.is_empty(), "IR 左声道不应为空");
        assert!(!ir_r.is_empty(), "IR 右声道不应为空");
        assert_eq!(ir_l.len(), ir_r.len(), "IR 左右声道长度应一致");

        // 归一化后峰值应 <= 0.5
        let peak = ir_l.iter().fold(0.0f32, |m, &v| m.max(v.abs()));
        assert!(peak <= 0.51, "IR 峰值应 <= 0.5, 实际 {}", peak);
    }

    #[test]
    fn test_linear_resample() {
        let input = vec![0.0, 1.0, 0.0, -1.0];
        let output = linear_resample(&input, 44100.0, 22050.0);
        assert_eq!(output.len(), 2, "降采样到一半长度");

        let output2 = linear_resample(&input, 22050.0, 44100.0);
        assert_eq!(output2.len(), 8, "升采样到两倍长度");
    }
}
