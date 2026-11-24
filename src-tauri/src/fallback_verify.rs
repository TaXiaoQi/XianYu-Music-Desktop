//! 兜底配置签名校验——桌面端薄层：纯逻辑（公钥槽位、验签、测试用例）在共享
//! core（xianyu_core::fallback_verify），本文件只保留 Tauri 命令包装。

use tauri::command;
use xianyu_core::fallback_verify as verify;

pub use xianyu_core::fallback_verify::FallbackVerifyResult;

/// 校验服务端 check_beta_access 响应签名（ed25519，绑定 device_id + 过期时间；
/// 内测协议无 keyId，遍历全部公钥槽位）。返回 true 表示响应可信。
#[command]
pub fn verify_beta_access_signature(
    device_id: String,
    allowed: bool,
    pending: bool,
    exp: i64,
    signature: String,
) -> Result<bool, String> {
    verify::verify_beta_access_signature(&device_id, allowed, pending, exp, &signature)
}

/// 校验服务端下发的兜底配置签名（双公钥槽位）。`key_id` 为服务端响应携带的
/// keyId（可选）：已知 keyId 仅对该槽位严格验签；缺失/未知则遍历全部槽位，
/// 签名有效且 keyId 未知时返回 `key_unknown = true`（采纳并上报事件）。
#[command]
pub fn verify_fallback_config_signature(
    config_json: String,
    signature: String,
    key_id: Option<String>,
) -> Result<FallbackVerifyResult, String> {
    verify::verify_fallback_config_signature(&config_json, &signature, key_id.as_deref())
}
