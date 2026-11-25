// player/cenc.rs - shim
//
// CENC 解密纯逻辑已迁入共享仓库 XianYu-Music-Core（xianyu_core::player::cenc），
// 本文件 re-export 保持 crate::player::cenc 引用路径不变。
// 测试（CTR 对称性、CENC 构造解密、流式 reader seek、非 CENC no-op）随迁 Core。

pub use xianyu_core::player::cenc::*;
