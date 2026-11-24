// WebDAV 访问层 shim：URL 拼接、PROPFIND 解析、歌词读取与音频落盘
// 统一在共享 core（xianyu_core::remote::webdav，含 SSRF 防护）。
// 桌面端在启动早期通过 init_remote_runtime 注入带代理支持的共享客户端。
pub(crate) use xianyu_core::remote::webdav::*;
