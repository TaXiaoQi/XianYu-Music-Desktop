pub mod convolution;
pub mod phase_vocoder;
pub mod wsola;
// 音效引擎模块组织：参数类型与处理源已拆分为独立文件。
pub mod params;
pub mod source;
#[cfg(test)] mod tests;
pub mod channel; // 声道处理
pub mod dynamics; // 动态范围处理
pub mod modulation; // 调制类效果
pub mod pitch; // 变调
pub mod reverb; // 混响
pub mod shaper; // 失真整形
pub mod spatial; // 空间音频
pub mod controls; // 控制率处理
pub mod filters; // 滤波器原语
pub mod dsp; // DSP 基础原语

pub use params::*;
pub use source::{SoundEffectHandle, SoundEffectSource};
