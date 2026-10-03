use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use tauri::command;

const FALLBACK_VERIFY_PUBLIC_KEY_HEX: &str =
    "fd2f887e74adb2009079bc822536d8f09d1404656f748289608592b6a4c974c5";

pub(crate) fn fallback_module_message(module_key: &str, version: i64, code: &str) -> Vec<u8> {
    format!("xianyu-fallback-v1\x00{module_key}\x00{version}\x00{code}").into_bytes()
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

pub(crate) fn verify_with_public_key(msg: &[u8], signature: &str) -> Result<bool, String> {
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

#[command]
pub fn verify_fallback_module_signature(
    module_key: String,
    version: i64,
    code: String,
    signature: String,
) -> Result<bool, String> {
    verify_with_public_key(
        &fallback_module_message(&module_key, version, &code),
        &signature,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

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
        assert!(verify_fallback_module_signature("lx_search".into(), 3, code.into(), sig).unwrap());
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
        let Some(sig) = sign_of("lx_search", 1, "function(){}") else {
            eprintln!("跳过：未设置 XY_FALLBACK_TEST_SEED");
            return;
        };
        assert!(!verify_fallback_module_signature(
            "lx_search".into(),
            2,
            "function(){}".into(),
            sig
        )
        .unwrap());
    }

    #[test]
    fn message_is_stable() {
        let m = String::from_utf8(fallback_module_message("lx_search", 1, "function(){}")).unwrap();
        assert!(m.starts_with("xianyu-fallback-v1\x00lx_search\x00"));
        assert_eq!(m, "xianyu-fallback-v1\x00lx_search\x001\x00function(){}");
    }

    #[test]
    fn reject_malformed_signature() {
        assert!(verify_fallback_module_signature(
            "lx_search".into(),
            1,
            "function(){}".into(),
            "not-hex!!".into()
        )
        .is_err());
    }
}
