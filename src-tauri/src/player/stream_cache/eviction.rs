use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use super::paths::cache_dir;

pub(super) struct CacheEntry {
    pub(super) path: PathBuf,
    pub(super) size: u64,
    pub(super) last_accessed: SystemTime,
    pub(super) downloaded_bytes: Arc<AtomicU64>,
    pub(super) download_complete: Arc<AtomicBool>,
    pub(super) download_failed: Arc<AtomicBool>,
    /// 共享总长槽位（字节，0 = 未知）：下载线程回填，state/reader 实时读。
    /// 同一 URL 的 start_streaming_download 复用路径必须拿到同一线程写的槽。
    pub(super) content_length_shared: Arc<AtomicU64>,
    pub(super) _download_handle: Option<std::thread::JoinHandle<()>>,
}

pub(super) struct StreamCacheManager {
    pub(super) entries: HashMap<String, CacheEntry>,
    max_size_bytes: u64,
    pub(super) current_size: u64,
}

impl StreamCacheManager {
    pub(super) fn evict_if_needed(&mut self) {
        while self.current_size > self.max_size_bytes && !self.entries.is_empty() {
            // 只淘汰下载已结束（完成或失败）的条目：正在下载的文件被写入线程持有，
            // 删除会导致已下载字节作废、Windows 上文件残留，且其 size 尚未记账。
            let oldest_key = self
                .entries
                .iter()
                .filter(|(_, entry)| {
                    entry.download_complete.load(Ordering::Relaxed)
                        || entry.download_failed.load(Ordering::Relaxed)
                })
                .min_by_key(|(_, entry)| entry.last_accessed)
                .map(|(k, _)| k.clone());

            if let Some(key) = oldest_key {
                if let Some(entry) = self.entries.remove(&key) {
                    let _ = std::fs::remove_file(&entry.path);
                    self.current_size = self.current_size.saturating_sub(entry.size);
                }
            } else {
                break;
            }
        }
    }

    pub(super) fn update_size(&mut self, hash: &str, new_size: u64) {
        if let Some(entry) = self.entries.get_mut(hash) {
            self.current_size = self.current_size.saturating_sub(entry.size);
            entry.size = new_size;
            self.current_size += new_size;
        }
    }

    fn init_from_disk(&mut self) {
        let dir = cache_dir();
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => return,
        };

        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("dat") {
                continue;
            }

            let hash = match path.file_stem().and_then(|s| s.to_str()) {
                Some(h) => h.to_string(),
                None => continue,
            };

            if self.entries.contains_key(&hash) {
                continue;
            }

            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let size = metadata.len();
            if size == 0 {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            let last_modified = metadata.modified().ok().unwrap_or_else(SystemTime::now);

            self.entries.insert(
                hash,
                CacheEntry {
                    path: path.clone(),
                    size,
                    last_accessed: last_modified,
                    downloaded_bytes: Arc::new(AtomicU64::new(size)),
                    download_complete: Arc::new(AtomicBool::new(true)),
                    download_failed: Arc::new(AtomicBool::new(false)),
                    content_length_shared: Arc::new(AtomicU64::new(size)),
                    _download_handle: None,
                },
            );
            self.current_size += size;
        }

        self.evict_if_needed();
    }
}

pub(super) static STREAM_CACHE: OnceLock<Mutex<StreamCacheManager>> = OnceLock::new();

pub(super) fn cache() -> &'static Mutex<StreamCacheManager> {
    STREAM_CACHE.get_or_init(|| {
        let mut mgr = StreamCacheManager {
            entries: HashMap::new(),
            max_size_bytes: 500 * 1024 * 1024,
            current_size: 0,
        };
        mgr.init_from_disk();
        Mutex::new(mgr)
    })
}

pub fn set_max_cache_size(bytes: u64) {
    let mut mgr = cache().lock().unwrap_or_else(|e| e.into_inner());
    mgr.max_size_bytes = bytes;
    mgr.evict_if_needed();
}

pub fn current_cache_size() -> u64 {
    cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .current_size
}

pub fn max_cache_size() -> u64 {
    cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .max_size_bytes
}
