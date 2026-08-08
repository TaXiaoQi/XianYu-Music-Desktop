pub(crate) mod cache;
pub(crate) mod commands;
pub(crate) mod repository;
pub(crate) mod scanner;
pub(crate) mod types;
pub(crate) mod webdav;

use std::time::{SystemTime, UNIX_EPOCH};

/// 获取当前 Unix 时间戳（秒）
pub(crate) fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

pub(crate) use commands::{
    add_remote_source, clear_remote_cache, get_remote_cache_usage, get_remote_sources,
    list_remote_directory, precache_remote_song, remove_remote_source, sync_remote_source,
    test_remote_source, update_remote_source,
};
