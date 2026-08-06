// 音效链管理器：组合 EQ / 混响 / 环绕 / 变调
// 处理顺序：变调 → 均衡器 → 混响 → 环绕
// （与前端 soundEffectStore.ts 的节点连接顺序一致）
//
// 关键设计：
// - 变调用 process_buffer（输出长度可能变化）
// - EQ / 混响 / 环绕用 process_frame（输出长度不变，原地修改）
// - 所有模块支持运行时更新参数（Arc<Mutex<EffectParams>> 共享）

use std::sync::{Arc, Mutex};

use super::equalizer::Equalizer;
use super::pitch_shift::PitchShift;
use super::reverb::Reverb;
use super::surround::Surround;
use super::types::EffectParams;

pub struct EffectChain {
    params: Arc<Mutex<EffectParams>>,
    pitch_shift: PitchShift,
    equalizer: Equalizer,
    reverb: Reverb,
    surround: Surround,
    /// 当前通道数（用于初始化和检测变化）
    channels: u16,
}

impl EffectChain {
    pub fn new(params: Arc<Mutex<EffectParams>>, channels: u16, sample_rate: u32) -> Self {
        let p = params.lock().map(|p| p.clone()).unwrap_or_default();

        Self {
            pitch_shift: PitchShift::new(p.pitch_shift_semitones, channels),
            equalizer: Equalizer::new(&p.equalizer, sample_rate),
            reverb: Reverb::new(&p.reverb, sample_rate),
            surround: Surround::new(&p.surround),
            params,
            channels,
        }
    }

    /// 从共享参数同步到各子模块
    pub fn sync_params(&mut self) {
        let p = match self.params.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => return,
        };
        self.pitch_shift.update_semitones(p.pitch_shift_semitones);
        self.equalizer.update_params(&p.equalizer);
        self.reverb.update_params(&p.reverb);
        self.surround.update_params(&p.surround);
    }

    /// 处理一个完整的 buffer
    /// 输入：交错样本 [L, R, L, R, ...]
    /// 输出：处理后的样本（长度可能因变调而变化）
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        let p = match self.params.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => return input.to_vec(),
        };

        if !p.enabled {
            return input.to_vec();
        }

        // 1. 变调（可能改变长度）
        let after_pitch = if p.pitch_shift_semitones.abs() >= 0.01 {
            self.pitch_shift.process_buffer(input)
        } else {
            input.to_vec()
        };

        if after_pitch.is_empty() {
            return Vec::new();
        }

        let channels = self.channels as usize;
        if channels == 0 {
            return after_pitch;
        }

        // 2. 均衡器 + 混响 + 环绕（原地修改）
        // 按帧处理
        let mut output = after_pitch;
        let frame_count = output.len() / channels;

        for frame_idx in 0..frame_count {
            let start = frame_idx * channels;
            let end = start + channels;
            let frame = &mut output[start..end];

            self.equalizer.process_frame(frame);
            self.reverb.process_frame(frame);
            self.surround.process_frame(frame);
        }

        output
    }
}
