// 音效参数类型定义（前端通过 Tauri 命令传入）
use serde::{Deserialize, Serialize};

/// 完整音效参数 —— 与前端 soundEffectStore.ts 的 state 结构对齐
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectParams {
    /// 是否启用整个音效链
    pub enabled: bool,
    /// 变调参数（半音数，-12 到 +12，0 为不变调）
    pub pitch_shift_semitones: f32,
    /// 均衡器参数（10 频段）
    pub equalizer: Vec<EqBand>,
    /// 混响参数
    pub reverb: ReverbParams,
    /// 环绕参数
    pub surround: SurroundParams,
}

/// 单个 EQ 频段
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqBand {
    /// 频率（Hz）
    pub frequency: f32,
    /// 增益（dB，-12 到 +12）
    pub gain: f32,
    /// Q 值（带宽，0.1 到 6.0）
    pub q: f32,
}

/// 混响参数 —— 与前端 soundEffectStore.ts 的 reverb 配置对齐
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverbParams {
    /// 是否启用
    pub enabled: bool,
    /// 干湿比（0.0 全干，1.0 全湿）
    pub mix: f32,
    /// 房间大小（0.0 到 1.0，影响衰减时间）
    pub room_size: f32,
    /// 阻尼（0.0 到 1.0，高频衰减）
    pub damping: f32,
}

/// 环绕参数 —— 立体声宽度控制
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurroundParams {
    /// 是否启用
    pub enabled: bool,
    /// 立体声宽度（0.0 单声道，1.0 原始，2.0 加宽）
    pub width: f32,
}

impl Default for EffectParams {
    fn default() -> Self {
        // 与前端默认 EQ 频段一致
        let equalizer = vec![
            EqBand { frequency: 31.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 62.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 125.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 250.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 500.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 1000.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 2000.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 4000.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 8000.0, gain: 0.0, q: 1.41 },
            EqBand { frequency: 16000.0, gain: 0.0, q: 1.41 },
        ];
        Self {
            enabled: false,
            pitch_shift_semitones: 0.0,
            equalizer,
            reverb: ReverbParams {
                enabled: false,
                mix: 0.25,
                room_size: 0.5,
                damping: 0.5,
            },
            surround: SurroundParams {
                enabled: false,
                width: 1.0,
            },
        }
    }
}
