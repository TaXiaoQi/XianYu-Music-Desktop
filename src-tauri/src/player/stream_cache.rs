//! 在线音频流式内存缓存模块
//!
//! 核心思路：把在线音乐流式下载到内存缓冲（Vec<u8>），同时用 StreamingMemoryReader
//! 包装该缓冲供本地引擎（rodio Decoder）播放。这样所有音乐都走统一的
//! 内存读取 + Decoder 路径，设备切换恢复天然支持，无需维护 RemoteRangeReader，
//! 也不需要磁盘 I/O。
//!
//! 流程：
//! 1. start_streaming_download 创建内存缓冲 + 启动后台下载线程
//! 2. 下载够最小缓冲（512KB）后即可开始播放
//! 3. StreamingMemoryReader 在读取追上下载进度时阻塞等待
//! 4. 下载完成后标记 complete，reader 正常读到 EOF
//! 5. LRU 策略淘汰旧缓存，上限用户可配置；进程退出即释放，不做持久化

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

/// 最小缓冲字节数：下载够这个量后才开始播放，避免起播立即卡顿
pub const MIN_BUFFER_BYTES: u64 = 512 * 1024;

/// 内存缓冲类型：下载线程写入，多个 reader 读取。
/// 用 Mutex 短暂持锁拷贝，避免长时间阻塞下载线程。
pub type BufferRef = Arc<Mutex<Vec<u8>>>;

/// 流式内存读取器：从内存缓冲读取数据，实现 Read + Seek。
/// 读取位置接近下载进度时阻塞等待，直到数据就绪。
pub struct StreamingMemoryReader {
    buffer: BufferRef,
    downloaded_bytes: Arc<AtomicU64>,
    download_complete: Arc<AtomicBool>,
    pos: u64,
    total_bytes: Option<u64>,
}

impl Read for StreamingMemoryReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            let downloaded = self.downloaded_bytes.load(Ordering::Relaxed);
            if self.pos < downloaded {
                let max_read = (downloaded - self.pos).min(buf.len() as u64) as usize;
                let buffer = self.buffer.lock().unwrap();
                let start = self.pos as usize;
                buf[..max_read].copy_from_slice(&buffer[start..start + max_read]);
                self.pos += max_read as u64;
                return Ok(max_read);
            }
            if self.download_complete.load(Ordering::Relaxed) {
                return Ok(0);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

impl Seek for StreamingMemoryReader {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let target = match pos {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(n) => (self.pos as i64 + n).max(0) as u64,
            SeekFrom::End(n) => {
                if let Some(total) = self.total_bytes {
                    return Ok((total as i64 + n).max(0) as u64);
                }
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "Cannot seek from end while download is in progress",
                ));
            }
        };

        loop {
            let downloaded = self.downloaded_bytes.load(Ordering::Relaxed);
            if target < downloaded || self.download_complete.load(Ordering::Relaxed) {
                self.pos = target;
                return Ok(target);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// 流式内存状态：在 AudioSource 中传递，设备切换恢复时重建 reader。
#[derive(Clone)]
pub struct StreamingTempFileState {
    /// 内存缓冲（下载线程写，reader 读）
    pub buffer: BufferRef,
    pub downloaded_bytes: Arc<AtomicU64>,
    pub download_complete: Arc<AtomicBool>,
    pub total_bytes: Option<u64>,
    /// 仅用于日志显示（保留旧字段名以最小化上游改动）
    pub path: String,
}

impl std::fmt::Debug for StreamingTempFileState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamingTempFileState")
            .field("path", &self.path)
            .field(
                "downloaded_bytes",
                &self.downloaded_bytes.load(Ordering::Relaxed),
            )
            .field(
                "download_complete",
                &self.download_complete.load(Ordering::Relaxed),
            )
            .field("total_bytes", &self.total_bytes)
            .finish()
    }
}

impl StreamingTempFileState {
    pub fn new_reader(&self) -> std::io::Result<StreamingMemoryReader> {
        Ok(StreamingMemoryReader {
            buffer: self.buffer.clone(),
            downloaded_bytes: self.downloaded_bytes.clone(),
            download_complete: self.download_complete.clone(),
            pos: 0,
            total_bytes: self.total_bytes,
        })
    }

    pub fn is_download_complete(&self) -> bool {
        self.download_complete.load(Ordering::Relaxed)
    }

    pub fn downloaded_bytes(&self) -> u64 {
        self.downloaded_bytes.load(Ordering::Relaxed)
    }
}

struct CacheEntry {
    buffer: BufferRef,
    size: u64,
    last_accessed: SystemTime,
    downloaded_bytes: Arc<AtomicU64>,
    download_complete: Arc<AtomicBool>,
    /// 下载线程句柄（detach，不阻塞；线程结束后自然回收）
    _download_handle: Option<std::thread::JoinHandle<()>>,
}

struct StreamCacheManager {
    /// key = url_hash
    entries: HashMap<String, CacheEntry>,
    max_size_bytes: u64,
    current_size: u64,
}

impl StreamCacheManager {
    fn evict_if_needed(&mut self) {
        while self.current_size > self.max_size_bytes && !self.entries.is_empty() {
            // 注意：正在下载中的条目不参与淘汰（避免删除正在写的缓冲）
            let oldest_key = self
                .entries
                .iter()
                .filter(|(_, entry)| entry.download_complete.load(Ordering::Relaxed))
                .min_by_key(|(_, entry)| entry.last_accessed)
                .map(|(k, _)| k.clone());

            if let Some(key) = oldest_key {
                if let Some(entry) = self.entries.remove(&key) {
                    // buffer drop 后内存自动释放
                    self.current_size = self.current_size.saturating_sub(entry.size);
                }
            } else {
                break;
            }
        }
    }

    fn update_size(&mut self, hash: &str, new_size: u64) {
        if let Some(entry) = self.entries.get_mut(hash) {
            self.current_size = self.current_size.saturating_sub(entry.size);
            entry.size = new_size;
            self.current_size += new_size;
        }
    }
}

static STREAM_CACHE: OnceLock<Mutex<StreamCacheManager>> = OnceLock::new();

fn cache() -> &'static Mutex<StreamCacheManager> {
    STREAM_CACHE.get_or_init(|| {
        let mgr = StreamCacheManager {
            entries: HashMap::new(),
            max_size_bytes: 500 * 1024 * 1024,
            current_size: 0,
        };
        Mutex::new(mgr)
    })
}

/// 设置缓存上限（用户可配置）
pub fn set_max_cache_size(bytes: u64) {
    let mut mgr = cache().lock().unwrap();
    mgr.max_size_bytes = bytes;
    mgr.evict_if_needed();
}

/// 获取当前缓存大小
pub fn current_cache_size() -> u64 {
    cache().lock().unwrap().current_size
}

/// 获取缓存上限
pub fn max_cache_size() -> u64 {
    cache().lock().unwrap().max_size_bytes
}

fn url_hash(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hex::encode(&hasher.finalize()[..16])
}

/// 为在线音频创建内存缓冲并启动后台下载。
/// 如果同一 URL 的缓存已存在（下载完成），直接复用。
pub fn start_streaming_download(
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
) -> Result<StreamingTempFileState, String> {
    let hash = url_hash(url);
    let mut mgr = cache().lock().unwrap();

    // 已有缓存：检查是否下载完成
    if let Some(entry) = mgr.entries.get_mut(&hash) {
        entry.last_accessed = SystemTime::now();
        if entry.download_complete.load(Ordering::Relaxed) {
            let downloaded = entry.size;
            return Ok(StreamingTempFileState {
                buffer: entry.buffer.clone(),
                downloaded_bytes: Arc::new(AtomicU64::new(downloaded)),
                download_complete: Arc::new(AtomicBool::new(true)),
                total_bytes: Some(downloaded),
                path: url.to_string(),
            });
        }
        // 下载进行中：复用同一个缓冲和下载状态
        return Ok(StreamingTempFileState {
            buffer: entry.buffer.clone(),
            downloaded_bytes: entry.downloaded_bytes.clone(),
            download_complete: entry.download_complete.clone(),
            total_bytes: None,
            path: url.to_string(),
        });
    }

    // 创建内存缓冲
    let buffer = Arc::new(Mutex::new(Vec::<u8>::with_capacity(64 * 1024)));
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let download_complete = Arc::new(AtomicBool::new(false));

    // 启动后台下载线程
    let url_clone = url.to_string();
    let hash_clone = hash.clone();
    let headers_clone = headers.cloned();
    let ua_clone = user_agent.map(|s| s.to_string());
    let buf_clone = buffer.clone();
    let dl_bytes = downloaded_bytes.clone();
    let dl_complete = download_complete.clone();

    let handle = std::thread::spawn(move || {
        download_thread(&url_clone, &hash_clone, headers_clone.as_ref(), ua_clone.as_deref(),
                         buf_clone, dl_bytes, dl_complete);
    });

    mgr.entries.insert(
        hash,
        CacheEntry {
            buffer: buffer.clone(),
            size: 0,
            last_accessed: SystemTime::now(),
            downloaded_bytes: downloaded_bytes.clone(),
            download_complete: download_complete.clone(),
            _download_handle: Some(handle),
        },
    );
    mgr.evict_if_needed();

    Ok(StreamingTempFileState {
        buffer,
        downloaded_bytes,
        download_complete,
        total_bytes: None,
        path: url.to_string(),
    })
}

fn download_thread(
    url: &str,
    hash: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    buffer: BufferRef,
    downloaded_bytes: Arc<AtomicU64>,
    download_complete: Arc<AtomicBool>,
) {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[StreamCache] 创建 HTTP 客户端失败: {}", e);
            download_complete.store(true, Ordering::Relaxed);
            return;
        }
    };

    let mut req = client.get(url);
    if let Some(ua) = user_agent {
        req = req.header(reqwest::header::USER_AGENT, ua);
    }
    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            if !key.trim().is_empty() && !value.trim().is_empty() {
                if let (Ok(name), Ok(val)) = (
                    reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                    reqwest::header::HeaderValue::from_str(value),
                ) {
                    req = req.header(name, val);
                }
            }
        }
    }

    let response = match req.send() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[StreamCache] 下载请求失败: {}", e);
            download_complete.store(true, Ordering::Relaxed);
            return;
        }
    };

    if !response.status().is_success() {
        eprintln!("[StreamCache] 下载失败: HTTP {}", response.status());
        download_complete.store(true, Ordering::Relaxed);
        return;
    }

    // 检查 Content-Type
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let is_html = content_type.contains("text/html")
        || content_type.contains("application/json")
        || content_type.contains("text/plain");
    if is_html {
        eprintln!(
            "[StreamCache] 服务器返回非音频内容 (Content-Type: {}) url={}",
            content_type, url
        );
        download_complete.store(true, Ordering::Relaxed);
        return;
    }

    let total_bytes = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let mut response = response;
    let mut buf = [0u8; 64 * 1024];
    let mut bytes_written = 0u64;

    loop {
        match response.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                {
                    let mut buffer = buffer.lock().unwrap();
                    buffer.extend_from_slice(&buf[..n]);
                }
                bytes_written += n as u64;
                downloaded_bytes.store(bytes_written, Ordering::Relaxed);
            }
            Err(e) => {
                eprintln!("[StreamCache] 下载流读取错误: {}", e);
                break;
            }
        }
    }

    download_complete.store(true, Ordering::Relaxed);

    // 更新缓存大小
    if let Ok(mut mgr) = cache().lock() {
        mgr.update_size(hash, bytes_written);
    }

    eprintln!(
        "[StreamCache] 下载完成: {} bytes (total={:?}) url={}",
        bytes_written, total_bytes, url
    );
}

/// 等待最小缓冲就绪（在 commands.rs 的 async 上下文中用 tokio::time::sleep 轮询）
pub fn is_buffer_ready(state: &StreamingTempFileState) -> bool {
    state.downloaded_bytes() >= MIN_BUFFER_BYTES || state.is_download_complete()
}

/// 检查指定 URL 是否已缓存且下载完成。
/// 用于播放前探测：若已缓存则直接复用，跳过插件重复请求（Baka 等前置请求易失败的音源）。
pub fn is_url_cached(url: &str) -> bool {
    let hash = url_hash(url);
    let mgr = cache().lock().unwrap();
    if let Some(entry) = mgr.entries.get(&hash) {
        return entry.download_complete.load(Ordering::Relaxed) && entry.size > 0;
    }
    false
}

/// 等待指定 URL 缓存下载完成（轮询，供前端 'wait' 失败行为使用）。
/// 返回最终是否完成且有效（字节数 > 0）。
pub fn wait_url_complete(url: &str, timeout_secs: u64) -> bool {
    let hash = url_hash(url);
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        let complete = {
            let mgr = cache().lock().unwrap();
            if let Some(entry) = mgr.entries.get(&hash) {
                entry.download_complete.load(Ordering::Relaxed)
            } else {
                // URL 不在缓存中（从未下载或已被淘汰），无法等待
                return false;
            }
        };
        if complete {
            let mgr = cache().lock().unwrap();
            if let Some(entry) = mgr.entries.get(&hash) {
                return entry.size > 0;
            }
            return false;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// 清理所有缓存
pub fn clear_all() {
    if let Some(mgr) = STREAM_CACHE.get() {
        if let Ok(mut mgr) = mgr.lock() {
            mgr.entries.drain();
            mgr.current_size = 0;
        }
    }
}
