use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use rquickjs::{FromJs, Function, Promise, Value};
use tokio::sync::Mutex as AsyncMutex;

use super::misc::{engine_error_message, now_ms, promise_to_json, take_logs};
use super::runtime::{create_runtime, drive_js, js_thread, setup_context};
use super::{
    EngineLoadResult, EngineLog, PluginEngine, PluginEventEmitter, PluginKind, PluginInstance,
    HttpBridge, PluginStore,
};

const LOAD_TIMEOUT_MS: u64 = 30_000;

fn load_err(error: String) -> EngineLoadResult {
    EngineLoadResult {
        ok: false,
        error: Some(error),
        metadata: None,
        logs: Vec::new(),
    }
}

/// 池内加载产出：结果 + 成功时携带待登记的活实例部件。
struct PreparedLoad {
    result: EngineLoadResult,
    live: Option<PreparedLive>,
}

struct PreparedLive {
    runtime: rquickjs::AsyncRuntime,
    ctx: rquickjs::AsyncContext,
    deadline: Arc<AtomicI64>,
    logs: Arc<StdMutex<Vec<EngineLog>>>,
    current_call: Arc<AtomicU64>,
}

fn failed(result: EngineLoadResult) -> PreparedLoad {
    PreparedLoad { result, live: None }
}

async fn prepare_musicfree(
    http: Arc<HttpBridge>,
    store: Arc<PluginStore>,
    emitter: Option<PluginEventEmitter>,
    plugin_id: String,
    script: String,
    user_vars_json: String,
) -> PreparedLoad {
    let (runtime, ctx, deadline) = match create_runtime().await {
        Ok(x) => x,
        Err(e) => return failed(load_err(e)),
    };

    let logs = Arc::new(StdMutex::new(Vec::new()));
    let current_call = Arc::new(AtomicU64::new(0));

    deadline.store(now_ms() + LOAD_TIMEOUT_MS as i64, Ordering::Relaxed);

    let setup_result =
        setup_context(&http, &store, &emitter, &plugin_id, &ctx, &logs, &current_call).await;
    let load_json: Result<String, String> = match setup_result {
        Err(e) => Err(e),
        Ok(()) => {
            let outcome = tokio::time::timeout(
                Duration::from_millis(LOAD_TIMEOUT_MS + 2000),
                ctx.async_with(async |ctx| -> Result<String, String> {
                    let globals = ctx.globals();
                    let inner: rquickjs::Result<String> = (|| {
                        let load: Function = globals.get("__xyLoadMusicFree")?;
                        load.call((script.as_str(), user_vars_json.as_str()))
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
    // 失败（尤其外层超时）时池内任务可能仍持有 ctx 在跑 JS：置过期 deadline
    // 让中断处理器尽快掐断；成功路径照常解除。
    deadline.store(if load_json.is_err() { 1 } else { 0 }, Ordering::Relaxed);

    let json = match load_json {
        Ok(json) => json,
        Err(e) => return failed(load_err(e)),
    };

    let parsed = match serde_json::from_str::<serde_json::Value>(&json) {
        Ok(v) => v,
        Err(e) => {
            return failed(EngineLoadResult {
                ok: false,
                error: Some(format!("插件加载结果解析失败: {}", e)),
                metadata: None,
                logs: take_logs(&logs, 0),
            })
        }
    };

    if parsed.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
        let metadata = parsed
            .get("metadata")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        PreparedLoad {
            result: EngineLoadResult {
                ok: true,
                error: None,
                metadata: Some(metadata),
                logs: take_logs(&logs, 0),
            },
            live: Some(PreparedLive {
                runtime,
                ctx,
                deadline,
                logs,
                current_call,
            }),
        }
    } else {
        let error = parsed
            .get("error")
            .and_then(|x| x.as_str())
            .unwrap_or("插件加载失败")
            .to_string();
        PreparedLoad {
            result: EngineLoadResult {
                ok: false,
                error: Some(error),
                metadata: None,
                logs: take_logs(&logs, 0),
            },
            live: None,
        }
    }
}

async fn prepare_lx(
    http: Arc<HttpBridge>,
    store: Arc<PluginStore>,
    emitter: Option<PluginEventEmitter>,
    plugin_id: String,
    script: String,
    script_info_json: String,
) -> PreparedLoad {
    let (runtime, ctx, deadline) = match create_runtime().await {
        Ok(x) => x,
        Err(e) => return failed(load_err(e)),
    };

    let logs = Arc::new(StdMutex::new(Vec::new()));
    let current_call = Arc::new(AtomicU64::new(0));

    deadline.store(now_ms() + LOAD_TIMEOUT_MS as i64, Ordering::Relaxed);

    let setup_result =
        setup_context(&http, &store, &emitter, &plugin_id, &ctx, &logs, &current_call).await;
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
                            setup.call((script_info_json.as_str(), script.as_str()))?;
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
    // 同 prepare_musicfree：失败时掐断仍在跑的 JS
    deadline.store(if load_json.is_err() { 1 } else { 0 }, Ordering::Relaxed);

    let json = match load_json {
        Ok(json) => json,
        Err(e) => return failed(load_err(e)),
    };

    let parsed = match serde_json::from_str::<serde_json::Value>(&json) {
        Ok(v) => v,
        Err(e) => {
            return failed(EngineLoadResult {
                ok: false,
                error: Some(format!("LX 插件初始化结果解析失败: {}", e)),
                metadata: None,
                logs: take_logs(&logs, 0),
            })
        }
    };

    if parsed.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
        let metadata = parsed
            .get("initInfo")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        PreparedLoad {
            result: EngineLoadResult {
                ok: true,
                error: None,
                metadata: Some(metadata),
                logs: take_logs(&logs, 0),
            },
            live: Some(PreparedLive {
                runtime,
                ctx,
                deadline,
                logs,
                current_call,
            }),
        }
    } else {
        let error = parsed
            .get("error")
            .and_then(|x| x.as_str())
            .unwrap_or("LX 插件初始化失败")
            .to_string();
        PreparedLoad {
            result: EngineLoadResult {
                ok: false,
                error: Some(error),
                metadata: None,
                logs: take_logs(&logs, 0),
            },
            live: None,
        }
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

        // JS 必须在专用大栈线程上执行（见 runtime.rs js_thread 注释）；
        // drive_js 要求 'static future，共享组件与脚本全部按值捕获。
        let prepared = drive_js(prepare_musicfree(
            self.http.clone(),
            self.store.clone(),
            self.emitter.clone(),
            plugin_id.to_string(),
            script.to_string(),
            user_vars_json.to_string(),
        ))
        .await;

        match prepared {
            Ok(p) => {
                if p.result.ok {
                    let live = p.live.expect("ok load carries live parts");
                    let metadata = p.result.metadata.clone().unwrap_or(serde_json::Value::Null);
                    let instance = Arc::new(PluginInstance {
                        id: plugin_id.to_string(),
                        kind: PluginKind::MusicFree,
                        metadata,
                        ctx: live.ctx,
                        runtime: live.runtime,
                        deadline_ms: live.deadline,
                        call_seq: Arc::new(AtomicU64::new(0)),
                        current_call: live.current_call,
                        logs: live.logs,
                        call_lock: AsyncMutex::new(()),
                    });
                    self.instances
                        .lock()
                        .await
                        .insert(plugin_id.to_string(), instance);
                }
                p.result
            }
            Err(e) => load_err(e),
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

        let prepared = drive_js(prepare_lx(
            self.http.clone(),
            self.store.clone(),
            self.emitter.clone(),
            plugin_id.to_string(),
            script.to_string(),
            script_info_json.to_string(),
        ))
        .await;

        match prepared {
            Ok(p) => {
                if p.result.ok {
                    let live = p.live.expect("ok load carries live parts");
                    let metadata = p.result.metadata.clone().unwrap_or(serde_json::Value::Null);
                    // 先克隆驱动句柄，runtime 本体 move 进实例
                    let rt_handle = live.runtime.clone();
                    let instance = Arc::new(PluginInstance {
                        id: plugin_id.to_string(),
                        kind: PluginKind::Lx,
                        metadata,
                        ctx: live.ctx,
                        runtime: live.runtime,
                        deadline_ms: live.deadline,
                        call_seq: Arc::new(AtomicU64::new(0)),
                        current_call: live.current_call,
                        logs: live.logs,
                        call_lock: AsyncMutex::new(()),
                    });
                    self.instances
                        .lock()
                        .await
                        .insert(plugin_id.to_string(), instance);
                    // runtime 即将 move 进实例，先克隆句柄用于常驻驱动。
                    // LX 脚本常在 init 后经 setTimeout/异步 HTTP 自调 checkUpdate()
                    // 或 send(updateAlert)；idle() 会在 executor 首次 Empty 时提前
                    // 返回（setTimeout 的 continuation 往往尚未注册），后续任务无人
                    // 驱动。drive() 持续驱动直到 runtime 随实例销毁 drop，生命周期
                    // 天然对齐，无需超时兜底。必须在 JS 线程上驱动（栈预算按执行
                    // 线程划定）。
                    let _ = js_thread().spawn(async move {
                        rt_handle.drive().await;
                    });
                }
                p.result
            }
            Err(e) => load_err(e),
        }
    }

    pub async fn unload(&self, plugin_id: &str) {
        self.destroy(plugin_id).await;
    }
}
