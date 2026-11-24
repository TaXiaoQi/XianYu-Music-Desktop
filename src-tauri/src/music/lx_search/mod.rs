// lx_search shim：搜索实现统一在共享 core（xianyu_core::music::lx_search）。
// Core 为权威版本（含 soso 免签名兜底、分页填充、专辑/批量时长查询等更新），
// 端侧旧分层（api/cache/common/sign）与平台实现已删除，公开入口路径保持不变。
pub use xianyu_core::music::lx_search::*;
