use crate::remote::cache::RemoteStreamSource;
// 远程流一次后台预取的产出形态
enum FetchedSlice {
    // 命中 Range：拿到 [offset, offset+SLICE) 的分片，total 是服务器声明的总长
    Slice {
        offset: u64,
        payload: Vec<u8>,
        total: Option<u64>,
    },
    // 服务器无视 Range，整曲一次性返回
    WholeBody {
        payload: Vec<u8>,
    },
    // 预取失败（网络/状态码/IO）
    Failure {
        offset: u64,
        message: String,
    },
}

pub(crate) struct RemoteRangeReader {
    http: reqwest::blocking::Client,
    origin: RemoteStreamSource,
    cursor: u64,
    known_size: Option<u64>,
    slice_base: u64,
    slice: Vec<u8>,
    rangeless: bool,
    whole_payload: Option<Vec<u8>>,
    queued_slice: Arc<Mutex<Option<FetchedSlice>>>,
    slice_pending: Arc<AtomicBool>,
    pending_base: u64,
}

impl RemoteRangeReader {
    pub(crate) fn new(origin_source: RemoteStreamSource) -> Result<Self, String> {
        let http = crate::netproxy::blocking_client_builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .redirect(crate::security::ssrf::ip_literal_redirect_policy())
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            http,
            origin: origin_source,
            cursor: 0,
            known_size: None,
            slice_base: 0,
            slice: Vec::new(),
            rangeless: false,
            whole_payload: None,
            queued_slice: Arc::new(Mutex::new(None)),
            slice_pending: Arc::new(AtomicBool::new(false)),
            pending_base: 0,
        })
    }

    // Range 被无视时的兜底：整曲拉回内存
    fn download_entire(&mut self) -> std::io::Result<()> {
        let request = self.http.get(&self.origin.url);
        let mut response = Self::sign_request(request, &self.origin)
            .send()
            .map_err(std::io::Error::other)?;
        if !response.status().is_success() {
            return Err(std::io::Error::other(format!(
                "远程音频下载失败：{}",
                response.status()
            )));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let looks_like_page = content_type.contains("text/html")
            || content_type.contains("application/json")
            || content_type.contains("text/plain");
        let mut payload = Vec::new();
        response.read_to_end(&mut payload)?;
        if looks_like_page {
            return Err(std::io::Error::other(format!(
                "服务器返回非音频内容 (Content-Type: {})，可能需要防盗链 headers 或 URL 已失效",
                content_type
            )));
        }
        self.known_size = Some(payload.len() as u64);
        self.whole_payload = Some(payload);
        self.rangeless = true;
        Ok(())
    }

    // 按来源配置补齐认证、UA、防盗链与自定义头
    fn sign_request(
        request: reqwest::blocking::RequestBuilder,
        origin: &RemoteStreamSource,
    ) -> reqwest::blocking::RequestBuilder {
        let mut signed = match origin.username.as_deref().filter(|value| !value.is_empty()) {
            Some(account) => request.basic_auth(account.to_string(), origin.password.clone()),
            None => request,
        };
        if let Some(agent) = origin
            .user_agent
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            signed = signed.header(reqwest::header::USER_AGENT, agent);
        }
        if let Some(referrer) = origin.referer.as_deref().filter(|value| !value.is_empty()) {
            signed = signed.header(reqwest::header::REFERER, referrer);
        }
        if let Some(extra) = &origin.headers {
            for (key, value) in extra {
                if let (Ok(parsed_name), Ok(parsed_value)) = (
                    reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                    reqwest::header::HeaderValue::from_str(value),
                ) {
                    signed = signed.header(parsed_name, parsed_value);
                }
            }
        }
        signed
    }

    // 从 Content-Range: bytes x-y/total 中抠出总长
    fn response_total_size(response: &reqwest::blocking::Response) -> Option<u64> {
        let raw = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)?
            .to_str()
            .ok()?;
        let tail = raw.rsplit('/').next()?.trim();
        let size: u64 = tail.parse().ok()?;
        (size > 0).then_some(size)
    }

    // 离当前读取位置还有半片时，后台把下一片拉好
    fn queue_slice_prefetch(&mut self, from: u64) {
        if let Some(size) = self.known_size {
            if from >= size {
                return;
            }
        }
        *self
            .queued_slice
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        self.slice_pending.store(true, Ordering::Relaxed);
        self.pending_base = from;

        let http = self.http.clone();
        let origin = self.origin.clone();
        let slot = self.queued_slice.clone();
        let gate = self.slice_pending.clone();
        let until = from.saturating_add(STREAM_SLICE_BYTES - 1);

        thread::spawn(move || {
            let request = http
                .get(&origin.url)
                .header(reqwest::header::RANGE, format!("bytes={from}-{until}"));
            let result = match Self::sign_request(request, &origin).send() {
                Ok(mut response) => {
                    if response.status() == reqwest::StatusCode::OK {
                        // 服务器无视 Range，整曲读回
                        let mut payload = Vec::new();
                        match response.read_to_end(&mut payload) {
                            Ok(_) => FetchedSlice::WholeBody { payload },
                            Err(e) => FetchedSlice::Failure {
                                offset: from,
                                message: e.to_string(),
                            },
                        }
                    } else if response.status().is_success()
                        || response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                    {
                        let total = Self::response_total_size(&response);
                        let mut capped = response.by_ref().take(STREAM_SLICE_BYTES);
                        let mut payload = Vec::new();
                        match capped.read_to_end(&mut payload) {
                            Ok(_) => FetchedSlice::Slice {
                                offset: from,
                                payload,
                                total,
                            },
                            Err(e) => FetchedSlice::Failure {
                                offset: from,
                                message: e.to_string(),
                            },
                        }
                    } else {
                        FetchedSlice::Failure {
                            offset: from,
                            message: format!("HTTP {}", response.status()),
                        }
                    }
                }
                Err(e) => FetchedSlice::Failure {
                    offset: from,
                    message: e.to_string(),
                },
            };
            *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(result);
            gate.store(false, Ordering::Relaxed);
        });
    }

    // 预取已落地就取走结果；还在路上则返回 None
    fn collect_finished_prefetch(&mut self) -> Option<FetchedSlice> {
        if self.slice_pending.load(Ordering::Relaxed) {
            return None;
        }
        self.queued_slice
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
    }

    fn prefetch_still_running(&self) -> bool {
        self.slice_pending.load(Ordering::Relaxed)
    }

    fn drop_queued_prefetch(&mut self) {
        self.slice_pending.store(false, Ordering::Relaxed);
        *self
            .queued_slice
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }

    // 确保游标所在分片已就位：优先消费预取，落空则同步拉取
    fn load_slice_at(&mut self, from: u64) -> std::io::Result<()> {
        if let Some(prebuilt) = self.collect_finished_prefetch() {
            match prebuilt {
                FetchedSlice::Slice {
                    offset: slice_offset,
                    payload,
                    total,
                } if slice_offset == from => {
                    if let Some(size) = total {
                        self.known_size = Some(size);
                    } else if payload.len() < STREAM_SLICE_BYTES as usize {
                        self.known_size = Some(from + payload.len() as u64);
                    }
                    self.slice_base = from;
                    self.slice = payload;
                    return Ok(());
                }
                FetchedSlice::WholeBody { payload } => {
                    self.known_size = Some(payload.len() as u64);
                    self.whole_payload = Some(payload);
                    self.rangeless = true;
                    return Ok(());
                }
                FetchedSlice::Failure {
                    offset: failed_at,
                    message,
                } if failed_at == from => {
                    eprintln!("[Audio][remote] 流预取失败 start={failed_at}: {message}");
                }
                _ => {}
            }
        }

        let until = from.saturating_add(STREAM_SLICE_BYTES - 1);
        let request = self
            .http
            .get(&self.origin.url)
            .header(reqwest::header::RANGE, format!("bytes={from}-{until}"));
        let mut response = Self::sign_request(request, &self.origin)
            .send()
            .map_err(std::io::Error::other)?;
        if !(response.status().is_success()
            || response.status() == reqwest::StatusCode::PARTIAL_CONTENT)
        {
            return Err(std::io::Error::other(format!(
                "远程音频播放失败：{}",
                response.status()
            )));
        }
        if response.status() == reqwest::StatusCode::OK {
            // 没拿到 206：整曲读回后走 rangeless 通道
            let mut payload = Vec::new();
            response.read_to_end(&mut payload)?;
            self.known_size = Some(payload.len() as u64);
            self.whole_payload = Some(payload);
            self.rangeless = true;
            return Ok(());
        }

        if let Some(size) = Self::response_total_size(&response) {
            self.known_size = Some(size);
        }

        let mut capped = response.by_ref().take(STREAM_SLICE_BYTES);
        let mut payload = Vec::new();
        capped.read_to_end(&mut payload)?;
        self.slice_base = from;
        if self.known_size.is_none() && payload.len() < STREAM_SLICE_BYTES as usize {
            self.known_size = Some(from + payload.len() as u64);
        }
        self.slice = payload;
        Ok(())
    }

    // 读取前保证游标覆盖在有效分片内，并按余量决定是否提前 prefetch
    fn top_up_slice(&mut self) -> std::io::Result<()> {
        let slice_end = self.slice_base.saturating_add(self.slice.len() as u64);
        if self.cursor >= self.slice_base && self.cursor < slice_end {
            let left = slice_end - self.cursor;
            if left <= STREAM_SLICE_BYTES / 2 && !self.prefetch_still_running() {
                self.queue_slice_prefetch(slice_end);
            }
            return Ok(());
        }
        self.load_slice_at(self.cursor)?;
        let following_base = self.slice_base.saturating_add(self.slice.len() as u64);
        if !self.prefetch_still_running() {
            self.queue_slice_prefetch(following_base);
        }
        Ok(())
    }
}

impl Read for RemoteRangeReader {
    fn read(&mut self, sink_buf: &mut [u8]) -> std::io::Result<usize> {
        if sink_buf.is_empty() {
            return Ok(0);
        }

        // rangeless 通道：直接在整曲内存体上切片
        if self.rangeless {
            if self.whole_payload.is_none() {
                self.download_entire()?;
            }
            let payload = self
                .whole_payload
                .as_ref()
                .ok_or_else(|| std::io::Error::other("full_body not initialized"))?;
            let at = self.cursor as usize;
            if at >= payload.len() {
                return Ok(0);
            }
            let ready = payload.len() - at;
            let moved = ready.min(sink_buf.len());
            sink_buf[..moved].copy_from_slice(&payload[at..at + moved]);
            self.cursor = self.cursor.saturating_add(moved as u64);
            return Ok(moved);
        }

        if self
            .known_size
            .map(|size| self.cursor >= size)
            .unwrap_or(false)
        {
            return Ok(0);
        }

        self.top_up_slice()?;

        // top_up 可能触发整曲下载并切回 rangeless 通道
        if self.rangeless {
            return self.read(sink_buf);
        }

        if self.slice.is_empty() {
            return Ok(0);
        }

        let within = self.cursor.saturating_sub(self.slice_base) as usize;
        let ready = self.slice.len().saturating_sub(within);
        let moved = ready.min(sink_buf.len());
        sink_buf[..moved].copy_from_slice(&self.slice[within..within + moved]);
        self.cursor = self.cursor.saturating_add(moved as u64);
        Ok(moved)
    }
}

impl Seek for RemoteRangeReader {
    fn seek(&mut self, anchor: SeekFrom) -> std::io::Result<u64> {
        let resolved: i128 = match anchor {
            SeekFrom::Start(offset) => offset as i128,
            SeekFrom::Current(delta) => self.cursor as i128 + delta as i128,
            SeekFrom::End(delta) => {
                let size = match self.known_size {
                    Some(size) => size,
                    None => {
                        return Err(std::io::Error::other("远程音频长度未知，无法跳转"));
                    }
                };
                size as i128 + delta as i128
            }
        };
        if resolved < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "跳转位置不能小于 0",
            ));
        }
        self.drop_queued_prefetch();
        self.cursor = resolved as u64;
        Ok(self.cursor)
    }
}
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const STREAM_SLICE_BYTES: u64 = 2 * 1024 * 1024;
