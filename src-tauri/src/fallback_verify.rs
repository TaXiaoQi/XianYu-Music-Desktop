//! 兜底配置签名校验。
//!
//! 服务端下发兜底行为配置（各元数据链路的开关/平台来源参数，不含任何可执行
//! 代码）。仅靠 HTTPS 无法防篡改，改为 ed25519：服务端私钥对配置 JSON 原始
//! 字符串签名，客户端公钥验签通过才采纳。
//!
//! 同文件还提供内测资格响应（check_beta_access）的签名校验。

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use tauri::command;

/// 客户端内嵌的验签公钥（hex，32 字节），与私钥成对（私钥存于服务端）。
const FALLBACK_VERIFY_PUBLIC_KEY_HEX: &str =
    "fd2f887e74adb2009079bc822536d8f09d1404656f748289608592b6a4c974c5";

/// 配置签名消息构造（与服务端逐字一致）：
/// 对配置 JSON 原始字符串（未解析、未重排序）直接签名，避免 JSON 规范化
/// 差异；前缀防止签名在其他消息类型间复用。
pub(crate) fn fallback_config_message(config_json: &str) -> Vec<u8> {
    format!("xianyu-fallback-config-v1\x00{config_json}").into_bytes()
}

/// 内测资格响应签名消息（与服务端 check_beta_access 逐字一致）：
/// `xianyu-beta-access-v1\x00{device_id}\x00{allowed01}\x00{pending01}\x00{exp}`
pub(crate) fn beta_access_message(device_id: &str, allowed: bool, pending: bool, exp: i64) -> Vec<u8> {
    format!(
        "xianyu-beta-access-v1\x00{device_id}\x00{}\x00{}\x00{exp}",
        i32::from(allowed),
        i32::from(pending),
    )
    .into_bytes()
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    if !hex.len().is_multiple_of(2) {
        return Err("签名不是合法 hex".to_string());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| "签名不是合法 hex".to_string()))
        .collect()
}

fn verify_with_public_key(msg: &[u8], signature: &str) -> Result<bool, String> {
    let pub_bytes = hex_to_bytes(FALLBACK_VERIFY_PUBLIC_KEY_HEX)?;
    let pub_key = VerifyingKey::from_bytes(
        pub_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "内嵌公钥非法".to_string())?,
    )
    .map_err(|e| format!("公钥解析失败: {e}"))?;

    let sig_bytes = hex_to_bytes(signature)?;
    if sig_bytes.len() != 64 {
        return Ok(false);
    }
    let sig = Signature::from_bytes(sig_bytes.as_slice().try_into().unwrap());

    Ok(pub_key.verify(msg, &sig).is_ok())
}

/// 校验服务端 check_beta_access 响应签名（ed25519，绑定 device_id + 过期时间）。
/// 返回 true 表示响应可信。
#[command]
pub fn verify_beta_access_signature(
    device_id: String,
    allowed: bool,
    pending: bool,
    exp: i64,
    signature: String,
) -> Result<bool, String> {
    verify_with_public_key(
        &beta_access_message(&device_id, allowed, pending, exp),
        &signature,
    )
}

/// 校验服务端下发的兜底配置签名。返回 true 表示签名有效，可采纳该配置。
#[command]
pub fn verify_fallback_config_signature(
    config_json: String,
    signature: String,
) -> Result<bool, String> {
    verify_with_public_key(&fallback_config_message(&config_json), &signature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// 私钥种子绝不入源码：仅从环境变量读取，未设置则跳过依赖匹配密钥的用例。
    fn env_seed() -> Option<[u8; 32]> {
        let hex = std::env::var("XY_FALLBACK_TEST_SEED").ok()?;
        let bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .filter_map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
            .collect();
        if bytes.len() != 32 {
            return None;
        }
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&bytes);
        Some(seed)
    }

    fn sign_of(config_json: &str) -> Option<String> {
        let key = SigningKey::from_bytes(&env_seed()?);
        let msg = fallback_config_message(config_json);
        Some(hex::encode(key.sign(&msg).to_bytes()))
    }

    #[test]
    fn message_is_stable() {
        let m = String::from_utf8(fallback_config_message("{\"version\":1}")).unwrap();
        assert!(m.starts_with("xianyu-fallback-config-v1\x00"));
        assert_eq!(m, "xianyu-fallback-config-v1\x00{\"version\":1}");
    }

    #[test]
    fn beta_access_message_is_stable() {
        let m = String::from_utf8(beta_access_message("dev1", true, false, 123)).unwrap();
        assert_eq!(m, "xianyu-beta-access-v1\x00dev1\x001\x000\x00123");
    }

    #[test]
    fn beta_access_rejects_tampered_fields() {
        let Some(sig) = (|| {
            let key = SigningKey::from_bytes(&env_seed()?);
            Some(hex::encode(
                key.sign(&beta_access_message("dev1", true, false, 123))
                    .to_bytes(),
            ))
        })() else {
            eprintln!("跳过：未设置 XY_FALLBACK_TEST_SEED");
            return;
        };
        assert!(verify_beta_access_signature("dev1".into(), true, false, 123, sig.clone()).unwrap());
        assert!(!verify_beta_access_signature("dev2".into(), true, false, 123, sig.clone()).unwrap());
        assert!(!verify_beta_access_signature("dev1".into(), false, false, 123, sig.clone()).unwrap());
        assert!(!verify_beta_access_signature("dev1".into(), true, true, 123, sig.clone()).unwrap());
        assert!(!verify_beta_access_signature("dev1".into(), true, false, 124, sig).unwrap());
    }

    #[test]
    fn rejects_malformed_signature() {
        assert!(verify_fallback_config_signature("{\"version\":1}".into(), "not-hex!!".into()).is_err());
    }

    #[test]
    fn rejects_tampered_config() {
        let Some(sig) = sign_of("{\"version\":1}") else {
            eprintln!("跳过：未设置 XY_FALLBACK_TEST_SEED");
            return;
        };
        assert!(verify_fallback_config_signature("{\"version\":1}".into(), sig.clone()).unwrap());
        assert!(!verify_fallback_config_signature("{\"version\":2}".into(), sig).unwrap());
    }
}
