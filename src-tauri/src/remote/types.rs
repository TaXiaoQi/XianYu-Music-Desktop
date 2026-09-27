// 远程曲库对内对外的数据结构。serde 字段名（camelCase）是前端契约，冻结不改名。
use serde::{Deserialize, Serialize};

/// 数据库里一份远程音源的公开视图（不含密码）。
#[derive(Clone, Debug, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSource {
    pub id: String, pub name: String, pub provider: String, pub base_url: String,
    pub username: Option<String>, pub root_path: String, pub enabled: bool,
    pub last_sync_at: Option<i64>, pub last_sync_error: Option<String>,
    pub created_at: i64, pub updated_at: i64,
}

/// 携带凭据的完整音源记录，仅在后端内部流转，永不序列化给前端。
#[derive(Clone, Debug)]
pub(crate) struct RemoteSourceCredentials {
    pub id: String, pub name: String, pub provider: String, pub base_url: String,
    pub username: Option<String>, pub password: Option<String>, pub root_path: String,
    pub enabled: bool, pub last_sync_at: Option<i64>, pub last_sync_error: Option<String>,
    pub created_at: i64, pub updated_at: i64,
}

impl RemoteSourceCredentials {
    /// 剥离密码字段，转成可下发给前端的公开视图。
    pub(crate) fn into_public(self) -> RemoteSource {
        RemoteSource {
            id: self.id, name: self.name, provider: self.provider, base_url: self.base_url,
            username: self.username, root_path: self.root_path, enabled: self.enabled,
            last_sync_at: self.last_sync_at, last_sync_error: self.last_sync_error,
            created_at: self.created_at, updated_at: self.updated_at,
        }
    }
}

/// 新增 / 编辑音源时由前端提交的表单。
#[derive(Clone, Debug, Deserialize)] #[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSourceInput {
    pub id: Option<String>, pub name: String, pub provider: String, pub base_url: String,
    pub username: Option<String>, pub password: Option<String>, pub root_path: Option<String>,
}

/// 连接测试结果。
#[derive(Clone, Debug, Serialize)] #[serde(rename_all = "camelCase")]
pub(crate) struct RemoteConnectionResult { pub ok: bool, pub message: String }

/// 一次同步的统计摘要。
#[derive(Clone, Debug, Serialize)] #[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSyncResult {
    pub source_id: String, pub indexed_files: usize, pub audio_files: usize, pub parsed_songs: usize,
}

/// 单文件下载进度事件负载（事件名 remote-download-progress）。
#[derive(Clone, Debug, Serialize)] #[serde(rename_all = "camelCase")]
pub(crate) struct RemoteDownloadProgress {
    pub uri: String, pub downloaded: u64, pub total: Option<u64>, pub percent: Option<f64>,
    pub done: bool, pub failed: bool, pub message: Option<String>,
}

/// 同步进度事件负载（事件名 remote-sync-progress）。
#[derive(Clone, Debug, Serialize)] #[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSyncProgress {
    pub source_id: String, pub phase: String, pub current: usize, pub total: usize,
    pub message: String, pub done: bool, pub failed: bool,
}

/// PROPFIND 解析出的单个远程条目。
#[derive(Clone, Debug, Serialize)] #[serde(rename_all = "camelCase")]
pub(crate) struct RemoteFileEntry {
    pub remote_path: String, pub name: String, pub size: u64,
    pub etag: Option<String>, pub modified_at: Option<String>, pub is_dir: bool,
}

impl RemoteFileEntry {
    /// 生成 `remote://<source_id>/<path>` 形式的统一资源标识。
    pub(crate) fn remote_uri(&self, source_id: &str) -> String {
        format!("remote://{}/{}", source_id, self.remote_path.trim_start_matches('/'))
    }
}

/// 缓存目录占用统计。
#[derive(Clone, Debug, Serialize)] #[serde(rename_all = "camelCase")]
pub(crate) struct RemoteCacheUsage { pub bytes: u64, pub files: usize, pub limit_bytes: u64 }
