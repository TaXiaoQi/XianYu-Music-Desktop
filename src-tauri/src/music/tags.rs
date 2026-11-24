// 标签元数据模块已迁移至共享仓库 xianyu-core，此处仅做 re-export（shim）。
// 读取入口（含 QMC 解密、WAV/MPEG 抢救兜底）、文本/详情/歌词/封面提取、
// 元数据写入（事务加锁）均以 Core 为权威实现。
pub use xianyu_core::music::tags::*;
