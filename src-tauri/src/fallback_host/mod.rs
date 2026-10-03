//! 兜底模块（fallback modules）QuickJS 宿主。
//!
//! 前端把服务端下发的兜底 JS 模块迁到这里执行：验签 + 编译 + 四条硬校验一体
//! （`fallback_module_load`），调用走 `fallback_module_call` / `call_many`，
//! 配置快照经 `fallback_module_update_config` 整包替换。
//!
//! ctx 映射：http 复用 plugin_host::HttpBridge（SSRF 防护继承）；cache 全模块
//! 共享单表 + TTL；log 结果内嵌 logs；config 深路径只读；utils 由 shim.js 提供。

pub mod commands;
mod bridges;
mod dispatch;
mod runtime;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64};
use std::sync::{Arc, Mutex as StdMutex, RwLock};

use rquickjs::{AsyncContext, AsyncRuntime};
use tokio::sync::Mutex as AsyncMutex;

use crate::plugin_host::HttpBridge;

pub const FALLBACK_SHIM_JS: &str = include_str!("shim.js");

/// 已注册的模块 key 与期望导出方法（与前端 FALLBACK_MODULE_METHODS 同步维护）。
pub(crate) const FALLBACK_MODULE_METHODS: &[(&str, &[&str])] = &[
    ("lx_search", &["search"]),
    ("lx_album", &["searchAlbums", "getAlbumSongs"]),
    ("lx_duration", &["batchTrackInterval"]),
    ("lx_lyric", &["fetchLyric"]),
    ("lx_cover", &["extractCoverUrl"]),
    (
        "plugin_fallback",
        &[
            "isQqMusicPluginSource",
            "hostSearchFallback",
            "hostAlbumSearchFallback",
            "hostAlbumSongsFallback",
            "isQqTrialMediaUrl",
            "fillSongDurations",
        ],
    ),
    (
        "playlist_import",
        &[
            "getListDetailKg",
            "getListDetailWy",
            "getListDetailTx",
            "getListDetailKw",
            "getListDetailQishui",
        ],
    ),
];

fn expected_methods(module_key: &str) -> Option<&'static [&'static str]> {
    FALLBACK_MODULE_METHODS
        .iter()
        .find(|(k, _)| *k == module_key)
        .map(|(_, methods)| *methods)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FallbackLog {
    pub level: String,
    pub message: String,
    pub call_id: u64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FallbackLoadResult {
    pub ok: bool,
    pub error: Option<String>,
    pub version: Option<i64>,
    pub logs: Vec<FallbackLog>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FallbackCallResult {
    pub ok: bool,
    pub error: Option<String>,
    pub data: Option<serde_json::Value>,
    pub logs: Vec<FallbackLog>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FallbackCallItem {
    pub ok: bool,
    pub error: Option<String>,
    pub data: Option<serde_json::Value>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FallbackCallManyResult {
    pub results: Vec<FallbackCallItem>,
    pub logs: Vec<FallbackLog>,
}

pub(crate) struct CacheEntry {
    pub value: serde_json::Value,
    /// None 表示永不过期（与前端 ctx.cache.set 无 ttl 语义一致）。
    pub expire_at: Option<std::time::Instant>,
}

pub(crate) struct FallbackInstance {
    pub ctx: AsyncContext,
    #[allow(dead_code)]
    pub runtime: AsyncRuntime,
    pub deadline_ms: Arc<AtomicI64>,
    pub call_seq: Arc<AtomicU64>,
    pub current_call: Arc<AtomicU64>,
    pub logs: Arc<StdMutex<Vec<FallbackLog>>>,
    pub call_lock: Arc<AsyncMutex<()>>,
}

pub struct FallbackEngine {
    pub(super) http: Arc<HttpBridge>,
    /// 全模块共享单表缓存（与前端模块级 _cache Map 语义一致）。
    pub(super) cache: Arc<StdMutex<HashMap<String, CacheEntry>>>,
    /// 配置快照（fallback_module_update_config 整包替换）。
    pub(super) config: Arc<RwLock<serde_json::Value>>,
    /// 最近一次推送配置的 sha256-hex（对原始入参字符串取摘要，启动对账用）。
    pub(super) config_hash: Arc<RwLock<String>>,
    pub(super) instances: AsyncMutex<HashMap<String, Arc<FallbackInstance>>>,
}

impl FallbackEngine {
    pub fn new(http: Arc<HttpBridge>) -> Self {
        Self {
            http,
            cache: Arc::new(StdMutex::new(HashMap::new())),
            config: Arc::new(RwLock::new(serde_json::Value::Null)),
            config_hash: Arc::new(RwLock::new(String::new())),
            instances: AsyncMutex::new(HashMap::new()),
        }
    }
}
