use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use rquickjs::{FromJs, Function, Promise, Value};
use tokio::sync::Mutex as AsyncMutex;

use super::misc::{engine_error_message, now_ms, promise_to_json, take_logs};
use super::{EngineLoadResult, PluginEngine, PluginKind, PluginInstance};

const LOAD_TIMEOUT_MS: u64 = 30_000;

fn load_err(error: String) -> EngineLoadResult {
    EngineLoadResult {
        ok: false,
        error: Some(error),
        metadata: None,
        logs: Vec::new(),
    }
}

impl PluginEngine {
    pub async fn load_musicfree(
        &self,
        plugin_id: &str,
        script: &str,
        user_vars_json: &str,
    ) -> EngineLoadResult {
        self.destroy(plugin_id).await;

        if script.trim().is_empty() {
            return load_err("插件内容为空".to_string());
        }

        let (runtime, ctx, deadline) = match self.create_runtime().await {
            Ok(x) => x,
            Err(e) => return load_err(e),
        };

        let logs = Arc::new(StdMutex::new(Vec::new()));
        let current_call = Arc::new(AtomicU64::new(0));

        deadline.store(now_ms() + LOAD_TIMEOUT_MS as i64, Ordering::Relaxed);
        let script_owned = script.to_string();
        let user_vars_owned = user_vars_json.to_string();

        let setup_result = self.setup_context(plugin_id, &ctx, &logs, &current_call).await;
        let load_json: Result<String, String> = match setup_result {
            Err(e) => Err(e),
            Ok(()) => {
                let outcome = tokio::time::timeout(
                    Duration::from_millis(LOAD_TIMEOUT_MS + 2000),
                    ctx.async_with(async |ctx| -> Result<String, String> {
                        let globals = ctx.globals();
                        let inner: rquickjs::Result<String> = (|| {
                            let load: Function = globals.get("__xyLoadMusicFree")?;
                            load.call((script_owned.as_str(), user_vars_owned.as_str()))
                        })();
                        inner.map_err(|e| engine_error_message(&ctx, &e))
                    }),
                )
                .await;
                match outcome {
                    Err(_) => Err("插件加载超时(30s)".to_string()),
                    Ok(Err(e)) => Err(e),
                    Ok(Ok(json)) => Ok(json),
                }
            }
        };
        deadline.store(0, Ordering::Relaxed);

        let json = match load_json {
            Ok(json) => json,
            Err(e) => return load_err(e),
        };

        let parsed = match serde_json::from_str::<serde_json::Value>(&json) {
            Ok(v) => v,
            Err(e) => {
                return EngineLoadResult {
                    ok: false,
                    error: Some(format!("插件加载结果解析失败: {}", e)),
                    metadata: None,
                    logs: take_logs(&logs, 0),
                }
            }
        };

        if parsed.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
            let metadata = parsed
                .get("metadata")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let instance = Arc::new(PluginInstance {
                id: plugin_id.to_string(),
                kind: PluginKind::MusicFree,
                metadata: metadata.clone(),
                ctx,
                runtime,
                deadline_ms: deadline,
                call_seq: Arc::new(AtomicU64::new(0)),
                current_call,
                logs: logs.clone(),
                call_lock: AsyncMutex::new(()),
            });
            self.instances
                .lock()
                .await
                .insert(plugin_id.to_string(), instance);
            EngineLoadResult {
                ok: true,
                error: None,
                metadata: Some(metadata),
                logs: take_logs(&logs, 0),
            }
        } else {
            let error = parsed
                .get("error")
                .and_then(|x| x.as_str())
                .unwrap_or("插件加载失败")
                .to_string();
            EngineLoadResult {
                ok: false,
                error: Some(error),
                metadata: None,
                logs: take_logs(&logs, 0),
            }
        }
    }

    pub async fn load_lx(
        &self,
        plugin_id: &str,
        script: &str,
        script_info_json: &str,
    ) -> EngineLoadResult {
        self.destroy(plugin_id).await;

        if script.trim().is_empty() {
            return load_err("插件内容为空".to_string());
        }

        let (runtime, ctx, deadline) = match self.create_runtime().await {
            Ok(x) => x,
            Err(e) => return load_err(e),
        };

        let logs = Arc::new(StdMutex::new(Vec::new()));
        let current_call = Arc::new(AtomicU64::new(0));

        deadline.store(now_ms() + LOAD_TIMEOUT_MS as i64, Ordering::Relaxed);
        let script_owned = script.to_string();
        let script_info_owned = script_info_json.to_string();

        let setup_result = self.setup_context(plugin_id, &ctx, &logs, &current_call).await;
        let load_json: Result<String, String> = match setup_result {
            Err(e) => Err(e),
            Ok(()) => {
                let outcome = tokio::time::timeout(
                    Duration::from_millis(LOAD_TIMEOUT_MS + 2000),
                    ctx.async_with(async |ctx| -> Result<String, String> {
                        let globals = ctx.globals();
                        let inner: rquickjs::Result<Option<String>> = (|| {
                            let setup: Function = globals.get("__xySetupLx")?;
                            let setup_result: Value =
                                setup.call((script_info_owned.as_str(), script_owned.as_str()))?;
                            if !setup_result.is_null() && !setup_result.is_undefined() {
                                let s = rquickjs::String::from_js(&ctx, setup_result)?;
                                return Ok(Some(s.to_string()?));
                            }
                            Ok(None)
                        })();
                        match inner {
                            Err(e) => return Err(engine_error_message(&ctx, &e)),
                            Ok(Some(json)) => return Ok(json),
                            Ok(None) => {}
                        }
                        let init_promise: Promise = match globals.get("__xyLxInitPromise") {
                            Ok(p) => p,
                            Err(e) => return Err(engine_error_message(&ctx, &e)),
                        };
                        promise_to_json(&ctx, init_promise)
                            .await
                            .map_err(|e| engine_error_message(&ctx, &e))
                    }),
                )
                .await;
                match outcome {
                    Err(_) => Err("LX 插件初始化超时(30s)".to_string()),
                    Ok(Err(e)) => Err(e),
                    Ok(Ok(json)) => Ok(json),
                }
            }
        };
        deadline.store(0, Ordering::Relaxed);

        let json = match load_json {
            Ok(json) => json,
            Err(e) => return load_err(e),
        };

        let parsed = match serde_json::from_str::<serde_json::Value>(&json) {
            Ok(v) => v,
            Err(e) => {
                return EngineLoadResult {
                    ok: false,
                    error: Some(format!("LX 插件初始化结果解析失败: {}", e)),
                    metadata: None,
                    logs: take_logs(&logs, 0),
                }
            }
        };

        if parsed.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
            let metadata = parsed
                .get("initInfo")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            // LX 脚本常在 init 中自调 checkUpdate()（异步 HTTP），其响应往往在
            // send(inited) 之后才到达；届时 load 已返回、无人驱动 executor，
            // 需后台驱动至挂起任务落定（上限 20s，防止脚本请求悬挂拖住运行时）。
            let rt_handle = runtime.clone();
            let instance = Arc::new(PluginInstance {
                id: plugin_id.to_string(),
                kind: PluginKind::Lx,
                metadata: metadata.clone(),
                ctx,
                runtime,
                deadline_ms: deadline,
                call_seq: Arc::new(AtomicU64::new(0)),
                current_call,
                logs: logs.clone(),
                call_lock: AsyncMutex::new(()),
            });
            self.instances
                .lock()
                .await
                .insert(plugin_id.to_string(), instance);
            tokio::spawn(async move {
                let _ = tokio::time::timeout(Duration::from_secs(20), rt_handle.idle()).await;
            });
            EngineLoadResult {
                ok: true,
                error: None,
                metadata: Some(metadata),
                logs: take_logs(&logs, 0),
            }
        } else {
            let error = parsed
                .get("error")
                .and_then(|x| x.as_str())
                .unwrap_or("LX 插件初始化失败")
                .to_string();
            EngineLoadResult {
                ok: false,
                error: Some(error),
                metadata: None,
                logs: take_logs(&logs, 0),
            }
        }
    }

    pub async fn unload(&self, plugin_id: &str) {
        self.destroy(plugin_id).await;
    }
}
