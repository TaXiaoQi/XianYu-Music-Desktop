use keyring::Entry;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const DEFAULT_API_SECRET: &str = "acca7562ecaf830fcce45814f110eacea83ecf9cf52320c3";

const OFFICIAL_AUTH_BASE_URL: &str = "https://api.xianyumusic.cn/api";

const DEFAULT_AUTH_BASE_URL: &str = OFFICIAL_AUTH_BASE_URL;

const KEYRING_SERVICE: &str = "xianyu-music";
const KEYRING_ACCOUNT: &str = "auth-token";

const DEFAULT_FETCH_TIMEOUT_MS: u64 = 40_000;

const TIME_OFFSET_FILE: &str = "time_offset.txt";

static HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

fn http_client() -> &'static Result<reqwest::Client, String> {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(crate::security::ssrf::ip_literal_redirect_policy())
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
    })
}

struct SignedHeaders {
    timestamp: String,
    nonce: String,
    sign: String,
}

fn generate_nonce() -> String {
    let bytes = uuid::Uuid::new_v4().as_simple().to_string();
    bytes
}

fn build_signed_headers(body: &str, api_secret: &str, timestamp: i64) -> SignedHeaders {
    use hmac::Mac;
    let nonce = generate_nonce();
    let mut mac =
        hmac::Hmac::<sha2::Sha256>::new_from_slice(api_secret.as_bytes()).expect("HMAC key");
    mac.update(format!("{}{}{}", timestamp, nonce, body).as_bytes());
    let sign = hex::encode(mac.finalize().into_bytes());
    SignedHeaders {
        timestamp: timestamp.to_string(),
        nonce,
        sign,
    }
}

fn local_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn parse_http_date(s: &str) -> Option<i64> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let b = s.as_bytes();
    if b.len() < 29 {
        return None;
    }
    let day: i64 = s.get(5..7)?.trim().parse().ok()?;
    let month_part = s.get(8..11)?;
    let mon = MONTHS
        .iter()
        .position(|m| month_part.eq_ignore_ascii_case(m))? as i64;
    let year: i64 = s.get(12..16)?.parse().ok()?;
    let mut t = s.get(17..25)?.split(':');
    let hour: i64 = t.next()?.parse().ok()?;
    let min: i64 = t.next()?.parse().ok()?;
    let sec: i64 = t.next()?.parse().ok()?;
    if !(1..=31).contains(&day)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&min)
        || !(0..=60).contains(&sec)
    {
        return None;
    }
    Some(days_from_civil(year, mon + 1, day) * 86400 + hour * 3600 + min * 60 + sec)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn auth_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("auth");
    fs::create_dir_all(&dir).map_err(|e| format!("创建 auth 目录失败: {e}"))?;
    Ok(dir)
}

fn user_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(auth_data_dir(app)?.join("user.json"))
}

fn time_offset_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(auth_data_dir(app)?.join(TIME_OFFSET_FILE))
}

fn read_time_offset(app: &AppHandle) -> i64 {
    time_offset_file_path(app)
        .ok()
        .filter(|path| path.exists())
        .and_then(|path| fs::read_to_string(&path).ok())
        .and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(0)
}

fn save_time_offset(app: &AppHandle, offset: i64) {
    if let Ok(path) = time_offset_file_path(app) {
        let _ = fs::write(&path, offset.to_string());
    }
}

fn base_url_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(auth_data_dir(app)?.join("base_url.txt"))
}

fn api_secret_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(auth_data_dir(app)?.join("api_secret.txt"))
}

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
                let upgraded = saved
                    .replace("http://back.xymusic.cc", "https://api.xianyumusic.cn")
                    .replace("https://back.xymusic.cc", "https://api.xianyumusic.cn");
                if upgraded != saved {
                    let _ = fs::write(&path, &upgraded);
                }
                upgraded
            } else {
                DEFAULT_AUTH_BASE_URL.to_string()
            }
        }
        Err(_) => DEFAULT_AUTH_BASE_URL.to_string(),
    }
}

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

fn read_token_from_keyring() -> Option<String> {
    match Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => entry.get_password().ok(),
        Err(_) => None,
    }
}

fn save_token_to_keyring(token: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("keyring 创建失败: {e}"))?;
    entry
        .set_password(token)
        .map_err(|e| format!("keyring 写入失败: {e}"))
}

fn delete_token_from_keyring() -> Result<(), String> {
    match Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(_) => Ok(()),
        },
        Err(e) => Err(format!("keyring 创建失败: {e}")),
    }
}

#[derive(Serialize)]
pub struct AuthCredentials {
    pub token: String,
    pub user: Value,
}

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

    do_signed_post(
        &app_handle,
        &url,
        &action,
        body,
        fetch_timeout_ms,
        &api_secret,
    )
    .await
}

async fn do_signed_post(
    app: &AppHandle,
    url: &str,
    action: &str,
    body: Value,
    fetch_timeout_ms: Option<u64>,
    api_secret: &str,
) -> Result<Value, String> {
    let body_str = serde_json::to_string(&body).unwrap_or_default();
    let timeout_ms = fetch_timeout_ms.unwrap_or(DEFAULT_FETCH_TIMEOUT_MS);
    let client = http_client().as_ref().map_err(|e| e.clone())?;
    let mut offset = read_time_offset(app);

    for attempt in 0..2 {
        let headers = build_signed_headers(&body_str, api_secret, local_now_secs() + offset);
        let start = std::time::Instant::now();

        let response = match client
            .post(url)
            .timeout(Duration::from_millis(timeout_ms))
            .header("Content-Type", "application/json")
            .header("X-Timestamp", &headers.timestamp)
            .header("X-Nonce", &headers.nonce)
            .header("X-Sign", &headers.sign)
            .body(body_str.clone())
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                if attempt == 0 {
                    continue;
                }
                let elapsed = start.elapsed().as_millis();
                let msg = e.to_string();
                let is_timeout = msg.contains("timeout") || msg.contains("elapsed");
                return Err(if is_timeout {
                    format!("请求超时（{}s），action={}", timeout_ms / 1000, action)
                } else {
                    format!("网络请求失败（action={}, {}ms）: {}", action, elapsed, msg)
                });
            }
        };

        let status = response.status();
        let date_header = response
            .headers()
            .get(reqwest::header::DATE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let text = response
            .text()
            .await
            .map_err(|e| format!("响应体读取失败（action={}）: {}", action, e))?;

        if let Some(server_secs) = date_header.as_deref().and_then(parse_http_date) {
            let new_offset = server_secs - local_now_secs();
            if (new_offset - offset).abs() >= 3 {
                offset = new_offset;
                save_time_offset(app, offset);
            }
        }

        if attempt == 0 && status.as_u16() == 403 && text.contains("签名验证失败") {
            continue;
        }

        if text.contains("宝塔WAF") || text.contains("缓冲区溢出") {
            return Err(format!(
                "服务器WAF拦截（action={}, HTTP {}）: 请求体过大，触发Nginx缓冲区溢出",
                action, status
            ));
        }

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
        return Ok(payload);
    }
    unreachable!("重试循环两次尝试内必然返回")
}

#[tauri::command]
pub async fn save_auth_credentials(
    app_handle: AppHandle,
    token: String,
    user: Value,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_token_to_keyring(&token))
        .await
        .map_err(|e| format!("keyring 任务失败: {e}"))??;

    let user_path = user_file_path(&app_handle)?;
    let user_json =
        serde_json::to_string_pretty(&user).map_err(|e| format!("user 序列化失败: {e}"))?;
    fs::write(&user_path, user_json).map_err(|e| format!("user 文件写入失败: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn get_auth_credentials(
    app_handle: AppHandle,
) -> Result<Option<AuthCredentials>, String> {
    let token = tauri::async_runtime::spawn_blocking(|| read_token_from_keyring())
        .await
        .map_err(|e| format!("keyring 任务失败: {e}"))?;

    let Some(token) = token else {
        return Ok(None);
    };

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

#[tauri::command]
pub async fn clear_auth_credentials(app_handle: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| delete_token_from_keyring())
        .await
        .map_err(|e| format!("keyring 任务失败: {e}"))??;

    let user_path = user_file_path(&app_handle)?;
    if user_path.exists() {
        let _ = fs::remove_file(&user_path);
    }

    Ok(())
}

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

#[tauri::command]
pub async fn get_auth_base_url(app_handle: AppHandle) -> Result<String, String> {
    Ok(read_base_url(&app_handle))
}

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

#[tauri::command]
pub async fn get_auth_api_secret(app_handle: AppHandle) -> Result<String, String> {
    let secret = read_api_secret(&app_handle);
    Ok(if secret == DEFAULT_API_SECRET {
        String::new()
    } else {
        secret
    })
}

#[cfg(test)]
mod time_calibrate_tests {
    use super::*;

    #[test]
    fn parse_http_date_standard() {
        let secs = parse_http_date("Thu, 10 Sep 2026 06:34:48 GMT").expect("应解析成功");
        let local = local_now_secs();
        assert!((secs - local).abs() < 86_400);
        assert_eq!(secs, 1789022088);
    }

    #[test]
    fn parse_http_date_invalid() {
        assert!(parse_http_date("").is_none());
        assert!(parse_http_date("short").is_none());
        assert!(parse_http_date("Thu, Foo Sep 2026 06:34:48 GMT").is_none());
        assert!(parse_http_date("Thu, 10 Sep 2026 06:34:48").is_none());
        assert!(parse_http_date("Thu, 32 Sep 2026 06:34:48 GMT").is_none());
    }

    #[test]
    fn days_from_civil_epoch() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11017);
        assert_eq!(days_from_civil(2026, 9, 10), 20706);
    }

    #[test]
    fn offset_sign_semantics() {
        let local = local_now_secs();
        let server = local + 600;
        assert_eq!(local + (server - local), server);
    }
}
