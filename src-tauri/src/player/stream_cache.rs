use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant, SystemTime};

static CUSTOM_CACHE_DIR: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

fn custom_cache_dir_lock() -> &'static RwLock<Option<PathBuf>> {
    CUSTOM_CACHE_DIR.get_or_init(|| RwLock::new(None))
}

pub fn set_cache_dir(path: &str) {
    let new_dir = if path.trim().is_empty() {
        None
    } else {
        let p = PathBuf::from(path);
        if let Err(e) = std::fs::create_dir_all(&p) {
            eprintln!("[StreamCache] 创建自定义缓存目录失败: {e}");
            return;
        }
        Some(p)
    };
    if let Ok(mut guard) = custom_cache_dir_lock().write() {
        *guard = new_dir;
    }
}

pub fn get_cache_dir_str() -> String {
    if let Ok(guard) = custom_cache_dir_lock().read() {
        if let Some(ref p) = *guard {
            return p.to_string_lossy().into_owned();
        }
    }
    cache_dir().to_string_lossy().into_owned()
}

fn sanitize_stream_url(raw: &str) -> String {
    let trimmed = raw.trim();
    let http_idx = trimmed.find("http://");
    let https_idx = trimmed.find("https://");
    let start = match (http_idx, https_idx) {
        (Some(h), Some(s)) => h.min(s),
        (Some(h), None) => h,
        (None, Some(s)) => s,
        (None, None) => return trimmed.to_string(),
    };
    let candidate = &trimmed[start..];
    let end = candidate
        .find(|c: char| {
            matches!(
                c,
                '`' | '\''
                    | '"'
                    | '<'
                    | '>'
                    | ' '
                    | '\t'
                    | '\n'
                    | '\r'
                    | '\u{2018}'
                    | '\u{2019}'
                    | '\u{201c}'
                    | '\u{201d}'
                    | '\u{ff02}'
                    | '\u{ff07}'
            )
        })
        .unwrap_or(candidate.len());
    let mut result = candidate[..end].to_string();
    loop {
        let trimmed_end = result.trim_end_matches(|c: char| {
            matches!(
                c,
                ',' | '，'
                    | ';'
                    | '；'
                    | '`'
                    | '\''
                    | '"'
                    | ' '
                    | '\u{2018}'
                    | '\u{2019}'
                    | '\u{201c}'
                    | '\u{201d}'
                    | '\u{ff02}'
                    | '\u{ff07}'
            )
        });
        if trimmed_end.len() == result.len() {
            break;
        }
        result = trimmed_end.to_string();
    }
    result
}

pub trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

fn decrypt_cenc_file(path: &std::path::Path, cek: &str) -> Result<(), String> {
    let mut data = std::fs::read(path).map_err(|e| format!("读取缓存文件失败: {}", e))?;
    let key = crate::player::cenc::cek_to_key(cek).map_err(|e| e.to_string())?;
    let decrypted = crate::player::cenc::decrypt_cenc_in_place(&mut data, &key)
        .map_err(|e| format!("CENC 解密失败: {}", e))?;
    if decrypted {
        let mut f = OpenOptions::new()
            .write(true)
            .open(path)
            .map_err(|e| format!("打开缓存文件写回失败: {}", e))?;
        f.seek(SeekFrom::Start(0))
            .map_err(|e| format!("定位缓存文件失败: {}", e))?;
        f.write_all(&data)
            .map_err(|e| format!("写回解密文件失败: {}", e))?;
        f.set_len(data.len() as u64)
            .map_err(|e| format!("设置文件长度失败: {}", e))?;
        f.flush().map_err(|e| format!("刷新文件失败: {}", e))?;
    }
    Ok(())
}

pub const MIN_BUFFER_BYTES: u64 = 256 * 1024;

const SEEK_WAIT_TIMEOUT: Duration = Duration::from_secs(15);

pub struct StreamingTempFileReader {
    file: File,
    downloaded_bytes: Arc<AtomicU64>,
    download_complete: Arc<AtomicBool>,
    download_failed: Arc<AtomicBool>,
    pos: u64,
    total_bytes: Option<u64>,
    post_check_pending: Option<Arc<AtomicBool>>,
}

impl Read for StreamingTempFileReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            if let Some(ref flag) = self.post_check_pending {
                if flag.load(Ordering::Relaxed) {
                    if self.download_failed.load(Ordering::Relaxed) {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            "流缓存下载校验失败，音频数据不完整",
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(3));
                    continue;
                }
            }

            let downloaded = self.downloaded_bytes.load(Ordering::Relaxed);
            if self.pos < downloaded {
                let max_read = (downloaded - self.pos).min(buf.len() as u64) as usize;
                let n = self.file.read(&mut buf[..max_read])?;
                self.pos += n as u64;
                return Ok(n);
            }
            if self.download_complete.load(Ordering::Relaxed)
                || self.download_failed.load(Ordering::Relaxed)
            {
                return Ok(0);
            }
            std::thread::sleep(Duration::from_millis(3));
        }
    }
}

impl Seek for StreamingTempFileReader {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let target = match pos {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(n) => (self.pos as i64 + n).max(0) as u64,
            SeekFrom::End(n) => {
                if self.total_bytes.is_some() || self.download_complete.load(Ordering::Relaxed) {
                    return self.file.seek(SeekFrom::End(n)).map(|p| {
                        self.pos = p;
                        p
                    });
                }
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "Cannot seek from end while download is in progress",
                ));
            }
        };

        let deadline = Instant::now() + SEEK_WAIT_TIMEOUT;
        loop {
            let downloaded = self.downloaded_bytes.load(Ordering::Relaxed);
            if target < downloaded || self.download_complete.load(Ordering::Relaxed) {
                self.pos = target;
                return self.file.seek(SeekFrom::Start(target)).map(|_| target);
            }
            if self.download_failed.load(Ordering::Relaxed) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "流缓存下载失败，无法定位到未缓冲区域",
                ));
            }
            if Instant::now() >= deadline {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "等待流缓存下载缓冲超时",
                ));
            }
            std::thread::sleep(Duration::from_millis(3));
        }
    }
}

#[derive(Clone)]
pub struct StreamingTempFileState {
    pub path: String,
    pub downloaded_bytes: Arc<AtomicU64>,
    pub download_complete: Arc<AtomicBool>,
    pub download_failed: Arc<AtomicBool>,
    pub total_bytes: Option<u64>,
    pub ekey: Arc<std::sync::Mutex<Option<String>>>,
    pub cek: Arc<std::sync::Mutex<Option<String>>>,
    pub post_check_pending: Option<Arc<AtomicBool>>,
    pub cenc_metadata: Arc<std::sync::Mutex<Option<crate::player::cenc::CencMetadata>>>,
    pub cenc_streaming: Arc<AtomicBool>,
    pub download_error: Arc<std::sync::Mutex<Option<String>>>,
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
            .field(
                "download_failed",
                &self.download_failed.load(Ordering::Relaxed),
            )
            .field("total_bytes", &self.total_bytes)
            .field(
                "ekey",
                &self.ekey.lock().map(|e| e.is_some()).unwrap_or(false),
            )
            .field(
                "cek",
                &self.cek.lock().map(|c| c.is_some()).unwrap_or(false),
            )
            .finish()
    }
}

impl StreamingTempFileState {
    pub fn new_reader(&self) -> std::io::Result<StreamingTempFileReader> {
        let file = File::open(&self.path)?;
        Ok(StreamingTempFileReader {
            file,
            downloaded_bytes: self.downloaded_bytes.clone(),
            download_complete: self.download_complete.clone(),
            download_failed: self.download_failed.clone(),
            pos: 0,
            total_bytes: self.total_bytes,
            post_check_pending: self.post_check_pending.clone(),
        })
    }

    pub fn ekey(&self) -> Option<String> {
        self.ekey.lock().ok().and_then(|e| e.clone())
    }

    pub fn cek(&self) -> Option<String> {
        self.cek.lock().ok().and_then(|c| c.clone())
    }

    pub fn new_reader_with_decryption(
        &self,
    ) -> std::io::Result<Box<dyn ReadSeek + Send + Sync + 'static>> {
        let reader = self.new_reader()?;

        if self.cenc_streaming.load(Ordering::Relaxed) {
            if let Ok(md_lock) = self.cenc_metadata.lock() {
                if let Some(ref metadata) = *md_lock {
                    if let Some(cek_str) = self.cek() {
                        if let Ok(key) = crate::player::cenc::cek_to_key(&cek_str) {
                            return Ok(Box::new(crate::player::cenc::CencDecryptReader::new(
                                reader,
                                key,
                                metadata.clone(),
                            )));
                        }
                    }
                }
            }
        }

        let ekey = self.ekey();
        if let Some(ekey_str) = ekey {
            match crate::player::qmc2::QmcCrypto::from_ekey(&ekey_str) {
                Ok(crypto) => Ok(Box::new(crate::player::qmc2::QmcDecryptReader::new(
                    reader, crypto,
                ))),
                Err(_) => Ok(Box::new(reader)),
            }
        } else {
            Ok(Box::new(reader))
        }
    }

    pub fn is_download_finished(&self) -> bool {
        self.download_complete.load(Ordering::Relaxed)
            || self.download_failed.load(Ordering::Relaxed)
    }

    pub fn downloaded_bytes(&self) -> u64 {
        self.downloaded_bytes.load(Ordering::Relaxed)
    }

    pub fn download_error(&self) -> Option<String> {
        self.download_error.lock().ok().and_then(|e| e.clone())
    }
}

struct CacheEntry {
    path: PathBuf,
    size: u64,
    last_accessed: SystemTime,
    downloaded_bytes: Arc<AtomicU64>,
    download_complete: Arc<AtomicBool>,
    download_failed: Arc<AtomicBool>,
    _download_handle: Option<std::thread::JoinHandle<()>>,
}

struct StreamCacheManager {
    entries: HashMap<String, CacheEntry>,
    max_size_bytes: u64,
    current_size: u64,
}

impl StreamCacheManager {
    fn evict_if_needed(&mut self) {
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

    fn update_size(&mut self, hash: &str, new_size: u64) {
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
                    _download_handle: None,
                },
            );
            self.current_size += size;
        }

        self.evict_if_needed();
    }
}

static STREAM_CACHE: OnceLock<Mutex<StreamCacheManager>> = OnceLock::new();

fn cache() -> &'static Mutex<StreamCacheManager> {
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

fn cache_dir() -> PathBuf {
    if let Ok(guard) = custom_cache_dir_lock().read() {
        if let Some(ref custom) = *guard {
            let _ = std::fs::create_dir_all(custom);
            return custom.clone();
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let dir = PathBuf::from(appdata)
                .join("com.xymusic.desktop")
                .join("stream_cache");
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
    }

    let dir = std::env::temp_dir().join("xianyu-music-stream-cache");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn url_hash(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hex::encode(&hasher.finalize()[..16])
}

/// 统一的流缓存 key（清洗 + hash），供 MV 代理等外部模块对齐注册表。
pub fn stream_cache_key(url: &str) -> String {
    url_hash(&sanitize_stream_url(url))
}

/// MV 等视频流缓存入口：跳过音频头部校验（webm/flv/m4s 非音频魔数），
/// probe 也接受 video/* Content-Type。ekey/cek 一律无。
pub fn start_streaming_download_video(
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
) -> Result<StreamingTempFileState, String> {
    start_streaming_download_inner(url, headers, user_agent, None, None, true)
}

pub fn start_streaming_download(
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    ekey: Option<&str>,
    cek: Option<&str>,
) -> Result<StreamingTempFileState, String> {
    start_streaming_download_inner(url, headers, user_agent, ekey, cek, false)
}

fn start_streaming_download_inner(
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    ekey: Option<&str>,
    cek: Option<&str>,
    allow_video: bool,
) -> Result<StreamingTempFileState, String> {
    let cleaned_url = sanitize_stream_url(url);
    let url = cleaned_url.as_str();
    let hash = url_hash(url);
    let mut mgr = cache().lock().map_err(|e| e.to_string())?;

    if let Some(entry) = mgr.entries.get(&hash) {
        if entry.download_failed.load(Ordering::Relaxed) {
            if let Some(failed) = mgr.entries.remove(&hash) {
                let _ = std::fs::remove_file(&failed.path);
                mgr.current_size = mgr.current_size.saturating_sub(failed.size);
            }
        }
    }

    if let Some(entry) = mgr.entries.get_mut(&hash) {
        entry.last_accessed = SystemTime::now();
        if entry.download_complete.load(Ordering::Relaxed)
            && !entry.download_failed.load(Ordering::Relaxed)
        {
            if let Some(cek_str) = cek {
                if let Err(e) = decrypt_cenc_file(&entry.path, cek_str) {
                    let failed = mgr.entries.remove(&hash);
                    if let Some(failed) = failed {
                        let _ = std::fs::remove_file(&failed.path);
                        mgr.current_size = mgr.current_size.saturating_sub(failed.size);
                    }
                    eprintln!("[CENC] 复用缓存解密失败，重新下载: {}", e);
                }
            }
            if let Some(entry) = mgr.entries.get_mut(&hash) {
                let downloaded = entry.size;
                return Ok(StreamingTempFileState {
                    path: entry.path.to_string_lossy().to_string(),
                    downloaded_bytes: Arc::new(AtomicU64::new(downloaded)),
                    download_complete: Arc::new(AtomicBool::new(true)),
                    download_failed: Arc::new(AtomicBool::new(false)),
                    total_bytes: Some(downloaded),
                    ekey: Arc::new(std::sync::Mutex::new(ekey.map(|s| s.to_string()))),
                    cek: Arc::new(std::sync::Mutex::new(cek.map(|s| s.to_string()))),
                    post_check_pending: None,
                    cenc_metadata: Arc::new(std::sync::Mutex::new(None)),
                    cenc_streaming: Arc::new(AtomicBool::new(false)),
                    download_error: Arc::new(std::sync::Mutex::new(None)),
                });
            }
        } else {
            return Ok(StreamingTempFileState {
                path: entry.path.to_string_lossy().to_string(),
                downloaded_bytes: entry.downloaded_bytes.clone(),
                download_complete: entry.download_complete.clone(),
                download_failed: entry.download_failed.clone(),
                total_bytes: None,
                ekey: Arc::new(std::sync::Mutex::new(ekey.map(|s| s.to_string()))),
                cek: Arc::new(std::sync::Mutex::new(cek.map(|s| s.to_string()))),
                post_check_pending: None,
                cenc_metadata: Arc::new(std::sync::Mutex::new(None)),
                cenc_streaming: Arc::new(AtomicBool::new(false)),
                download_error: Arc::new(std::sync::Mutex::new(None)),
            });
        }
    }

    let temp_path = cache_dir().join(format!("{}.dat", hash));

    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp_path)
        .map_err(|e| format!("创建缓存文件失败: {}", e))?;
    drop(file);

    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let download_complete = Arc::new(AtomicBool::new(false));
    let download_failed = Arc::new(AtomicBool::new(false));
    let post_check_pending = Arc::new(AtomicBool::new(false));
    let shared_ekey = Arc::new(std::sync::Mutex::new(ekey.map(|s| s.to_string())));
    let shared_cek = Arc::new(std::sync::Mutex::new(cek.map(|s| s.to_string())));
    let download_error: Arc<std::sync::Mutex<Option<String>>> =
        Arc::new(std::sync::Mutex::new(None));
    let cenc_metadata = Arc::new(std::sync::Mutex::new(None));
    let cenc_streaming = Arc::new(AtomicBool::new(false));

    let mut resume_from: u64 = 0;
    if let Some(head) = crate::player::audio_head_cache::lookup_for_inject(url) {
        let write_ok = OpenOptions::new()
            .write(true)
            .open(&temp_path)
            .and_then(|mut f| f.write_all(&head.bytes))
            .is_ok();
        if write_ok {
            resume_from = head.bytes.len() as u64;
            downloaded_bytes.store(resume_from, Ordering::Relaxed);
        }
    }

    let url_clone = url.to_string();
    let hash_clone = hash.clone();
    let headers_clone = headers.cloned();
    let ua_clone = user_agent.map(|s| s.to_string());
    let path_clone = temp_path.clone();
    let dl_bytes = downloaded_bytes.clone();
    let dl_complete = download_complete.clone();
    let dl_failed = download_failed.clone();
    let dl_post_check = post_check_pending.clone();
    let dl_ekey = shared_ekey.clone();
    let dl_cek = shared_cek.clone();
    let dl_error = download_error.clone();
    let dl_cenc_metadata = cenc_metadata.clone();
    let dl_cenc_streaming = cenc_streaming.clone();
    let panic_failed = download_failed.clone();
    let panic_error = download_error.clone();

    let handle = std::thread::spawn(move || {
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            download_thread(
                &url_clone,
                &hash_clone,
                headers_clone.as_ref(),
                ua_clone.as_deref(),
                resume_from,
                path_clone,
                dl_bytes,
                dl_complete,
                dl_failed,
                dl_post_check,
                dl_ekey,
                dl_cek,
                dl_error,
                dl_cenc_metadata,
                dl_cenc_streaming,
                allow_video,
            );
        }))
        .is_err();
        if panicked && !panic_failed.load(Ordering::Relaxed) {
            eprintln!("[stream_cache] 下载线程异常退出 (panic)");
            panic_failed.store(true, Ordering::Relaxed);
            if let Ok(mut err) = panic_error.lock() {
                *err = Some("下载线程内部异常".to_string());
            }
        }
    });

    mgr.entries.insert(
        hash,
        CacheEntry {
            path: temp_path.clone(),
            size: 0,
            last_accessed: SystemTime::now(),
            downloaded_bytes: downloaded_bytes.clone(),
            download_complete: download_complete.clone(),
            download_failed: download_failed.clone(),
            _download_handle: Some(handle),
        },
    );
    mgr.evict_if_needed();

    Ok(StreamingTempFileState {
        path: temp_path.to_string_lossy().to_string(),
        downloaded_bytes,
        download_complete,
        download_failed,
        total_bytes: None,
        ekey: shared_ekey,
        cek: shared_cek,
        post_check_pending: Some(post_check_pending),
        cenc_metadata,
        cenc_streaming,
        download_error,
    })
}

fn extract_audio_info_from_json(body: &str) -> Option<(String, Option<String>)> {
    let value: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => {
            let trimmed = body.trim().trim_matches('"');
            if trimmed != body.trim() {
                if let Ok(v) = serde_json::from_str(trimmed) {
                    v
                } else {
                    return None;
                }
            } else {
                return None;
            }
        }
    };

    let priority_keys = [
        "url",
        "musicUrl",
        "audioUrl",
        "playUrl",
        "play_url",
        "music_url",
        "link",
        "src",
        "file",
        "fileUrl",
        "file_url",
        "data",
        "result",
        "music",
        "audio",
        "source",
        "sourceUrl",
        "source_url",
        "media",
        "mediaUrl",
        "stream",
        "streamUrl",
        "stream_url",
        "cdn",
        "cdnUrl",
        "play",
        "download",
        "downloadUrl",
        "download_url",
    ];

    for key in &priority_keys {
        if let Some(found) = find_url_by_key(&value, key) {
            let ekey = find_ekey_in_json(&value);
            return Some((found, ekey));
        }
    }

    if let Some(url) = find_any_audio_url(&value) {
        let ekey = find_ekey_in_json(&value);
        return Some((url, ekey));
    }

    if let Some(url) = find_any_http_url(&value) {
        let ekey = find_ekey_in_json(&value);
        return Some((url, ekey));
    }

    None
}

fn sanitize_extracted_audio_url(url: &str) -> String {
    url.trim()
        .trim_matches(|c: char| {
            c.is_whitespace()
                || matches!(
                    c,
                    '`' | '\'' | '"' | ',' | '，' | ';' | '；' | '‘' | '’' | '“' | '”'
                )
        })
        .to_string()
}

fn extract_audio_info_from_text(body: &str) -> Option<(String, Option<String>)> {
    if let Some(info) = extract_audio_info_from_json(body) {
        return Some(info);
    }

    let trimmed = sanitize_extracted_audio_url(body);
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        if looks_like_audio_url(&trimmed) || !is_obviously_non_audio_url(&trimmed) {
            return Some((trimmed, None));
        }
    }

    if let Some(url) = extract_url_from_raw_text(body) {
        return Some((url, None));
    }

    None
}

fn find_ekey_in_json(value: &serde_json::Value) -> Option<String> {
    let ekey_keys = ["ekey", "eKey", "encryptKey", "encryptionKey"];
    find_string_by_keys(value, &ekey_keys)
}

fn find_string_by_keys(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            for &key in keys {
                if let Some(v) = map.get(key) {
                    if let Some(s) = v.as_str() {
                        if !s.is_empty() {
                            return Some(s.to_string());
                        }
                    }
                }
            }
            for v in map.values() {
                if let Some(found) = find_string_by_keys(v, keys) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_string_by_keys(v, keys) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn find_url_by_key(value: &serde_json::Value, key: &str) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(v) = map.get(key) {
                if let Some(s) = v.as_str() {
                    let clean = sanitize_extracted_audio_url(s);
                    if clean.starts_with("http://") || clean.starts_with("https://") {
                        return Some(clean);
                    }
                }
                if let Some(found) = find_url_by_key(v, key) {
                    return Some(found);
                }
            }
            for v in map.values() {
                if let Some(found) = find_url_by_key(v, key) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_url_by_key(v, key) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn find_any_audio_url(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => {
            let clean = sanitize_extracted_audio_url(s);
            if (clean.starts_with("http://") || clean.starts_with("https://"))
                && looks_like_audio_url(&clean)
            {
                Some(clean)
            } else {
                None
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                if let Some(found) = find_any_audio_url(v) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_any_audio_url(v) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn find_any_http_url(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => {
            let clean = sanitize_extracted_audio_url(s);
            if clean.starts_with("http://") || clean.starts_with("https://") {
                if !is_obviously_non_audio_url(&clean) {
                    return Some(clean);
                }
            }
            if s.starts_with("//") {
                let full = format!("https:{}", s);
                if !is_obviously_non_audio_url(&full) {
                    return Some(full);
                }
            }
            None
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                if let Some(found) = find_any_http_url(v) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_any_http_url(v) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn is_obviously_non_audio_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains(".html")
        || lower.contains(".htm")
        || lower.contains(".php")
        || lower.contains(".asp")
        || lower.contains(".aspx")
        || lower.contains(".jsp")
        || lower.contains(".css")
        || lower.contains(".js")
        || lower.contains(".png")
        || lower.contains(".jpg")
        || lower.contains(".jpeg")
        || lower.contains(".gif")
        || lower.contains(".svg")
        || lower.contains(".webp")
        || lower.contains(".ico")
        || lower.contains(".woff")
        || lower.contains(".ttf")
        || lower.contains(".pdf")
        || lower.contains(".zip")
        || lower.contains(".rar")
        || lower.contains(".doc")
        || lower.contains(".docx")
}

fn extract_url_from_raw_text(text: &str) -> Option<String> {
    for prefix in &["https://", "http://"] {
        if let Some(start) = text.find(prefix) {
            let rest = &text[start..];
            let end = rest
                .find(|c: char| {
                    c.is_whitespace()
                        || c == '"'
                        || c == '\''
                        || c == '<'
                        || c == '>'
                        || c == ','
                        || c == '}'
                })
                .unwrap_or(rest.len());
            let url = &rest[..end];
            if url.len() > 10 && !is_obviously_non_audio_url(url) {
                return Some(sanitize_extracted_audio_url(url));
            }
        }
    }
    None
}

fn looks_like_audio_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains(".mp3")
        || lower.contains(".flac")
        || lower.contains(".m4a")
        || lower.contains(".aac")
        || lower.contains(".ogg")
        || lower.contains(".wav")
        || lower.contains(".wma")
        || lower.contains(".opus")
        || lower.contains(".mga")
        || lower.contains(".mgg")
        || lower.contains("stream.qqmusic")
        || lower.contains("ws.stream.qqmusic")
        || lower.contains("dl.stream.qqmusic")
        || lower.contains("isure.stream")
        || lower.contains("trackmedia")
        || lower.contains("music.126.net")
        || lower.contains("m.kugou")
        || lower.contains("track.kg")
        || lower.contains("trackercdn.kugou")
        || lower.contains("fsandroid.kugou")
        || lower.contains("fsm.kugou")
        || lower.contains("mobilesdk.kugou")
        || lower.contains("kuwo")
        || lower.contains("car-lv.kuwo")
        || lower.contains("nmobi.kuwo")
        || lower.contains("sr.kuwo")
        || lower.contains("antiserver")
        || lower.contains("migu.cn")
        || lower.contains("miguvideo")
        || lower.contains("douyin.com")
        || lower.contains("pglstatp-toutiao.com")
        || lower.contains("pangolin-sdk-toutiao.com")
        || lower.contains("bytescm.com")
        || lower.contains("pstatp.com")
        || lower.contains("bytecdn.cn")
        || lower.contains("haitangw")
        || lower.contains("musicapi")
        || (lower.contains("/music")
            || lower.contains("/song")
            || lower.contains("/track")
            || lower.contains("/play"))
}

fn is_valid_audio_header(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }

    if &bytes[..3] == b"ID3" {
        return true;
    }

    if bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0 {
        return true;
    }

    if &bytes[..4] == b"fLaC" {
        return true;
    }

    if &bytes[..4] == b"RIFF" {
        return true;
    }

    if &bytes[..4] == b"OggS" {
        return true;
    }

    if &bytes[..4] == b"FORM" {
        return true;
    }

    if bytes.len() >= 8 && &bytes[4..8] == b"ftyp" {
        return true;
    }

    false
}

fn apply_stream_request_headers(
    mut req: reqwest::blocking::RequestBuilder,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
) -> reqwest::blocking::RequestBuilder {
    let has_plugin_user_agent = headers
        .map(|hdrs| {
            hdrs.keys()
                .any(|key| key.eq_ignore_ascii_case("user-agent"))
        })
        .unwrap_or(false);

    if !has_plugin_user_agent {
        if let Some(ua) = user_agent {
            req = req.header(reqwest::header::USER_AGENT, ua);
        }
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
    req
}

fn is_audio_content_type(content_type: &str) -> bool {
    let ct = content_type.trim().to_lowercase();
    if ct.is_empty() {
        return true;
    }
    ct.starts_with("audio/")
        || ct.contains("octet-stream")
        || ct.contains("mpegurl")
        || ct.contains("x-mpegurl")
}

/// 视频（MV）流缓存放宽：video/* 视为有效媒体内容。
fn is_media_content_type(content_type: &str, allow_video: bool) -> bool {
    if allow_video && content_type.trim().to_lowercase().starts_with("video/") {
        return true;
    }
    is_audio_content_type(content_type)
}

fn registrable_audio_domain(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let host = rest.split('/').next()?.split(':').next()?;
    let parts: Vec<&str> = host.split('.').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return Some(host.to_string());
    }
    Some(format!(
        "{}.{}",
        parts[parts.len() - 2],
        parts[parts.len() - 1]
    ))
}

fn http_only_audio_domains() -> &'static Mutex<std::collections::HashSet<String>> {
    static CACHE: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

fn send_audio_request(
    client: &reqwest::blocking::Client,
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    range_start: Option<u64>,
    allow_video: bool,
) -> Result<(reqwest::blocking::Response, String), String> {
    let with_range = |builder: reqwest::blocking::RequestBuilder| {
        if let Some(start) = range_start {
            builder.header(reqwest::header::RANGE, format!("bytes={start}-"))
        } else {
            builder
        }
    };
    if let Some(rest) = url.strip_prefix("http://") {
        let https_url = format!("https://{rest}");
        let skip_probe = registrable_audio_domain(url)
            .map(|d| http_only_audio_domains().lock().unwrap().contains(&d))
            .unwrap_or(false);
        if !skip_probe {
            let probe_ok = if let Ok(probe) = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_millis(800))
                .timeout(Duration::from_millis(1200))
                .gzip(true)
                .brotli(true)
                .deflate(true)
                .redirect(crate::security::ssrf::ip_literal_redirect_policy())
                .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
                .build()
            {
                match with_range(apply_stream_request_headers(
                    probe.get(&https_url),
                    headers,
                    user_agent,
                ))
                .send()
                {
                    Ok(r) => {
                        if r.status().is_success() {
                            let ct = r
                                .headers()
                                .get(reqwest::header::CONTENT_TYPE)
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("")
                                .to_lowercase();
                            if is_media_content_type(&ct, allow_video) {
                                return Ok((r, https_url));
                            }
                        }
                        false
                    }
                    Err(_) => false,
                }
            } else {
                false
            };
            if !probe_ok {
                if let Some(d) = registrable_audio_domain(url) {
                    http_only_audio_domains().lock().unwrap().insert(d);
                }
            }
        }
    }
    let r = with_range(apply_stream_request_headers(
        client.get(url),
        headers,
        user_agent,
    ))
    .send()
    .map_err(|e| e.to_string())?;
    Ok((r, url.to_string()))
}

fn download_thread(
    url: &str,
    hash: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    resume_from: u64,
    path: PathBuf,
    downloaded_bytes: Arc<AtomicU64>,
    download_complete: Arc<AtomicBool>,
    download_failed: Arc<AtomicBool>,
    post_check_pending: Arc<AtomicBool>,
    ekey: Arc<std::sync::Mutex<Option<String>>>,
    cek: Arc<std::sync::Mutex<Option<String>>>,
    download_error: Arc<std::sync::Mutex<Option<String>>>,
    cenc_metadata: Arc<std::sync::Mutex<Option<crate::player::cenc::CencMetadata>>>,
    cenc_streaming: Arc<AtomicBool>,
    allow_video: bool,
) {
    let fail_download = |reason: &str, bytes_written: u64| {
        eprintln!(
            "[stream_cache] 下载失败: {} (已下载 {} bytes)",
            reason, bytes_written
        );
        downloaded_bytes.store(bytes_written, Ordering::Relaxed);
        download_failed.store(true, Ordering::Relaxed);
        if let Ok(mut err) = download_error.lock() {
            *err = Some(reason.to_string());
        }
        if let Ok(mut mgr) = cache().lock() {
            mgr.update_size(hash, bytes_written);
            mgr.evict_if_needed();
        }
    };

    let has_cek = cek.lock().map(|c| c.is_some()).unwrap_or(false);
    if has_cek {
        post_check_pending.store(true, Ordering::Relaxed);
    }

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .redirect(crate::security::ssrf::ip_literal_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            fail_download(&format!("创建 HTTP 客户端失败: {}", e), 0);
            return;
        }
    };

    let mut response = match send_audio_request(
        &client,
        url,
        headers,
        user_agent,
        (resume_from > 0).then_some(resume_from),
        allow_video,
    ) {
        Ok((r, _)) => r,
        Err(e) => {
            fail_download(&format!("下载请求失败: {}", e), 0);
            return;
        }
    };

    if !response.status().is_success() {
        fail_download(&format!("HTTP {}", response.status()), 0);
        return;
    }

    let mut head_valid = resume_from > 0;

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let is_non_audio = content_type.contains("text/html")
        || content_type.contains("application/json")
        || content_type.contains("text/plain")
        || content_type.contains("application/xml")
        || content_type.contains("text/xml");
    if is_non_audio {
        head_valid = false;
        let body_text: String = response.text().unwrap_or_default();
        if let Some((real_url, json_ekey)) = extract_audio_info_from_text(&body_text) {
            if let Some(ref ek) = json_ekey {
                if let Ok(mut ekey_guard) = ekey.lock() {
                    if ekey_guard.is_none() {
                        *ekey_guard = Some(ek.clone());
                    }
                }
            }
            match send_audio_request(&client, &real_url, headers, user_agent, None, allow_video) {
                Ok((retry_resp, _)) if retry_resp.status().is_success() => {
                    let retry_ct = retry_resp
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_lowercase();
                    if retry_ct.contains("text/html")
                        || retry_ct.contains("application/json")
                        || retry_ct.contains("text/plain")
                        || retry_ct.contains("application/xml")
                        || retry_ct.contains("text/xml")
                    {
                        let retry_body: String = retry_resp.text().unwrap_or_default();
                        if let Some((real_url2, _)) = extract_audio_info_from_text(&retry_body) {
                            match send_audio_request(&client, &real_url2, headers, user_agent, None, allow_video)
                            {
                                Ok((resp2, _)) if resp2.status().is_success() => {
                                    let ct2 = resp2
                                        .headers()
                                        .get(reqwest::header::CONTENT_TYPE)
                                        .and_then(|v| v.to_str().ok())
                                        .unwrap_or("")
                                        .to_lowercase();
                                    if ct2.contains("text/html")
                                        || ct2.contains("application/json")
                                        || ct2.contains("text/plain")
                                    {
                                        fail_download(
                                            &format!(
                                                "二次提取的 URL 仍返回非音频内容 (Content-Type: {})",
                                                ct2
                                            ),
                                            0,
                                        );
                                        return;
                                    }
                                    response = resp2;
                                }
                                Ok((resp2, _)) => {
                                    fail_download(
                                        &format!("二次提取的 URL 返回 HTTP {}", resp2.status()),
                                        0,
                                    );
                                    return;
                                }
                                Err(e) => {
                                    fail_download(&format!("二次提取的 URL 请求失败: {}", e), 0);
                                    return;
                                }
                            }
                        } else {
                            fail_download(
                                &format!(
                                    "提取的 URL 仍返回非音频内容 (Content-Type: {})，二次提取失败",
                                    retry_ct
                                ),
                                0,
                            );
                            return;
                        }
                    } else {
                        response = retry_resp;
                    }
                }
                Ok((retry_resp, _)) => {
                    fail_download(&format!("提取的 URL 返回 HTTP {}", retry_resp.status()), 0);
                    return;
                }
                Err(e) => {
                    fail_download(&format!("提取的 URL 请求失败: {}", e), 0);
                    return;
                }
            }
        } else {
            fail_download(
                &format!(
                    "服务器返回非音频内容 (Content-Type: {})，URL提取失败",
                    content_type
                ),
                0,
            );
            return;
        }
    }

    let mut total_bytes = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let mut file = match OpenOptions::new().write(true).open(&path) {
        Ok(f) => f,
        Err(e) => {
            fail_download(&format!("打开缓存文件写入失败: {}", e), 0);
            return;
        }
    };

    let mut bytes_written: u64 =
        if head_valid && response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            if let Some(cr) = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
            {
                if let Some(t) = cr.rsplit('/').next().and_then(|s| s.parse::<u64>().ok()) {
                    total_bytes = Some(t);
                }
            }
            if file.seek(SeekFrom::Start(resume_from)).is_err() {
                fail_download("片头续传定位失败", 0);
                return;
            }
            resume_from
        } else {
            if head_valid {
                let _ = file.set_len(0);
                downloaded_bytes.store(0, Ordering::Relaxed);
            }
            let _ = file.seek(SeekFrom::Start(0));
            0
        };

    let mut buf = [0u8; 64 * 1024];
    let mut error: Option<String> = None;
    let mut cenc_probe_done = false;

    loop {
        match response.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if let Err(e) = file.write_all(&buf[..n]) {
                    error = Some(format!("写入缓存文件失败: {}", e));
                    break;
                }
                bytes_written += n as u64;
                downloaded_bytes.store(bytes_written, Ordering::Relaxed);

                if has_cek && !cenc_probe_done && bytes_written >= MIN_BUFFER_BYTES {
                    cenc_probe_done = true;
                    let probe_len = bytes_written.min(1024 * 1024) as usize;
                    let mut probe_buf = vec![0u8; probe_len];
                    if let Ok(mut f) = std::fs::File::open(&path) {
                        use std::io::Read as _;
                        if f.read_exact(&mut probe_buf).is_ok() {
                            let cek_str = cek.lock().ok().and_then(|c| c.clone());
                            if let Some(ref cek_str) = cek_str {
                                if let Ok(key) = crate::player::cenc::cek_to_key(cek_str) {
                                    if let Ok(Some(metadata)) =
                                        crate::player::cenc::parse_cenc_metadata(&probe_buf, &key)
                                    {
                                        if let Ok(mut md) = cenc_metadata.lock() {
                                            *md = Some(metadata);
                                        }
                                        cenc_streaming.store(true, Ordering::Relaxed);
                                        post_check_pending.store(false, Ordering::Relaxed);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error = Some(format!("下载流读取错误: {}", e));
                break;
            }
        }
    }

    let _ = file.flush();

    if let Some(error) = error {
        fail_download(&error, bytes_written);
        return;
    }

    if let Some(total) = total_bytes {
        if bytes_written != total {
            fail_download(
                &format!("下载字节数不完整: {} / {}", bytes_written, total),
                bytes_written,
            );
            return;
        }
    }

    let has_ekey = ekey.lock().map(|e| e.is_some()).unwrap_or(false);
    // 视频流（MV）跳过音频魔数校验：webm(EBML)/flv/m4s 均非音频头，
    // 非媒体错误页已由 Content-Type 检查拦截。
    if !has_ekey && !allow_video {
        if let Ok(mut verify_file) = File::open(&path) {
            let mut header = [0u8; 16];
            let header_len = verify_file.read(&mut header).unwrap_or(0);
            if header_len >= 4 && !is_valid_audio_header(&header[..header_len]) {
                let header_hex: String = header[..header_len]
                    .iter()
                    .map(|b| format!("{:02x}", b))
                    .collect::<Vec<_>>()
                    .join(" ");
                fail_download(
                    &format!("下载内容非有效音频格式 (header: {})", header_hex),
                    bytes_written,
                );
                post_check_pending.store(false, Ordering::Relaxed);
                return;
            }
        }
    }

    if has_cek && !cenc_streaming.load(Ordering::Relaxed) {
        let cek_str = cek.lock().ok().and_then(|c| c.clone());
        if let Some(ref cek_str) = cek_str {
            if let Err(e) = decrypt_cenc_file(&path, cek_str) {
                fail_download(&e, bytes_written);
                post_check_pending.store(false, Ordering::Relaxed);
                return;
            }
        }
        post_check_pending.store(false, Ordering::Relaxed);
    }

    download_complete.store(true, Ordering::Relaxed);

    // 更新缓存大小，并在完成后立即触发淘汰：否则多首歌下载完成而
    // 没有新下载启动时，current_size 会持续超出用户设置的上限。
    if let Ok(mut mgr) = cache().lock() {
        mgr.update_size(hash, bytes_written);
        mgr.evict_if_needed();
    }
}

pub fn is_buffer_ready(state: &StreamingTempFileState) -> bool {
    if let Some(ref flag) = state.post_check_pending {
        if flag.load(Ordering::Relaxed) {
            return false;
        }
    }
    state.downloaded_bytes() >= MIN_BUFFER_BYTES || state.is_download_finished()
}

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

#[cfg(test)]
mod tests {
    use super::is_audio_content_type;

    #[test]
    fn audio_content_type_detects_valid_audio() {
        assert!(is_audio_content_type("audio/mpeg"));
        assert!(is_audio_content_type("audio/flac"));
        assert!(is_audio_content_type("audio/mp4"));
        assert!(is_audio_content_type("application/octet-stream"));
        assert!(is_audio_content_type("application/vnd.apple.mpegurl"));
        assert!(is_audio_content_type("audio/x-mpegurl"));
        assert!(is_audio_content_type(""));
        assert!(is_audio_content_type("   "));
    }

    #[test]
    fn audio_content_type_rejects_error_pages() {
        assert!(!is_audio_content_type("text/html"));
        assert!(!is_audio_content_type("text/html; charset=utf-8"));
        assert!(!is_audio_content_type("application/json"));
        assert!(!is_audio_content_type("text/plain"));
        assert!(!is_audio_content_type("application/xml"));
        assert!(!is_audio_content_type("text/xml"));
        assert!(!is_audio_content_type("image/png"));
    }
}
