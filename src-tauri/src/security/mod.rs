// security：纯逻辑已迁共享 core（xianyu-core），此处 re-export 保持 crate:: 路径不变。
// Core 版 ssrf 含 DoH 兜底与 fake-ip 兼容语义，为两端统一定版。
pub use xianyu_core::security::path_validator;
pub use xianyu_core::security::ssrf;
