// music/auth.rs - 账号认证与签名请求
//
// 从前端 authService.ts + httpClient.ts + md5.ts 迁移而来：
// MD5 签名算法、带签名头的 POST 请求、token 的 keyring 安全存储。
// 签名密钥不再暴露在前端 JS 中，全部在 Rust 侧完成。
//
// 命令列表：
// - authed_request:     向账号 API 发起带签名的 POST 请求（baseUrl/?action=xxx）
// - signed_post_json:   向任意 URL 发起带签名的 POST 请求（壁纸等非账号端点）
// - save_auth_credentials:  将 token 存入 keyring，user JSON 存入文件
// - get_auth_credentials:   从 keyring 读取 token，从文件读取 user
// - clear_auth_credentials: 清除 keyring 和 user 文件
// - set_auth_base_url:  保存自定义 API 基地址
// - get_auth_base_url:  读取 API 基地址（含默认值回退）

use keyring::Entry;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// 默认 API 签名密钥。自建后端可在客户端账号设置页覆盖。
const DEFAULT_API_SECRET: &str = "bf027fedb4d1b4f969c10495f12f17042bf0de02de128200";

/// 官方后端地址
const OFFICIAL_AUTH_BASE_URL: &str = "http://back.xymusic.cc/api";

/// 默认后端地址：测试构建与正式构建统一指向弦予音乐 API
const DEFAULT_AUTH_BASE_URL: &str = OFFICIAL_AUTH_BASE_URL;

/// keyring 服务名 / 账户名
const KEYRING_SERVICE: &str = "xianyu-music";
const KEYRING_ACCOUNT: &str = "auth-token";

/// 默认 fetch 超时（与原前端 FETCH_TIMEOUT_MS 一致）
const DEFAULT_FETCH_TIMEOUT_MS: u64 = 25_000;

/// 全局 HTTP 客户端单例：复用连接池 / TLS 会话，避免每次请求重建 Client。
/// 超时通过 per-request `timeout()` 覆盖，不放在全局默认上。
static HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

fn http_client() -> &'static Result<reqwest::Client, String> {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
    })
}

// ─── 辅助结构 ──────────────────────────────────────────

struct SignedHeaders {
    timestamp: String,
    nonce: String,
    sign: String,
}

/// 生成随机 nonce（32 位十六进制字符串）
fn generate_nonce() -> String {
    let bytes = uuid::Uuid::new_v4().as_simple().to_string();
    // uuid v4 simple 格式已经是 32 位十六进制
    bytes
}

/// 计算签名并返回带签名的请求头信息
fn build_signed_headers(body: &str, api_secret: &str) -> SignedHeaders {
    let timestamp = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs())
    .to_string();
    let nonce = generate_nonce();
    let sign_input = format!("{}{}{}{}", timestamp, nonce, body, api_secret);
    let digest = md5::compute(sign_input.as_bytes());
    let sign = format!("{:x}", digest);
    SignedHeaders {
        timestamp,
        nonce,
        sign,
    }
}

// ─── 凭证存储（keyring + 文件） ────────────────────────

/// 获取 auth 数据目录
fn auth_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("auth");
    fs::create_dir_all(&dir).map_err(|e| format!("创建 auth 目录失败: {e}"))?;
    Ok(dir)
}

/// user JSON 文件路径
fn user_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(auth_data_dir(app)?.join("user.json"))
}

/// base_url 文件路径
fn base_url_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(auth_data_dir(app)?.join("base_url.txt"))
}

/// api_secret 文件路径
fn api_secret_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(auth_data_dir(app)?.join("api_secret.txt"))
}

/// 从文件读取 base_url，不存在时返回默认值
fn read_base_url(app: &AppHandle) -> String {
    match base_url_file_path(app) {
        Ok(path) => {
            if path.exists() {
                let saved = fs::read_to_string(&path)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if saved.is_empty() {
                    return DEFAULT_AUTH_BASE_URL.to_string();
                }
                saved
            } else {
                DEFAULT_AUTH_BASE_URL.to_string()
            }
        }
        Err(_) => DEFAULT_AUTH_BASE_URL.to_string(),
    }
}

/// 从文件读取 API 签名密钥，不存在时返回默认值
fn read_api_secret(app: &AppHandle) -> String {
    match api_secret_file_path(app) {
        Ok(path) => {
            if path.exists() {
                let saved = fs::read_to_string(&path)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if saved.is_empty() {
                    DEFAULT_API_SECRET.to_string()
                } else {
                    saved
                }
            } else {
                DEFAULT_API_SECRET.to_string()
            }
        }
        Err(_) => DEFAULT_API_SECRET.to_string(),
    }
}

/// 从 keyring 读取 token
fn read_token_from_keyring() -> Option<String> {
    match Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => entry.get_password().ok(),
        Err(_) => None,
    }
}

/// 将 token 存入 keyring
fn save_token_to_keyring(token: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("keyring 创建失败: {e}"))?;
    entry
        .set_password(token)
        .map_err(|e| format!("keyring 写入失败: {e}"))
}

/// 从 keyring 删除 token
fn delete_token_from_keyring() -> Result<(), String> {
    match Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => {
            // delete_credential 在条目不存在时返回 Err，这是正常情况
            match entry.delete_credential() {
                Ok(()) => Ok(()),
                Err(_) => Ok(()), // 忽略"条目不存在"错误
            }
        }
        Err(e) => Err(format!("keyring 创建失败: {e}")),
    }
}

// ─── Tauri 命令 ────────────────────────────────────────

#[derive(Serialize)]
pub struct AuthCredentials {
    pub token: String,
    pub user: Value,
}

/// 向账号 API 发起带签名的 POST 请求。
///
/// 自动构造 URL：`{base_url}/?action={action}`，
/// 生成 MD5 签名头（X-Timestamp / X-Nonce / X-Sign），
/// 返回完整的响应 JSON（`{ code, msg, data }`）。
///
/// `fetch_timeout_ms` 控制单个 HTTP 请求的超时（默认 25s）。
#[tauri::command]
pub async fn authed_request(
    app_handle: AppHandle,
    action: String,
    body: Value,
    fetch_timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let base_url = read_base_url(&app_handle);
    let url = format!("{}/?action={}", base_url, action);
    let api_secret = read_api_secret(&app_handle);

    do_signed_post(&url, &action, body, fetch_timeout_ms, &api_secret).await
}

/// 向任意 URL 发起带签名的 POST 请求（壁纸等非账号 API 端点）。
///
/// 签名算法与 `authed_request` 完全一致：
/// `sign = md5(timestamp + nonce + body + api_secret)`
#[tauri::command]
pub async fn signed_post_json(
    app_handle: AppHandle,
    url: String,
    body: Value,
    fetch_timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let api_secret = read_api_secret(&app_handle);
    do_signed_post(&url, "signedPostJson", body, fetch_timeout_ms, &api_secret).await
}

/// 内部：执行带签名的 POST 请求
async fn do_signed_post(
    url: &str,
    action: &str,
    body: Value,
    fetch_timeout_ms: Option<u64>,
    api_secret: &str,
) -> Result<Value, String> {
    let body_str = serde_json::to_string(&body).unwrap_or_default();
    let headers = build_signed_headers(&body_str, api_secret);
    let timeout_ms = fetch_timeout_ms.unwrap_or(DEFAULT_FETCH_TIMEOUT_MS);

    let client = http_client().as_ref().map_err(|e| e.clone())?;
    let start = std::time::Instant::now();

    let response = client
        .post(url)
        .timeout(Duration::from_millis(timeout_ms))
        .header("Content-Type", "application/json")
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sign", &headers.sign)
        .body(body_str)
        .send()
        .await
        .map_err(|e| {
            let elapsed = start.elapsed().as_millis();
            let msg = e.to_string();
            let is_timeout = msg.contains("timeout") || msg.contains("elapsed");
            if is_timeout {
                format!("请求超时（{}s），action={}", timeout_ms / 1000, action)
            } else {
                format!("网络请求失败（action={}, {}ms）: {}", action, elapsed, msg)
            }
        })?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("响应体读取失败（action={}）: {}", action, e))?;

    // 检测宝塔 WAF / nginx 错误页面
    if text.contains("宝塔WAF") || text.contains("缓冲区溢出") {
        return Err(format!(
            "服务器WAF拦截（action={}, HTTP {}）: 请求体过大，触发Nginx缓冲区溢出",
            action, status
        ));
    }

    // 解析 JSON
    let payload: Value = serde_json::from_str(&text).map_err(|e| {
        if !status.is_success() {
            format!(
                "HTTP {}（action={}）: 服务器返回非 JSON 响应",
                status, action
            )
        } else {
            format!("响应解析失败（action={}, HTTP {}）: {}", action, status, e)
        }
    })?;

    let code = payload.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
    let msg = payload.get("msg").and_then(|v| v.as_str()).unwrap_or("");
    let elapsed = start.elapsed().as_millis();

    println!(
        "[authed_request] action={}, code={}, msg=\"{}\", elapsed={}ms",
        action, code, msg, elapsed
    );

    if code != 200 {
        eprintln!(
            "[authed_request] ⚠ 接口返回非200: action={}, code={}, msg=\"{}\"",
            action, code, msg
        );
    }

    Ok(payload)
}

/// 保存认证凭证：token 存入 keyring，user JSON 存入文件。
#[tauri::command]
pub async fn save_auth_credentials(
    app_handle: AppHandle,
    token: String,
    user: Value,
) -> Result<(), String> {
    // token → keyring
    tauri::async_runtime::spawn_blocking(move || save_token_to_keyring(&token))
        .await
        .map_err(|e| format!("keyring 任务失败: {e}"))??;

    // user → 文件
    let user_path = user_file_path(&app_handle)?;
    let user_json =
        serde_json::to_string_pretty(&user).map_err(|e| format!("user 序列化失败: {e}"))?;
    fs::write(&user_path, user_json).map_err(|e| format!("user 文件写入失败: {e}"))?;

    Ok(())
}

/// 读取认证凭证：从 keyring 读取 token，从文件读取 user。
/// 返回 None 表示未登录。
#[tauri::command]
pub async fn get_auth_credentials(
    app_handle: AppHandle,
) -> Result<Option<AuthCredentials>, String> {
    // token ← keyring
    let token = tauri::async_runtime::spawn_blocking(|| read_token_from_keyring())
        .await
        .map_err(|e| format!("keyring 任务失败: {e}"))?;

    let Some(token) = token else {
        return Ok(None);
    };

    // user ← 文件
    let user_path = user_file_path(&app_handle)?;
    let user: Value = if user_path.exists() {
        let content =
            fs::read_to_string(&user_path).map_err(|e| format!("user 文件读取失败: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("user JSON 解析失败: {e}"))?
    } else {
        Value::Null
    };

    Ok(Some(AuthCredentials { token, user }))
}

/// 清除认证凭证：删除 keyring 中的 token 和 user 文件。
#[tauri::command]
pub async fn clear_auth_credentials(app_handle: AppHandle) -> Result<(), String> {
    // keyring
    tauri::async_runtime::spawn_blocking(|| delete_token_from_keyring())
        .await
        .map_err(|e| format!("keyring 任务失败: {e}"))??;

    // user 文件
    let user_path = user_file_path(&app_handle)?;
    if user_path.exists() {
        let _ = fs::remove_file(&user_path);
    }

    Ok(())
}

/// 设置 API 基地址（自定义服务器地址）。
#[tauri::command]
pub async fn set_auth_base_url(app_handle: AppHandle, base_url: String) -> Result<(), String> {
    let trimmed = base_url.trim();
    let url = if trimmed.is_empty() {
        DEFAULT_AUTH_BASE_URL.to_string()
    } else {
        trimmed.to_string()
    };

    let path = base_url_file_path(&app_handle)?;
    fs::write(&path, &url).map_err(|e| format!("base_url 文件写入失败: {e}"))?;
    Ok(())
}

/// 获取当前 API 基地址。
#[tauri::command]
pub async fn get_auth_base_url(app_handle: AppHandle) -> Result<String, String> {
    Ok(read_base_url(&app_handle))
}

/// 设置 API 签名密钥（自建服务器使用）。
#[tauri::command]
pub async fn set_auth_api_secret(app_handle: AppHandle, api_secret: String) -> Result<(), String> {
    let trimmed = api_secret.trim();
    let secret = if trimmed.is_empty() {
        DEFAULT_API_SECRET.to_string()
    } else {
        trimmed.to_string()
    };

    let path = api_secret_file_path(&app_handle)?;
    fs::write(&path, &secret).map_err(|e| format!("api_secret 文件写入失败: {e}"))?;
    Ok(())
}

/// 获取当前 API 签名密钥。
#[tauri::command]
pub async fn get_auth_api_secret(app_handle: AppHandle) -> Result<String, String> {
    Ok(read_api_secret(&app_handle))
}
