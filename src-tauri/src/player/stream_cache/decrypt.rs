// player/stream_cache/decrypt.rs - shim
//
// 已完成缓存文件的 CENC 就地解密已迁入共享仓库
// （xianyu_core::player::stream_cache::decrypt），re-export 保持
// super::decrypt::decrypt_cenc_file 引用路径不变。

pub(super) use xianyu_core::player::stream_cache::decrypt::decrypt_cenc_file;
