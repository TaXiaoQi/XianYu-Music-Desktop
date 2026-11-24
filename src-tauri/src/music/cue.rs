// CUE 唱片描述表解析已迁移至共享仓库 xianyu-core，此处仅做 re-export（shim）。
// 逐行指令分类 → 轨道草稿折叠 → 音频文件定位的完整流水线以 Core 为权威实现，
// 解析失败的错误形态集合与字段序列化契约逐字保持。
pub use xianyu_core::music::cue::*;
