// USB 独占模式音效处理模块
// 在 Rust 后端重新实现 Web Audio API 的音效链（EQ/混响/环绕/变调）
// 处理顺序与前端 soundEffectStore.ts 保持一致：变调 → 均衡器 → 混响 → 环绕

pub(crate) mod chain;
pub(crate) mod equalizer;
pub(crate) mod pitch_shift;
pub(crate) mod reverb;
pub(crate) mod surround;
pub(crate) mod types;

pub use chain::EffectChain;
#[allow(unused_imports)]
pub use types::{EffectParams, EqBand, ReverbParams, SurroundParams};
