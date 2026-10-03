use std::sync::atomic::Ordering;
use std::time::SystemTime;

use super::eviction::{cache, STREAM_CACHE};
use super::url::url_hash;

pub fn is_url_cached(url: &str) -> bool {
    let hash = url_hash(url);
    let mgr = cache().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = mgr.entries.get(&hash) {
        return entry.download_complete.load(Ordering::Relaxed)
            && !entry.download_failed.load(Ordering::Relaxed)
            && entry.size > 0;
    }
    false
}

pub fn copy_cache_to(url: &str, dest_path: &str) -> Result<u64, String> {
    let hash = url_hash(url);
    let src_path = {
        let mut mgr = cache().lock().map_err(|e| e.to_string())?;
        let entry = mgr
            .entries
            .get_mut(&hash)
            .ok_or_else(|| "缓存不存在".to_string())?;
        if !entry.download_complete.load(Ordering::Relaxed)
            || entry.download_failed.load(Ordering::Relaxed)
            || entry.size == 0
        {
            return Err("缓存未下载完成".to_string());
        }
        entry.last_accessed = SystemTime::now();
        entry.path.clone()
    };
    std::fs::copy(&src_path, dest_path).map_err(|e| format!("复制缓存文件失败: {}", e))
}

pub fn clear_all() {
    if let Some(mgr) = STREAM_CACHE.get() {
        if let Ok(mut mgr) = mgr.lock() {
            for (_, entry) in mgr.entries.drain() {
                let _ = std::fs::remove_file(&entry.path);
            }
            mgr.current_size = 0;
        }
    }
}
