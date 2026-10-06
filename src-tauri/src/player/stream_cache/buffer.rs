use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

pub const MIN_BUFFER_BYTES: u64 = 256 * 1024;

const SEEK_WAIT_TIMEOUT: Duration = Duration::from_secs(15);

pub struct StreamingTempFileReader {
    file: File,
    downloaded_bytes: Arc<AtomicU64>,
    download_complete: Arc<AtomicBool>,
    download_failed: Arc<AtomicBool>,
    pos: u64,
    total_bytes: Option<u64>,
    /// 下载线程实时回填的总长槽位：`total_bytes` 是 Clone 时刻快照（下载中必为 None），
    /// rodio ReadSeekSource 打开时靠 `seek(End(0))` 探测 byte_len，symphonia FLAC/MP3
    /// demuxer 的原地 seek 依赖该值，缺失会导致每次 seek 都退化成整链重建。
    content_length_shared: Arc<AtomicU64>,
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
            std::thread::sleep(Duration::from_millis(3)); // 轮询间隔
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
                // 下载中：Content-Length 已回填共享槽时以它为 End 基准，byte_len 探测据此成功，
                // symphonia 才能原地 seek（二分偏移可能超前下载前沿，由 Start 分支等待下载）。
                let shared_len = self.content_length_shared.load(Ordering::Relaxed);
                if shared_len > 0 {
                    let target = (shared_len as i64 + n).max(0) as u64;
                    self.pos = target;
                    return self.file.seek(SeekFrom::Start(target)).map(|_| target);
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
            std::thread::sleep(Duration::from_millis(3)); // 短暂让路
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
    /// 共享总长槽位（字节，0 = 未知）：下载线程拿到 Content-Length 后实时回填。
    /// `total_bytes` 是 Clone 时刻快照（start_streaming_download 返回时必然 None），
    /// symphonia FLAC/MP3 demuxer 的 seek 依赖 `MediaSource::byte_len()`，必须实时可读；
    /// new_reader() 将槽位注入 StreamingTempFileReader，End 定位/byte_len 探测据此实时可读。
    pub content_length_shared: Arc<AtomicU64>,
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
            content_length_shared: self.content_length_shared.clone(),
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

    /// 共享总长（字节）：下载线程回填 Content-Length 后实时可读，未知返回 None。
    /// symphonia FLAC/MP3 demuxer 的 seek 依赖 MediaSource::byte_len() 提供二分上界。
    /// 消费端待接线：rodio ReadSeekSource 的 byte_len 是一次性快照，换自定义 MediaSource 后启用。
    #[allow(dead_code)]
    pub fn shared_total_bytes(&self) -> Option<u64> {
        let v = self.content_length_shared.load(Ordering::Relaxed);
        if v == 0 {
            None
        } else {
            Some(v)
        }
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
