use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use rquickjs::function::Async;
use rquickjs::{Ctx, Exception, Function};

use super::misc::{deflate_bytes, inflate_bytes, json_error};
use super::{EngineLog, HttpBridge, PluginEventEmitter, PluginStore, PLUGIN_LX_UPDATE_ALERT_EVENT};

const MAX_LOG_ENTRIES: usize = 2000;

// ==================== 原生桥注册 ====================

pub(super) fn register_bridges<'js>(
    ctx: &Ctx<'js>,
    http: &Arc<HttpBridge>,
    store: &Arc<PluginStore>,
    logs: &Arc<StdMutex<Vec<EngineLog>>>,
    current_call: &Arc<AtomicU64>,
    update_alert: &Option<(String, PluginEventEmitter)>,
) -> rquickjs::Result<()> {
    let globals = ctx.globals();

    // ---- __xyNativeLog(level, message) 同步 ----
    {
        let logs = logs.clone();
        let current_call = current_call.clone();
        let f = Function::new(ctx.clone(), move |level: String, message: String| {
            let call_id = current_call.load(Ordering::Relaxed);
            let mut guard = logs.lock().unwrap();
            if guard.len() < MAX_LOG_ENTRIES {
                guard.push(EngineLog {
                    level,
                    message,
                    call_id,
                });
            }
        })?;
        globals.set("__xyNativeLog", f)?;
    }

    // ---- __xyNativeDelay(ms) 异步 ----
    {
        let f = Function::new(
            ctx.clone(),
            Async(|ms: f64| async move {
                let ms = if ms.is_finite() && ms > 0.0 {
                    ms.min(120_000.0)
                } else {
                    0.0
                };
                if ms >= 1.0 {
                    tokio::time::sleep(Duration::from_millis(ms as u64)).await;
                }
                Ok::<(), rquickjs::Error>(())
            }),
        )?;
        globals.set("__xyNativeDelay", f)?;
    }

    // ---- __xyNativeRandomBytes(n) -> base64 同步 ----
    {
        let f = Function::new(
            ctx.clone(),
            move |ctx: Ctx, n: f64| -> rquickjs::Result<String> {
                let n = if n.is_finite() && n > 0.0 {
                    n.min(65_536.0) as usize
                } else {
                    0
                };
                let mut buf = vec![0u8; n];
                getrandom::fill(&mut buf)
                    .map_err(|e| Exception::throw_message(&ctx, &format!("random: {}", e)))?;
                Ok(general_purpose::STANDARD.encode(&buf))
            },
        )?;
        globals.set("__xyNativeRandomBytes", f)?;
    }

    // ---- __xyNativeInflate / __xyNativeDeflate(method, base64) -> base64 同步 ----
    {
        let f = Function::new(
            ctx.clone(),
            move |ctx: Ctx, method: String, data_b64: String| -> rquickjs::Result<String> {
                let data = general_purpose::STANDARD
                    .decode(data_b64.as_bytes())
                    .map_err(|e| Exception::throw_message(&ctx, &format!("inflate: {}", e)))?;
                inflate_bytes(&method, &data)
                    .map_err(|e| Exception::throw_message(&ctx, &e))
                    .map(|out| general_purpose::STANDARD.encode(out))
            },
        )?;
        globals.set("__xyNativeInflate", f)?;
    }
    {
        let f = Function::new(
            ctx.clone(),
            move |ctx: Ctx, method: String, data_b64: String| -> rquickjs::Result<String> {
                let data = general_purpose::STANDARD
                    .decode(data_b64.as_bytes())
                    .map_err(|e| Exception::throw_message(&ctx, &format!("deflate: {}", e)))?;
                deflate_bytes(&method, &data)
                    .map_err(|e| Exception::throw_message(&ctx, &e))
                    .map(|out| general_purpose::STANDARD.encode(out))
            },
        )?;
        globals.set("__xyNativeDeflate", f)?;
    }

    // ---- __xyNativeDecodeText(base64, label) -> string 同步（浏览器 TextDecoder 语义）----
    {
        let f = Function::new(
            ctx.clone(),
            move |ctx: Ctx, data_b64: String, label: String| -> rquickjs::Result<String> {
                let data = general_purpose::STANDARD
                    .decode(data_b64.as_bytes())
                    .map_err(|e| Exception::throw_message(&ctx, &format!("decodeText: {}", e)))?;
                let encoding =
                    encoding_rs::Encoding::for_label(label.as_bytes()).ok_or_else(|| {
                        Exception::throw_message(
                            &ctx,
                            &format!("The encoding label provided ('{label}') is invalid."),
                        )
                    })?;
                let (text, _, _) = encoding.decode(&data);
                Ok(text.into_owned())
            },
        )?;
        globals.set("__xyNativeDecodeText", f)?;
    }

    // ---- __xyNativeHttpRequest 异步 ----
    {
        let http = http.clone();
        let f = Function::new(
            ctx.clone(),
            Async(
                move |method: String,
                      url: String,
                      headers_json: String,
                      body: String,
                      timeout_ms: f64,
                      follow: f64,
                      want_binary: bool| {
                    let http = http.clone();
                    async move {
                        let headers: HashMap<String, String> =
                            serde_json::from_str(&headers_json).unwrap_or_default();
                        let timeout_ms = if timeout_ms.is_finite() && timeout_ms > 0.0 {
                            timeout_ms as u64
                        } else {
                            0
                        };
                        let follow = if follow.is_finite() {
                            follow as i64
                        } else {
                            -1
                        };
                        let body = if body.is_empty() { None } else { Some(body) };
                        let resp = http
                            .request(
                                &method,
                                &url,
                                headers,
                                body,
                                timeout_ms,
                                follow,
                                want_binary,
                            )
                            .await;
                        let json = serde_json::to_string(&resp)
                            .unwrap_or_else(|_| "{\"error\":\"响应序列化失败\"}".to_string());
                        Ok::<String, rquickjs::Error>(json)
                    }
                },
            ),
        )?;
        globals.set("__xyNativeHttpRequest", f)?;
    }

    // ---- Cookie 桥（异步，返回 {ok,data/error} JSON）----
    {
        let store = store.clone();
        let f = Function::new(
            ctx.clone(),
            Async(move |url: String, cookie_json: String| {
                let store = store.clone();
                async move {
                    let payload = match serde_json::from_str::<serde_json::Value>(&cookie_json) {
                        Ok(v) => v,
                        Err(e) => {
                            return Ok::<String, rquickjs::Error>(json_error(&e.to_string()));
                        }
                    };
                    let name = payload.get("name").and_then(|x| x.as_str()).unwrap_or("");
                    let value = payload.get("value").and_then(|x| x.as_str()).unwrap_or("");
                    let domain = payload.get("domain").and_then(|x| x.as_str());
                    let ok = store.set_cookie(&url, name, value, domain);
                    Ok::<String, rquickjs::Error>(json_ok_bool(ok))
                }
            }),
        )?;
        globals.set("__xyNativeCookieSet", f)?;
    }
    {
        let store = store.clone();
        let f = Function::new(
            ctx.clone(),
            Async(move |url: String| {
                let store = store.clone();
                async move {
                    let cookies = store.get_cookies_for_url(&url);
                    let json = serde_json::to_string(&cookies).unwrap_or_else(|_| "{}".to_string());
                    Ok::<String, rquickjs::Error>(format!("{{\"ok\":true,\"data\":{}}}", json))
                }
            }),
        )?;
        globals.set("__xyNativeCookieGet", f)?;
    }
    {
        let f = Function::new(
            ctx.clone(),
            Async(|| async move { Ok::<String, rquickjs::Error>("{\"ok\":true}".to_string()) }),
        )?;
        globals.set("__xyNativeCookieFlush", f)?;
    }

    // ---- Storage 桥 ----
    {
        let store = store.clone();
        let f = Function::new(
            ctx.clone(),
            Async(move |key: String, raw: String| {
                let store = store.clone();
                async move {
                    store.storage_set(&key, &raw);
                    Ok::<String, rquickjs::Error>("{\"ok\":true}".to_string())
                }
            }),
        )?;
        globals.set("__xyNativeStorageSet", f)?;
    }
    {
        let store = store.clone();
        let f = Function::new(
            ctx.clone(),
            Async(move |key: String| {
                let store = store.clone();
                async move {
                    let value = store.storage_get(&key);
                    let json = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
                    Ok::<String, rquickjs::Error>(format!("{{\"ok\":true,\"data\":{}}}", json))
                }
            }),
        )?;
        globals.set("__xyNativeStorageGet", f)?;
    }
    {
        let store = store.clone();
        let f = Function::new(
            ctx.clone(),
            Async(move |key: String| {
                let store = store.clone();
                async move {
                    store.storage_remove(&key);
                    Ok::<String, rquickjs::Error>("{\"ok\":true}".to_string())
                }
            }),
        )?;
        globals.set("__xyNativeStorageRemove", f)?;
    }

    // ---- __xyNativeUpdateAlert(json) 同步（LX 插件自报更新出口）----
    // shim 已完成 LX 语义校验（log 必填/截断、updateUrl 格式），此处打包 pluginId
    // 并经 emitter 推给宿主前端展示更新提示；未配置 emitter 时静默忽略。
    {
        let update_alert = update_alert.clone();
        let f = Function::new(
            ctx.clone(),
            move |json: String| -> rquickjs::Result<()> {
                if let Some((plugin_id, emitter)) = &update_alert {
                    let value: serde_json::Value =
                        serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
                    let payload = serde_json::json!({
                        "pluginId": plugin_id,
                        "log": value.get("log").and_then(|x| x.as_str()).unwrap_or(""),
                        "updateUrl": value.get("updateUrl").and_then(|x| x.as_str()),
                    });
                    emitter(PLUGIN_LX_UPDATE_ALERT_EVENT, payload);
                }
                Ok(())
            },
        )?;
        globals.set("__xyNativeUpdateAlert", f)?;
    }

    Ok(())
}

fn json_ok_bool(data: bool) -> String {
    format!("{{\"ok\":true,\"data\":{}}}", data)
}
