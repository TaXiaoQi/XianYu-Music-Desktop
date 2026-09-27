// 配对与鉴权：首次连接凭 6 位配对码绑定换 token，之后凭 token 重连。
// 状态持久化在 app_config_dir/control_channel.json；配对码仅存内存。

use super::server::{AuthOutcome, HelloAuth};
use getrandom::fill;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 已配对设备上限，超出挤掉最旧。
const MAX_DEVICES: usize = 3;
/// 配对码有效期。
const CODE_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TokenEntry {
    pub token: String,
    pub device_name: String,
    /// unix 秒
    pub paired_at: u64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct PersistedConfig {
    /// 允许遥控总开关（默认开）
    #[serde(default = "default_true")]
    enabled: bool,
    /// SSDP 通告 USN（首次生成后固定）
    #[serde(default)]
    udn: String,
    #[serde(default)]
    tokens: Vec<TokenEntry>,
}

impl Default for PersistedConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            udn: String::new(),
            tokens: Vec::new(),
        }
    }
}

fn default_true() -> bool {
    true
}

struct Inner {
    enabled: bool,
    udn: String,
    tokens: Vec<TokenEntry>,
    pairing_code: String,
    code_expires_at: Option<Instant>,
}

pub struct PairingManager {
    path: PathBuf,
    inner: Mutex<Inner>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 桌面显示名（与 dlna/commands.rs 主机名取法一致）。
pub fn desktop_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "XianYu-Desktop".to_string())
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    if fill(&mut buf).is_err() {
        // 极端回退：以 uuid v4 拼接保证非空（熵由 uuid crate 自取）
        return format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        )[..bytes * 2]
            .to_string();
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn random_code() -> String {
    // 6 位数字，避免 0/1/8 等易混字符的取舍从简：全数字即可（有屏幕对照输入）
    let mut buf = [0u8; 4];
    let _ = fill(&mut buf);
    let n = u32::from_be_bytes(buf) % 1_000_000;
    format!("{n:06}")
}

impl PairingManager {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("control_channel.json");
        let cfg: PersistedConfig = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let udn = if cfg.udn.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            cfg.udn.clone()
        };
        let mut inner = Inner {
            enabled: cfg.enabled,
            udn,
            tokens: cfg.tokens,
            pairing_code: String::new(),
            code_expires_at: None,
        };
        if inner.tokens.len() > MAX_DEVICES {
            inner.tokens.sort_by_key(|t| t.paired_at);
            inner.tokens.truncate(MAX_DEVICES);
        }
        let mgr = Self {
            path,
            inner: Mutex::new(inner),
        };
        mgr.persist();
        mgr
    }

    fn persist(&self) {
        let inner = self.inner.lock().unwrap();
        let cfg = PersistedConfig {
            enabled: inner.enabled,
            udn: inner.udn.clone(),
            tokens: inner.tokens.clone(),
        };
        drop(inner);
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_vec_pretty(&cfg) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    pub fn set_enabled(&self, on: bool) {
        self.inner.lock().unwrap().enabled = on;
        self.persist();
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.lock().unwrap().enabled
    }

    pub fn udn(&self) -> String {
        self.inner.lock().unwrap().udn.clone()
    }

    /// 生成新配对码，返回 (code, 有效期秒)。
    pub fn new_pairing_code(&self) -> (String, u64) {
        let mut inner = self.inner.lock().unwrap();
        inner.pairing_code = random_code();
        inner.code_expires_at = Some(Instant::now() + CODE_TTL);
        (inner.pairing_code.clone(), CODE_TTL.as_secs())
    }

    /// 当前有效配对码；过期或未生成返回 None。
    pub fn pairing_code_info(&self) -> Option<(String, u64)> {
        let inner = self.inner.lock().unwrap();
        let expires = inner.code_expires_at?;
        let left = expires.checked_duration_since(Instant::now())?;
        Some((inner.pairing_code.clone(), left.as_secs()))
    }

    pub fn devices(&self) -> Vec<TokenEntry> {
        self.inner.lock().unwrap().tokens.clone()
    }

    pub fn forget(&self, token: &str) -> bool {
        let removed = {
            let mut inner = self.inner.lock().unwrap();
            let before = inner.tokens.len();
            inner.tokens.retain(|t| t.token != token);
            before != inner.tokens.len()
        };
        if removed {
            self.persist();
        }
        removed
    }
}

fn issue_token(tokens: &mut Vec<TokenEntry>, device_name: &str) -> String {
    let token = random_hex(32);
    tokens.push(TokenEntry {
        token: token.clone(),
        device_name: device_name.to_string(),
        paired_at: now_secs(),
    });
    if tokens.len() > MAX_DEVICES {
        tokens.sort_by_key(|t| t.paired_at);
        let overflow = tokens.len() - MAX_DEVICES;
        tokens.drain(..overflow);
    }
    token
}

impl HelloAuth for PairingManager {
    fn authenticate(
        &self,
        device_name: &str,
        token: Option<&str>,
        pairing_code: Option<&str>,
    ) -> AuthOutcome {
        let mut inner = self.inner.lock().unwrap();
        if !inner.enabled {
            return AuthOutcome {
                ok: false,
                desktop_name: desktop_name(),
                token: None,
            };
        }
        // 已配对：token 精确匹配
        if let Some(t) = token {
            if !t.is_empty() && inner.tokens.iter().any(|e| e.token == t) {
                return AuthOutcome {
                    ok: true,
                    desktop_name: desktop_name(),
                    token: None, // 重连通过不下发 token 原文
                };
            }
        }
        // 首配：配对码有效且未过期
        if let Some(code) = pairing_code {
            let code_ok = !code.is_empty()
                && !inner.pairing_code.is_empty()
                && inner.pairing_code == code
                && inner
                    .code_expires_at
                    .map(|e| e > Instant::now())
                    .unwrap_or(false);
            if code_ok {
                let token = issue_token(&mut inner.tokens, device_name);
                drop(inner);
                self.persist();
                return AuthOutcome {
                    ok: true,
                    desktop_name: desktop_name(),
                    token: Some(token),
                };
            }
        }
        AuthOutcome {
            ok: false,
            desktop_name: desktop_name(),
            token: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xy_ctrl_test_{tag}_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pairing_flow_issues_and_persists_token() {
        let dir = temp_dir("pair");
        let mgr = PairingManager::load(&dir);
        assert!(mgr.is_enabled());

        // 未生成配对码时首配失败
        let bad = mgr.authenticate("手机", None, Some("123456"));
        assert!(!bad.ok);

        let (code, ttl) = mgr.new_pairing_code();
        assert_eq!(code.len(), 6);
        assert!(ttl >= 1800);

        // 错误码失败
        assert!(!mgr.authenticate("手机", None, Some("000000")).ok);
        // 正确码成功并下发 token
        let ok = mgr.authenticate("我的手机", None, Some(&code));
        assert!(ok.ok);
        let token = ok.token.expect("new pairing should return token");
        assert_eq!(token.len(), 64);

        // token 持久化：重载后可凭 token 重连
        let mgr2 = PairingManager::load(&dir);
        assert!(mgr2.authenticate("我的手机", Some(&token), None).ok);
        // 错误 token 拒绝
        assert!(!mgr2.authenticate("我的手机", Some(&"x".repeat(64)), None).ok);
        // 配对码一次性换 token 后仍有效期内可再次使用（幂等无害），但 token 已入库
        assert_eq!(mgr2.devices().len(), 1);

        // 忘记设备后 token 失效
        assert!(mgr2.forget(&token));
        assert!(!mgr2.forget(&token));
        assert!(!mgr2.authenticate("我的手机", Some(&token), None).ok);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn device_cap_evicts_oldest() {
        let dir = temp_dir("cap");
        let mgr = PairingManager::load(&dir);
        let mut tokens = Vec::new();
        for i in 0..4 {
            let (code, _) = mgr.new_pairing_code();
            std::thread::sleep(std::time::Duration::from_millis(5));
            let out = mgr.authenticate(&format!("dev{i}"), None, Some(&code));
            tokens.push(out.token.unwrap());
        }
        assert_eq!(mgr.devices().len(), MAX_DEVICES);
        // 最旧的 dev0 被挤掉
        assert!(!mgr.authenticate("dev0", Some(&tokens[0]), None).ok);
        assert!(mgr.authenticate("dev3", Some(&tokens[3]), None).ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn disabled_rejects_everything() {
        let dir = temp_dir("dis");
        let mgr = PairingManager::load(&dir);
        mgr.set_enabled(false);
        let (code, _) = mgr.new_pairing_code();
        assert!(!mgr.authenticate("d", None, Some(&code)).ok);
        assert!(!mgr.authenticate("d", Some(&"x".repeat(64)), None).ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pairing_code_expires() {
        let dir = temp_dir("exp");
        let mgr = PairingManager::load(&dir);
        let (code, _) = mgr.new_pairing_code();
        // 手动把过期时间拨回过去
        {
            let mut inner = mgr.inner.lock().unwrap();
            inner.code_expires_at = Some(Instant::now() - Duration::from_secs(1));
        }
        assert!(!mgr.authenticate("d", None, Some(&code)).ok);
        assert!(mgr.pairing_code_info().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
