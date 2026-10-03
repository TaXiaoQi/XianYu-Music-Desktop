pub mod commands;
mod http;
mod store;

mod bridges;
mod dispatch;
mod loader;
mod misc;
mod runtime;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64};
use std::sync::{Arc, Mutex as StdMutex};
use rquickjs::{AsyncContext, AsyncRuntime};
use tokio::sync::Mutex as AsyncMutex;

pub use http::HttpBridge;
pub use store::PluginStore;

pub const HOST_SHIM_JS: &str = include_str!("host_shim.js");
pub const PACKAGES_BUNDLE_JS: &str = include_str!("packages_bundle.js");

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PluginKind {
    MusicFree,
    Lx,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineLog {
    pub level: String,
    pub message: String,
    pub call_id: u64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineLoadResult {
    pub ok: bool,
    pub error: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub logs: Vec<EngineLog>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineCallResult {
    pub ok: bool,
    pub error: Option<String>,
    pub data: Option<serde_json::Value>,
    pub logs: Vec<EngineLog>,
}

pub struct PluginInstance {
    #[allow(dead_code)]
    pub id: String,
    pub kind: PluginKind,
    #[allow(dead_code)]
    pub metadata: serde_json::Value,
    pub ctx: AsyncContext,
    #[allow(dead_code)]
    pub runtime: AsyncRuntime,
    deadline_ms: Arc<AtomicI64>,
    call_seq: Arc<AtomicU64>,
    current_call: Arc<AtomicU64>,
    logs: Arc<StdMutex<Vec<EngineLog>>>,
    call_lock: AsyncMutex<()>,
}

/// 插件运行时事件出口（如 LX 插件 updateAlert 自报更新）。
/// 生产环境由 AppHandle::emit 实现，测试可注入捕获闭包。
pub type PluginEventEmitter = Arc<dyn Fn(&'static str, serde_json::Value) + Send + Sync>;

/// 前端监听的 LX 插件更新事件名。
pub const PLUGIN_LX_UPDATE_ALERT_EVENT: &str = "plugin-lx-update-alert";

pub struct PluginEngine {
    http: Arc<HttpBridge>,
    store: Arc<PluginStore>,
    instances: AsyncMutex<HashMap<String, Arc<PluginInstance>>>,
    emitter: Option<PluginEventEmitter>,
}

impl PluginEngine {
    pub fn with_emitter(
        store_path: Option<std::path::PathBuf>,
        emitter: Option<PluginEventEmitter>,
    ) -> Self {
        let store = Arc::new(PluginStore::load(store_path));
        let http = Arc::new(HttpBridge::new(store.clone()));
        Self {
            http,
            store,
            instances: AsyncMutex::new(HashMap::new()),
            emitter,
        }
    }

    pub fn store(&self) -> &Arc<PluginStore> {
        &self.store
    }

    /// 供 fallback_host 复用同一 HTTP 桥（SSRF 防护 / client 缓存 / cookie 捕获共享）。
    pub fn http(&self) -> &Arc<HttpBridge> {
        &self.http
    }

    /// 供网络代理开关变化后清空 HTTP client 缓存（见 `netproxy::save`）。
    pub fn clear_http_clients(&self) {
        self.http.clear_clients();
    }

    async fn destroy(&self, plugin_id: &str) {
        self.instances.lock().await.remove(plugin_id);
    }
}
