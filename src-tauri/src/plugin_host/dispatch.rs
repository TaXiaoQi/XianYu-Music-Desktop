use std::sync::atomic::Ordering;
use std::time::Duration;

use rquickjs::function::This;
use rquickjs::{Function, Promise};

use super::misc::{engine_error_message, now_ms, promise_to_json, take_logs};
use super::{EngineCallResult, EngineLog, PluginEngine, PluginKind};

fn call_err(error: String, logs: Vec<EngineLog>) -> EngineCallResult {
    EngineCallResult {
        ok: false,
        error: Some(error),
        data: None,
        logs,
    }
}

fn chain_result_serialization<'js>(
    globals: &rquickjs::Object<'js>,
    promise: Promise<'js>,
) -> rquickjs::Result<Promise<'js>> {
    let ok_fn: Function = globals.get("__xyOk")?;
    let err_fn: Function = globals.get("__xyErr")?;
    let then: Function = promise.then()?;
    then.call((This(promise), ok_fn, err_fn))
}

fn extract_first_arg(args_json: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(args_json) {
        Ok(serde_json::Value::Array(items)) => match items.into_iter().next() {
            Some(first) => first.to_string(),
            None => "null".to_string(),
        },
        _ => args_json.to_string(),
    }
}

impl PluginEngine {
    pub async fn call(
        &self,
        plugin_id: &str,
        method: &str,
        args_json: &str,
        user_vars_json: Option<&str>,
        timeout_ms: u64,
    ) -> EngineCallResult {
        let instance = {
            let instances = self.instances.lock().await;
            match instances.get(plugin_id) {
                Some(i) => i.clone(),
                None => return call_err(format!("插件实例不存在: {}", plugin_id), Vec::new()),
            }
        };

        let _guard = instance.call_lock.lock().await;

        let call_id = instance.call_seq.fetch_add(1, Ordering::Relaxed) + 1;
        instance.current_call.store(call_id, Ordering::Relaxed);
        let timeout_ms = if timeout_ms == 0 { 30_000 } else { timeout_ms };
        instance
            .deadline_ms
            .store(now_ms() + timeout_ms as i64, Ordering::Relaxed);

        let method_owned = method.to_string();
        let args_owned = args_json.to_string();
        let user_vars_owned = user_vars_json.map(|s| s.to_string());
        let kind = instance.kind;

        let outcome = tokio::time::timeout(
            Duration::from_millis(timeout_ms + 2000),
            instance
                .ctx
                .async_with(async |ctx| -> Result<String, String> {
                    let globals = ctx.globals();
                    let inner: rquickjs::Result<Promise> = (|| match kind {
                        PluginKind::MusicFree => {
                            if let Some(vars) = &user_vars_owned {
                                let set_vars: Function = globals.get("__xySetUserVars")?;
                                set_vars.call::<_, ()>((vars.as_str(),))?;
                            }
                            let call_fn: Function = globals.get("__xyCallMusicFree")?;
                            Ok(call_fn.call((method_owned.as_str(), args_owned.as_str()))?)
                        }
                        PluginKind::Lx => {
                            let data_json = extract_first_arg(&args_owned);
                            let call_fn: Function = globals.get("__xyLxRequest")?;
                            Ok(call_fn.call((data_json.as_str(),))?)
                        }
                    })();
                    let promise = match inner {
                        Ok(p) => p,
                        Err(e) => return Err(engine_error_message(&ctx, &e)),
                    };
                    let chained = match chain_result_serialization(&globals, promise) {
                        Ok(p) => p,
                        Err(e) => return Err(engine_error_message(&ctx, &e)),
                    };
                    promise_to_json(&ctx, chained)
                        .await
                        .map_err(|e| engine_error_message(&ctx, &e))
                }),
        )
        .await;

        instance.deadline_ms.store(0, Ordering::Relaxed);
        instance.current_call.store(0, Ordering::Relaxed);

        let logs = take_logs(&instance.logs, call_id);

        match outcome {
            Err(_) => {
                self.destroy(plugin_id).await;
                call_err(format!("方法调用超时: {} ({}ms)", method, timeout_ms), logs)
            }
            Ok(Err(e)) => call_err(format!("引擎调用失败: {}", e), logs),
            Ok(Ok(json)) => match serde_json::from_str::<serde_json::Value>(&json) {
                Ok(v) if v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) => {
                    EngineCallResult {
                        ok: true,
                        error: None,
                        data: v.get("data").cloned(),
                        logs,
                    }
                }
                Ok(v) => {
                    let error = v
                        .get("error")
                        .and_then(|x| x.as_str())
                        .unwrap_or("方法调用失败")
                        .to_string();
                    call_err(error, logs)
                }
                Err(e) => call_err(format!("调用结果解析失败: {}", e), logs),
            },
        }
    }
}
