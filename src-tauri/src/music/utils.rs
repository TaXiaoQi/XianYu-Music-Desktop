// 路径与数值层面的零散工具已迁移至共享仓库 xianyu-core，此处仅做 re-export（shim）。
// Windows verbatim 前缀清理、UNC 历史路径识别、网络盘判定、SQL LIKE 辅助、
// 整型安全收窄与格式分布统计均以 Core 为权威实现（含移动端 descendant_prefixes 增量）。
pub use xianyu_core::music::utils::*;
