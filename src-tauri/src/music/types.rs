// 曲库数据契约 shim：全部结构统一在共享 core（xianyu_core::music::types），
// serde 字段名是对外契约（冻结）。Core 的 SongDetail 额外携带移动端技术信息
// 展示字段（Option 序列化，桌面端前端忽略未知字段，无契约破坏）。
pub use xianyu_core::music::types::*;
