// 远程音源持久化 shim：SQL 与凭据流程统一在共享 core（xianyu_core::remote::repository），
// 端侧仅保留系统凭据管理器（keyring）实现，启动早期注入。
pub(crate) use xianyu_core::remote::repository::*;

use xianyu_core::remote::repository::SecretStore;
use std::time::Duration;

/// 当前使用的凭据服务名。
const CREDENTIAL_SERVICE: &str = "XianYu Music WebDAV";
/// 旧版服务名：读取时兜底，保证历史保存的密码不丢失。
const CREDENTIAL_SERVICE_LEGACY: &str = "XY-Music WebDAV";

fn credential_entry(service: &str, source_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, source_id).map_err(|e| e.to_string())
}

/// 从指定服务名读取非空密码。
fn read_secret(service: &str, source_id: &str) -> Option<String> {
    let password = credential_entry(service, source_id).ok()?.get_password().ok()?;
    (!password.is_empty()).then_some(password)
}

/// 读取密码：先查现用服务名，未命中再翻旧服务名并就地搬迁。
fn stored_password(source_id: &str) -> Option<String> {
    if let Some(password) = read_secret(CREDENTIAL_SERVICE, source_id) {
        return Some(password);
    }
    let legacy = read_secret(CREDENTIAL_SERVICE_LEGACY, source_id)?;
    if save_password(source_id, &legacy).is_ok() {
        if let Ok(entry) = credential_entry(CREDENTIAL_SERVICE_LEGACY, source_id) {
            entry.delete_credential().ok();
        }
    }
    Some(legacy)
}

/// 写入密码；空密码视为无操作。
fn save_password(source_id: &str, password: &str) -> Result<(), String> {
    if password.is_empty() {
        return Ok(());
    }
    credential_entry(CREDENTIAL_SERVICE, source_id)?
        .set_password(password)
        .map_err(|e| e.to_string())
}

/// 新旧服务名一并清除，避免残留条目被兜底逻辑读到。
fn purge_passwords(source_id: &str) {
    for service in [CREDENTIAL_SERVICE, CREDENTIAL_SERVICE_LEGACY] {
        if let Ok(entry) = credential_entry(service, source_id) {
            entry.delete_credential().ok();
        }
    }
}

/// 桌面端凭据存储：密码只进系统凭据管理器，绝不落库。
struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn read(&self, source_id: &str) -> Option<String> {
        stored_password(source_id)
    }

    fn write(&self, source_id: &str, password: &str) -> Result<(), String> {
        save_password(source_id, password)
    }

    fn delete(&self, source_id: &str) {
        purge_passwords(source_id)
    }

    fn requires_verified_write(&self) -> bool {
        true
    }
}

/// 启动早期注入远程运行时：keyring 凭据存储 + 带 netproxy 代理支持的
/// WebDAV 共享客户端（须在 netproxy::load 之后调用）。
pub(crate) fn init_remote_runtime() {
    let _ = xianyu_core::remote::repository::install_secret_store(Box::new(KeyringSecretStore));

    let client = crate::netproxy::client_builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .pool_max_idle_per_host(4)
        .redirect(crate::security::ssrf::ip_literal_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .build()
        .expect("build webdav http client");
    let _ = xianyu_core::remote::webdav::override_shared_client(client);
}
