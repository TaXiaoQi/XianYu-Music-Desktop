// 远程曲库数据结构 shim：serde 字段名（camelCase）是前端契约，冻结不改名。
// 全部类型统一在共享 core（xianyu_core::remote::types）。
pub(crate) use xianyu_core::remote::types::*;
