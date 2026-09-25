//! 全局网络代理：配置加载、持久化，以及 reqwest client 的统一收口。
//!
//! 设计要点
//! --------
//! * reqwest 的代理是 **构造 client 时固化** 的，没有运行时修改 API。因此本模块不缓存任何
//!   client：各业务模块统一经 [`client_builder`] / [`blocking_client_builder`] / [`client`]
//!   现取现建。配置变更后「新构造的 client」立即生效，而模块内部自行缓存的 client（流缓存、
//!   插件宿主等）需重启应用才会切换 → 由 `set_network_proxy` 顺手清掉插件宿主的 client 缓存，
//!   并在 UI 上提示重启。
//! * 配置的单一事实源是 Rust 侧的 `app_data_dir/network-proxy.json`。前端设置存在 localStorage，
//!   Rust 启动时读不到，而代理必须在构造任何 client 之前确定，所以不能依赖前端推送。
//! * 密码不做明文落地，走系统凭据库（与 `music/auth.rs`、`remote/repository.rs` 一致）。
//! * 本地与内网地址一律绕过代理（见 [`NO_PROXY`]）：应用自身有本地 HTTP 服务（流缓存、MV 代理），
//!   用户的 WebDAV 可能在 NAS 上，DLNA 投屏走 LAN —— 把这些流量送进代理会直接搞坏对应功能。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "network-proxy.json";
const KEYRING_SERVICE: &str = "xianyu-music";
const KEYRING_ACCOUNT: &str = "network-proxy";

/// 代理绕过名单：localhost + 私有网段 + link-local。
/// reqwest 的 `NoProxy` 支持 IP 与 CIDR 写法（`192.168.1.0/24` 形式），见其 `from_string` 文档。
pub const NO_PROXY: &str = "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16";

/// 「测试连接」的探针地址：任何一个返回 HTTP 响应即视为代理链路可用。
/// 一个国内可达、一个国内通常不可达，覆盖代理的两类使用场景。
const PROBE_URLS: [&str; 2] = ["https://www.gstatic.com/generate_204", "https://www.baidu.com"];

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_secs(6);

/// 持久化的代理配置（不含密码，密码在 keyring）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
}

/// 回传给前端的配置视图。**绝不包含密码明文**，只告知是否已设置。
#[derive(Debug, Serialize)]
pub struct NetworkProxyState {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password_set: bool,
}

#[derive(Debug, Serialize)]
pub struct ProxyTestResult {
    pub success: bool,
    pub status: Option<u16>,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

/// 已解析好的代理（含凭据），供各 client 构造时克隆复用。
struct ResolvedProxy {
    proxy: reqwest::Proxy,
}

static STATE: OnceLock<RwLock<Option<ResolvedProxy>>> = OnceLock::new();

fn state() -> &'static RwLock<Option<ResolvedProxy>> {
    STATE.get_or_init(|| RwLock::new(None))
}

/// 规范化主机输入：去空白、去协议前缀、去路径与结尾斜杠；IPv6 字面量补方括号。
fn normalize_host(raw: &str) -> String {
    let mut host = raw.trim();
    for scheme in ["http://", "https://", "socks5://", "socks5h://", "socks4://"] {
        if let Some(stripped) = host.strip_prefix(scheme) {
            host = stripped;
            break;
        }
    }
    host = host.trim_start_matches("//");
    if let Some(index) = host.find('/') {
        host = &host[..index];
    }
    let host = host.trim();
    if host.is_empty() {
        return String::new();
    }
    // 一个冒号通常是 host:port 的误填（交给报错提醒），两个及以上才是 IPv6 字面量。
    if host.matches(':').count() >= 2 && !host.starts_with('[') {
        return format!("[{host}]");
    }
    host.to_string()
}

/// 校验配置。仅在启用时要求主机与端口有效，方便用户先部分填写。
pub fn validate(config: &ProxyConfig) -> Result<(), String> {
    if !config.enabled {
        return Ok(());
    }
    if config.host.trim().is_empty() {
        return Err("启用网络代理时必须填写代理主机".to_string());
    }
    if config.port == 0 {
        return Err("代理端口必须在 1-65535 之间".to_string());
    }
    Ok(())
}

/// 由配置构造代理。禁用时返回 `None`。
///
/// 凭据写成 `basic_auth` 而不是 URL 内嵌，避免密码含 `@` / `:` 时的转义问题。
pub fn proxy_from_config(
    config: &ProxyConfig,
    password: &str,
) -> Result<Option<reqwest::Proxy>, String> {
    if !config.enabled {
        return Ok(None);
    }
    validate(config)?;
    let host = normalize_host(&config.host);
    if host.is_empty() {
        return Err("代理主机不能为空".to_string());
    }
    let url = format!("http://{host}:{}", config.port);
    let proxy = reqwest::Proxy::all(&url).map_err(|e| format!("代理地址无效: {e}"))?;
    let username = config.username.trim();
    let proxy = if username.is_empty() {
        proxy
    } else {
        proxy.basic_auth(username, password)
    };
    Ok(Some(
        proxy.no_proxy(reqwest::NoProxy::from_string(NO_PROXY)),
    ))
}

fn current_proxy() -> Option<reqwest::Proxy> {
    let guard = state().read().unwrap_or_else(|e| e.into_inner());
    guard.as_ref().map(|resolved| resolved.proxy.clone())
}

/// 构造异步 client 的统一入口：业务模块不要直接写 `reqwest::Client::builder()`。
pub fn client_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    match current_proxy() {
        Some(proxy) => builder.proxy(proxy),
        None => builder,
    }
}

/// 构造阻塞 client 的统一入口。
pub fn blocking_client_builder() -> reqwest::blocking::ClientBuilder {
    let builder = reqwest::blocking::Client::builder();
    match current_proxy() {
        Some(proxy) => builder.proxy(proxy),
        None => builder,
    }
}

/// 便利构造：替换原先直接写 `reqwest::Client::new()` 的位置。
pub fn client() -> reqwest::Client {
    client_builder()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

fn load_config(app: &AppHandle) -> ProxyConfig {
    config_path(app)
        .ok()
        .filter(|path| path.exists())
        .and_then(|path| fs::read_to_string(&path).ok())
        .and_then(|raw| serde_json::from_str::<ProxyConfig>(&raw).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, config: &ProxyConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("写入代理配置失败: {e}"))
}

fn read_password() -> Option<String> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => entry.get_password().ok(),
        Err(_) => None,
    }
}

fn write_password(password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("keyring 创建失败: {e}"))?;
    entry
        .set_password(password)
        .map_err(|e| format!("keyring 写入失败: {e}"))
}

fn delete_password() -> Result<(), String> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(_) => Ok(()),
        },
        Err(e) => Err(format!("keyring 创建失败: {e}")),
    }
}

fn store_resolved(proxy: Option<reqwest::Proxy>) {
    let mut guard = state().write().unwrap_or_else(|e| e.into_inner());
    *guard = proxy.map(|proxy| ResolvedProxy { proxy });
}

/// 启动时加载配置。**必须早于任何 client 构造**（`setup_app` 的第一件事）。
///
/// 配置无效时回退直连而不是让启动失败：用户可以在应用内改回来。
pub fn load(app: &AppHandle) {
    let config = load_config(app);
    if !config.enabled {
        store_resolved(None);
        return;
    }
    let password = read_password().unwrap_or_default();
    match proxy_from_config(&config, &password) {
        Ok(proxy) => {
            let enabled = proxy.is_some();
            store_resolved(proxy);
            if enabled {
                eprintln!(
                    "[netproxy] 已启用网络代理 http://{}:{}",
                    normalize_host(&config.host),
                    config.port
                );
            }
        }
        Err(error) => {
            eprintln!("[netproxy] 代理配置无效，本次启动回退直连: {error}");
            store_resolved(None);
        }
    }
}

/// 保存并立即对「新构造的 client」生效。
///
/// `password`: `None` = 不改动已保存的密码；`Some("")` = 清除密码；`Some(x)` = 设置密码。
pub fn save(
    app: &AppHandle,
    config: &ProxyConfig,
    password: Option<&str>,
) -> Result<(), String> {
    validate(config)?;
    let effective_password = match password {
        Some(value) => value.to_string(),
        None => read_password().unwrap_or_default(),
    };
    // 先解析：地址非法则在写盘前就失败，不留下半套配置。
    let resolved = proxy_from_config(config, &effective_password)?;

    write_config(app, config)?;
    if let Some(value) = password {
        if value.is_empty() {
            delete_password()?;
        } else {
            write_password(value)?;
        }
    }
    store_resolved(resolved);
    Ok(())
}

/// 插件宿主的 client 是按重定向次数缓存复用的，清掉它可让插件链路免重启切换代理。
fn clear_plugin_http_clients(app: &AppHandle) {
    if let Some(state) = app.try_state::<crate::plugin_host::commands::PluginEngineState>() {
        state.engine.clear_http_clients();
    }
}

#[tauri::command]
pub async fn get_network_proxy(app_handle: AppHandle) -> Result<NetworkProxyState, String> {
    let config = load_config(&app_handle);
    Ok(NetworkProxyState {
        enabled: config.enabled,
        host: config.host,
        port: config.port,
        username: config.username,
        password_set: read_password().is_some_and(|value| !value.is_empty()),
    })
}

#[tauri::command]
pub async fn set_network_proxy(
    app_handle: AppHandle,
    config: ProxyConfig,
    password: Option<String>,
) -> Result<(), String> {
    save(&app_handle, &config, password.as_deref())?;
    clear_plugin_http_clients(&app_handle);
    Ok(())
}

/// 用**待保存的**配置试连一次。代理是否可用在重启前无从得知，这个探针能省掉一轮
/// 「改配置 → 重启 → 发现不通 → 再改」。
#[tauri::command]
pub async fn test_network_proxy(
    config: ProxyConfig,
    password: Option<String>,
) -> Result<ProxyTestResult, String> {
    if !config.enabled {
        return Err("请先启用网络代理再测试".to_string());
    }
    let password = match password {
        Some(value) => value,
        None => read_password().unwrap_or_default(),
    };
    let proxy = proxy_from_config(&config, &password)?;

    let mut builder = reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .connect_timeout(PROBE_CONNECT_TIMEOUT);
    if let Some(proxy) = proxy {
        builder = builder.proxy(proxy);
    }
    let client = builder.build().map_err(|e| e.to_string())?;

    let started = std::time::Instant::now();
    let mut last_error: Option<String> = None;
    for url in PROBE_URLS {
        match client.get(url).send().await {
            // 拿到任何 HTTP 响应都算代理链路通了（407 也说明代理活着，只是要认证）。
            Ok(response) => {
                return Ok(ProxyTestResult {
                    success: true,
                    status: Some(response.status().as_u16()),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    error: None,
                })
            }
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    Ok(ProxyTestResult {
        success: false,
        status: None,
        elapsed_ms: started.elapsed().as_millis() as u64,
        error: last_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled(host: &str, port: u16) -> ProxyConfig {
        ProxyConfig {
            enabled: true,
            host: host.to_string(),
            port,
            username: String::new(),
        }
    }

    #[test]
    fn disabled_config_yields_no_proxy() {
        let config = ProxyConfig::default();
        assert!(validate(&config).is_ok());
        assert!(proxy_from_config(&config, "").unwrap().is_none());
    }

    #[test]
    fn enabled_config_requires_host() {
        let config = enabled("   ", 7890);
        assert!(validate(&config).is_err());
        assert!(proxy_from_config(&config, "").is_err());
    }

    #[test]
    fn enabled_config_requires_port() {
        let config = enabled("127.0.0.1", 0);
        assert!(validate(&config).is_err());
    }

    #[test]
    fn accepts_valid_config_with_and_without_credentials() {
        assert!(proxy_from_config(&enabled("127.0.0.1", 7890), "").is_ok());
        let mut config = enabled("127.0.0.1", 7890);
        config.username = "alice".to_string();
        // 密码含 URL 元字符也不应影响构造（凭据走 basic_auth，不进 URL）。
        let proxy = proxy_from_config(&config, "p@ss:w/rd").unwrap();
        assert!(proxy.is_some());
    }

    #[test]
    fn normalizes_host_input() {
        assert_eq!(normalize_host("  127.0.0.1  "), "127.0.0.1");
        assert_eq!(normalize_host("http://127.0.0.1"), "127.0.0.1");
        assert_eq!(normalize_host("https://proxy.local/"), "proxy.local");
        assert_eq!(normalize_host("http://proxy.local/path"), "proxy.local");
        assert_eq!(normalize_host(""), "");
        // 单个冒号视为 host:port 误填，原样保留交由报错；多个冒号是 IPv6 字面量。
        assert_eq!(normalize_host("127.0.0.1:7890"), "127.0.0.1:7890");
        assert_eq!(normalize_host("::1"), "[::1]");
        assert_eq!(normalize_host("[::1]"), "[::1]");
    }

    #[test]
    fn no_proxy_list_covers_local_and_private_ranges() {
        // 防止有人误删条目导致内网流量被送进代理（会直接搞坏 WebDAV / DLNA / 本地流缓存）。
        for entry in [
            "localhost",
            "127.0.0.1",
            "::1",
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "169.254.0.0/16",
        ] {
            assert!(
                NO_PROXY.split(',').any(|item| item.trim() == entry),
                "NO_PROXY 缺少 {entry}"
            );
        }
        assert!(reqwest::NoProxy::from_string(NO_PROXY).is_some());
    }
}
