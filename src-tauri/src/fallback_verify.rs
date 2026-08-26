//! 兜底模块签名校验：服务端用私钥对下发模块签名，客户端用内嵌公钥验签。
//!
//! 背景：服务器会定期下发 JS 模块（歌词/搜索/音源兜底）由前端 `new Function` 执行。
//! 仅靠 HTTPS 通道 + 客户端自算 SHA-256 无法防篡改（digest 与代码同源下发）。
//! 改为 ed25519：服务端私钥签名（code + moduleKey + version），客户端公钥验签通过才执行，
//! 即使 API 服务器或传输被攻陷也无法注入未签名的任意代码。

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use tauri::command;

/// 客户端内嵌的验签公钥（hex，32 字节）。与私钥成对。
/// 私钥存于服务端（env `FALLBACK_SIGN_PRIVATE_KEY` 或 `api/fallback_sign_key.txt`），切勿入库或下发。
const FALLBACK_VERIFY_PUBLIC_KEY_HEX: &str =
    "fd2f887e74adb2009079bc822536d8f09d1404656f748289608592b6a4c974c5";

/// 签名消息构造（服务端 client/server 两端必须逐字一致）。
/// 含 moduleKey + version 防止签名在不同模块/版本间复用。
pub(crate) fn fallback_module_message(module_key: &str, version: i64, code: &str) -> Vec<u8> {
    format!("xianyu-fallback-v1\x00{module_key}\x00{version}\x00{code}").into_bytes()
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

/// 校验服务端下发的兜底模块签名。返回 true 表示签名有效，可安全执行该模块。
#[command]
pub fn verify_fallback_module_signature(
    module_key: String,
    version: i64,
    code: String,
    signature: String,
) -> Result<bool, String> {
    let pub_bytes = hex_to_bytes(FALLBACK_VERIFY_PUBLIC_KEY_HEX)?;
    let pub_key = VerifyingKey::from_bytes(
        pub_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "内嵌公钥非法".to_string())?,
    )
    .map_err(|e| format!("公钥解析失败: {e}"))?;

    let sig_bytes = hex_to_bytes(&signature)?;
    if sig_bytes.len() != 64 {
        return Ok(false);
    }
    let sig = Signature::from_bytes(sig_bytes.as_slice().try_into().unwrap());

    let msg = fallback_module_message(&module_key, version, &code);
    Ok(pub_key.verify(&msg, &sig).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// 私钥种子绝不入源码：仅从环境变量读取（与服务端 api/fallback_sign_key.txt 相同），
    /// 未设置则跳过依赖匹配密钥的用例，防止私钥随仓库泄露。
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

    fn sign_of(module_key: &str, version: i64, code: &str) -> Option<String> {
        let key = SigningKey::from_bytes(&env_seed()?);
        let msg = fallback_module_message(module_key, version, code);
        Some(hex::encode(key.sign(&msg).to_bytes()))
    }

    #[test]
    fn verified_module_accepts_signature_from_matching_key() {
        let code = "function() { return { version: 3, search() { return null } } }";
        let Some(sig) = sign_of("lx_search", 3, code) else {
            eprintln!("跳过：未设置 XY_FALLBACK_TEST_SEED");
            return;
        };
        assert!(
            verify_fallback_module_signature("lx_search".into(), 3, code.into(), sig).unwrap()
        );
    }

    #[test]
    fn rejects_tampered_code() {
        let code = "function() { return { version: 1 } }";
        let Some(sig) = sign_of("lx_search", 1, code) else {
            eprintln!("跳过：未设置 XY_FALLBACK_TEST_SEED");
            return;
        };
        let tampered = "function() { return { version: 2 } }";
        assert!(
            !verify_fallback_module_signature("lx_search".into(), 1, tampered.into(), sig).unwrap()
        );
    }

    #[test]
    fn rejects_signature_reused_across_versions() {
        // 用 version 1 签发，却伪装成 version 2 下发 → version 已并入签名消息，校验必须失败
        let Some(sig) = sign_of("lx_search", 1, "function(){}") else {
            eprintln!("跳过：未设置 XY_FALLBACK_TEST_SEED");
            return;
        };
        assert!(
            !verify_fallback_module_signature("lx_search".into(), 2, "function(){}".into(), sig).unwrap()
        );
    }

    #[test]
    fn message_is_stable() {
        let m = String::from_utf8(fallback_module_message("lx_search", 1, "function(){}")).unwrap();
        assert!(m.starts_with("xianyu-fallback-v1\x00lx_search\x00"));
        assert_eq!(m, "xianyu-fallback-v1\x00lx_search\x001\x00function(){}");
    }

    #[test]
    fn reject_malformed_signature() {
        assert!(
            verify_fallback_module_signature(
                "lx_search".into(),
                1,
                "function(){}".into(),
                "not-hex!!".into()
            )
            .is_err()
        );
    }
}