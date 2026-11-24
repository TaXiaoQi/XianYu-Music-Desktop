//! DLNA 双向投屏——桌面端薄层：核心逻辑（SSDP 发现/DMC 投放/DMR 渲染器/httpd
//! 媒体伺服）在共享 core（xianyu_core::dlna，双端同步一份代码，勿在本端私自改动）。
//!
//! - commands.rs：Tauri 命令层（桌面端专属，含 emit 循环宿主）。
//! - bridge（FRB）在移动端薄壳，不在桌面端。

pub mod commands;

pub use xianyu_core::dlna::*;
