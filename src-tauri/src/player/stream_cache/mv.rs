use std::fs::File;
use std::io::{Seek, SeekFrom};
use std::sync::atomic::Ordering;
use std::time::SystemTime;

use super::eviction::cache;
use super::url::stream_cache_key;

/// MV 代理用：查询某 URL 的流缓存状态（与歌曲同池，key 需用 stream_cache_key 对齐）。
pub struct MvCacheStatus {
    pub complete: bool,
}

pub fn mv_cache_status(url: &str) -> MvCacheStatus {
    let hash = stream_cache_key(url);
    let mgr = cache().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = mgr.entries.get(&hash) {
        let complete = entry.download_complete.load(Ordering::Relaxed)
            && !entry.download_failed.load(Ordering::Relaxed);
        return MvCacheStatus { complete };
    }
    MvCacheStatus { complete: false }
}

/// MV 代理用：读取已下载前缀内的 [offset, offset+len) 数据。
/// 未缓冲到 / 条目已被淘汰时返回 Err（代理侧回退 upstream）。
pub fn cache_read_range(url: &str, offset: u64, max_len: usize) -> Result<Vec<u8>, String> {
    if max_len == 0 {
        return Ok(Vec::new());
    }
    let hash = stream_cache_key(url);
    let (path, readable) = {
        let mut mgr = cache().lock().map_err(|e| e.to_string())?;
        let entry = mgr.entries.get_mut(&hash).ok_or("缓存不存在")?;
        if entry.download_failed.load(Ordering::Relaxed) {
            return Err("缓存下载失败".to_string());
        }
        let downloaded = entry.downloaded_bytes.load(Ordering::Relaxed);
        if offset >= downloaded {
            return Err("读取范围超出已缓冲数据".to_string());
        }
        entry.last_accessed = SystemTime::now();
        (entry.path.clone(), downloaded - offset)
    };
    let want = (max_len as u64).min(readable) as usize;
    let mut file = File::open(&path).map_err(|e| format!("打开缓存文件失败: {}", e))?;
    use std::io::Read as _;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("定位缓存文件失败: {}", e))?;
    let mut buf = vec![0u8; want];
    file.read_exact(&mut buf)
        .map_err(|e| format!("读取缓存数据失败: {}", e))?;
    Ok(buf)
}

/// MV 代理用：缓存已完整下载时打开文件供流式伺服（同时刷新 LRU 访问时间）。
pub struct CompletedCacheFile {
    pub file: File,
    pub size: u64,
}

pub fn open_completed_cache(url: &str) -> Result<CompletedCacheFile, String> {
    let hash = stream_cache_key(url);
    let (path, size) = {
        let mut mgr = cache().lock().map_err(|e| e.to_string())?;
        let entry = mgr.entries.get_mut(&hash).ok_or("缓存不存在")?;
        if !entry.download_complete.load(Ordering::Relaxed)
            || entry.download_failed.load(Ordering::Relaxed)
            || entry.size == 0
        {
            return Err("缓存未下载完成".to_string());
        }
        entry.last_accessed = SystemTime::now();
        (entry.path.clone(), entry.size)
    };
    let file = File::open(&path).map_err(|e| format!("打开缓存文件失败: {}", e))?;
    Ok(CompletedCacheFile { file, size })
}
