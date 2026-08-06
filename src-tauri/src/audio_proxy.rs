use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write, Seek, SeekFrom};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// Local audio proxy server — mirrors yyy project's LocalAudioProxy.kt.
///
/// Uses pure blocking I/O (like yyy's Java ServerSocket + OkHttp):
///   - `std::net::TcpListener` accept loop in a dedicated OS thread
///   - Each connection handled in its own thread with blocking reads/writes
///   - Upstream fetched via `reqwest::blocking`, streamed back in 16 KiB chunks
///   - CORS headers injected so the browser's Web Audio API works without "outputs zeroes"
pub struct AudioProxy {
    port: u16,
    #[allow(dead_code)]
    running: Arc<AtomicBool>,
}

impl AudioProxy {
    /// Spawn the proxy in a dedicated OS thread (mirrors yyy's `Thread({ acceptLoop() })`).
    ///
    /// Binds a random port on 127.0.0.1, starts the accept loop,
    /// and returns once the listener is ready.  Returns `None` on failure.
    pub fn spawn() -> Option<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").ok()?;
        let port = listener.local_addr().ok()?.port();
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();

        thread::Builder::new()
            .name("AudioProxy".into())
            .spawn(move || {
                // Mirrors yyy's acceptLoop()
                listener.set_nonblocking(false).ok();
                while running_clone.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((socket, _addr)) => {
                            socket.set_read_timeout(Some(Duration::from_secs(30))).ok();
                            // Mirrors yyy's Thread({ handleConnection(socket) })
                            let r = running_clone.clone();
                            thread::Builder::new()
                                .name("ProxyConn".into())
                                .spawn(move || Self::handle_connection(socket, r))
                                .ok();
                        }
                        Err(_) if !running_clone.load(Ordering::Relaxed) => break,
                        Err(_) => continue,
                    }
                }
            })
            .ok()?;

        Some(Self { port, running })
    }

    /// Returns the base URL of the proxy, e.g. `"http://127.0.0.1:54321"`.
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Build a proxied URL for a given remote audio URL.
    pub fn proxied_url(&self, remote_url: &str, headers: Option<&HashMap<String, String>>) -> String {
        let encoded = urlencoding::encode(remote_url);
        let mut url = format!("{}/proxy?u={}", self.base_url(), encoded);
        if let Some(headers) = headers {
            if !headers.is_empty() {
                if let Ok(headers_json) = serde_json::to_string(headers) {
                    url.push_str("&h=");
                    url.push_str(&urlencoding::encode(&headers_json));
                }
            }
        }
        url
    }

    /// Build a proxied URL for a local file path.
    pub fn local_url(&self, file_path: &str) -> String {
        let encoded = urlencoding::encode(file_path);
        format!("{}/local?path={}", self.base_url(), encoded)
    }

    /// Stop the proxy server.
    #[allow(dead_code)]
    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }

    // ── Connection handling (mirrors yyy's handleConnection) ──────────

    fn handle_connection(mut stream: TcpStream, _running: Arc<AtomicBool>) {
        let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));

        // Read HTTP request line + headers (mirrors yyy's readLine loop)
        let mut request_buf = Vec::with_capacity(4096);
        let mut header_buf = [0u8; 1];
        let mut prev_cr = false;

        loop {
            match stream.read(&mut header_buf) {
                Ok(0) | Err(_) => return, // EOF or error
                Ok(_) => {}
            }
            request_buf.push(header_buf[0]);

            // Detect end of headers: \r\n\r\n
            if header_buf[0] == b'\r' {
                prev_cr = true;
            } else if header_buf[0] == b'\n' && prev_cr {
                // Check if previous line was also \r\n (i.e., empty line = end of headers)
                let len = request_buf.len();
                if len >= 4 && &request_buf[len - 4..len - 2] == b"\r\n" {
                    break;
                }
                prev_cr = false;
            } else {
                prev_cr = false;
            }

            // Safety limit
            if request_buf.len() > 32 * 1024 {
                return;
            }
        }

        let request_str = match std::str::from_utf8(&request_buf) {
            Ok(s) => s,
            Err(_) => return,
        };

        // Parse request line: METHOD /path HTTP/1.x
        let (method, path) = match request_str.lines().next() {
            Some(line) => {
                let parts: Vec<&str> = line.split(' ').collect();
                if parts.len() >= 2 {
                    (parts[0], parts[1])
                } else {
                    return;
                }
            }
            None => return,
        };

        // Parse headers into a map (mirrors yyy's header parsing loop)
        let mut headers_map = HashMap::new();
        for line in request_str.lines().skip(1) {
            if line.is_empty() { break; }
            if let Some((key, value)) = line.split_once(": ") {
                headers_map.insert(key.to_lowercase(), value.to_string());
            }
        }

        // Handle GET and OPTIONS requests to /proxy?u=... or /local?path=...
        if path.starts_with("/local?") {
            Self::handle_local_file(&mut stream, &path, method, &headers_map);
            return;
        }

        if !path.starts_with("/proxy?") {
            send_error_response(&mut stream, 404, "Not Found");
            return;
        }

        // Handle CORS preflight (OPTIONS) — browser sends this before GET when crossOrigin is set
        if method == "OPTIONS" {
            let preflight = "HTTP/1.1 204 No Content\r\n\
                Access-Control-Allow-Origin: *\r\n\
                Access-Control-Allow-Methods: GET, OPTIONS\r\n\
                Access-Control-Allow-Headers: Range, User-Agent, Referer, Origin\r\n\
                Access-Control-Max-Age: 86400\r\n\
                Connection: close\r\n\r\n";
            let _ = stream.write_all(preflight.as_bytes());
            let _ = stream.flush();
            return;
        }

        if method != "GET" {
            send_error_response(&mut stream, 405, "Method Not Allowed");
            return;
        }

        // Parse ?u=<url_encoded> (mirrors yyy's session lookup by path)
        let remote_url = path
            .strip_prefix("/proxy?")
            .and_then(|qs| qs.split('&').find(|p| p.starts_with("u=")))
            .map(|p| &p[2..])
            .map(|e| urlencoding::decode(e).unwrap_or_default());

        let remote_url = match remote_url {
            Some(u) if !u.is_empty() => u.to_string(),
            _ => {
                send_error_response(&mut stream, 400, "Bad Request");
                return;
            }
        };

        let plugin_headers = path
            .strip_prefix("/proxy?")
            .and_then(|qs| qs.split('&').find(|p| p.starts_with("h=")))
            .map(|p| &p[2..])
            .and_then(|e| urlencoding::decode(e).ok())
            .and_then(|json| serde_json::from_str::<HashMap<String, String>>(&json).ok())
            .unwrap_or_default();

        // Extract Range header for seeking support
        let range_header = headers_map.get("range").cloned();

        // Fetch remote audio via reqwest (mirrors yyy's OkHttpClient.newCall().execute())
        // [修复防御]: 禁用自动解压，避免 Content-Length 与实际数据不匹配 (ERR_CONTENT_LENGTH_MISMATCH)
        // 连接超时 10s，总超时 120s（足够流式传输大文件）
        let client = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .build()
            .unwrap_or_default();

        let mut builder = client.get(&remote_url);
        if let Some(range) = &range_header {
            builder = builder.header("Range", range);
        }
        // [修复防御]: 为网易云等 CDN 添加 Referer，避免 500 拒绝
        let has_referer = plugin_headers.keys().any(|k| k.eq_ignore_ascii_case("Referer"));
        if !has_referer {
            if remote_url.contains("126.net") || remote_url.contains("netease.com") {
                builder = builder.header("Referer", "https://music.163.com/");
            }
        }
        for (key, value) in plugin_headers {
            let lower_key = key.to_ascii_lowercase();
            if lower_key == "host" || lower_key == "range" || value.trim().is_empty() {
                continue;
            }
            builder = builder.header(key, value);
        }
        // Set generic browser headers when the plugin did not provide its own.
        builder = builder.header(
            "User-Agent",
            headers_map
                .get("user-agent")
                .cloned()
                .unwrap_or_else(|| "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string()),
        );

        match builder.send() {
            Ok(resp) => {
                let status_code = resp.status().as_u16();
                let content_type = resp
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("audio/mpeg");
                let content_range = resp
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok());

                // Build response headers — mirroring yyy's StringBuilder assembly
                // [修复防御]: 使用正确的 HTTP 状态行，避免 "500 OK" 等非法格式
                let mut header_str = String::with_capacity(512);
                if status_code == 206 {
                    header_str.push_str("HTTP/1.1 206 Partial Content\r\n");
                } else if status_code == 200 {
                    header_str.push_str("HTTP/1.1 200 OK\r\n");
                } else {
                    header_str.push_str(&format!("HTTP/1.1 {} {}\r\n", status_code, resp.status().canonical_reason().unwrap_or("Unknown")));
                }
                header_str.push_str(&format!("Content-Type: {}\r\n", content_type));
                // [修复防御]: 绝不转发上游 Content-Length, 改用 chunked 传输
                // 上游 CDN 的 Content-Length 可能不准确 (压缩/解压不一致、连接提前断开),
                // 转发后浏览器检测到不匹配即报 ERR_CONTENT_LENGTH_MISMATCH 导致播放中断
                header_str.push_str("Transfer-Encoding: chunked\r\n");
                if let Some(cr) = content_range {
                    header_str.push_str(&format!("Content-Range: {}\r\n", cr));
                }
                header_str.push_str("Accept-Ranges: bytes\r\n");
                // CORS headers — the key addition for Web Audio API compatibility
                header_str.push_str("Access-Control-Allow-Origin: *\r\n");
                header_str.push_str("Access-Control-Allow-Methods: GET, OPTIONS\r\n");
                header_str.push_str("Access-Control-Allow-Headers: Range\r\n");
                header_str.push_str("Connection: close\r\n");
                header_str.push_str("\r\n");

                // Write headers (mirrors output.write(sb.toString()))
                if stream.write_all(header_str.as_bytes()).is_err() {
                    return;
                }
                let _ = stream.flush();

                // Stream body in chunks — mirroring yyy's byteStream() buffer loop
                // [修复防御]: 使用 chunked 传输编码, 每块前缀 hex 长度, 末尾 0\r\n\r\n 终止
                // (16 KiB buffer, same as yyy's ByteArray(16384))
                let mut resp_stream = resp;
                let mut buf = [0u8; 16384];
                loop {
                    match resp_stream.read(&mut buf) {
                        Ok(0) => {
                            // 结束 chunked 传输: 发送 0\r\n\r\n
                            let _ = stream.write_all(b"0\r\n\r\n");
                            break;
                        }
                        Ok(n) => {
                            // chunked 格式: hex(n)\r\n + data + \r\n
                            let chunk_header = format!("{:X}\r\n", n);
                            if stream.write_all(chunk_header.as_bytes()).is_err() { break; }
                            if stream.write_all(&buf[..n]).is_err() { break; }
                            if stream.write_all(b"\r\n").is_err() { break; }
                            let _ = stream.flush();
                        }
                        Err(_) => {
                            // 异常时也尝试结束 chunked 传输
                            let _ = stream.write_all(b"0\r\n\r\n");
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[AudioProxy] upstream fetch failed: {}", e);
                send_error_response(&mut stream, 502, "Bad Gateway");
            }
        }
    }
}

// ── Local file handler ──────────────────────────────────────────

impl AudioProxy {
    /// Serve a local file from disk with CORS headers.
    /// This allows `createMediaElementSource` to work with local audio files.
    fn handle_local_file(
        stream: &mut TcpStream,
        path: &str,
        method: &str,
        headers_map: &HashMap<String, String>,
    ) {
        // Handle CORS preflight
        if method == "OPTIONS" {
            let preflight = "HTTP/1.1 204 No Content\r\n\
                Access-Control-Allow-Origin: *\r\n\
                Access-Control-Allow-Methods: GET, OPTIONS\r\n\
                Access-Control-Allow-Headers: Range\r\n\
                Access-Control-Max-Age: 86400\r\n\
                Connection: close\r\n\r\n";
            let _ = stream.write_all(preflight.as_bytes());
            let _ = stream.flush();
            return;
        }

        if method != "GET" {
            send_error_response(stream, 405, "Method Not Allowed");
            return;
        }

        // Parse ?path=<encoded_path>
        let file_path = path
            .strip_prefix("/local?")
            .and_then(|qs| qs.split('&').find(|p| p.starts_with("path=")))
            .map(|p| &p[5..])
            .map(|e| urlencoding::decode(e).unwrap_or_default());

        let file_path = match file_path {
            Some(p) if !p.is_empty() => p.to_string(),
            _ => {
                send_error_response(stream, 400, "Bad Request");
                return;
            }
        };

        // Open the file
        let mut file = match File::open(&file_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[AudioProxy] cannot open local file '{}': {}", file_path, e);
                send_error_response(stream, 404, "File Not Found");
                return;
            }
        };

        // Get file size
        let file_size = match file.metadata() {
            Ok(m) => m.len(),
            Err(_) => {
                send_error_response(stream, 500, "Internal Server Error");
                return;
            }
        };

        // Determine content type from extension
        let content_type = match std::path::Path::new(&file_path)
            .extension()
            .and_then(|e| e.to_str())
        {
            Some("mp3") => "audio/mpeg",
            Some("flac") => "audio/flac",
            Some("wav") => "audio/wav",
            Some("ogg") => "audio/ogg",
            Some("m4a") => "audio/mp4",
            Some("aac") => "audio/aac",
            Some("wma") => "audio/x-ms-wma",
            Some("ape") => "audio/x-ape",
            Some("opus") => "audio/opus",
            _ => "audio/mpeg", // default
        };

        // Handle Range header for seeking
        let range_header = headers_map.get("range").cloned();
        let (status, range_start, range_end, content_length) = if let Some(ref range) = range_header {
            // Parse "bytes=start-end" or "bytes=start-"
            if let Some(range_spec) = range.strip_prefix("bytes=") {
                let parts: Vec<&str> = range_spec.split('-').collect();
                if parts.len() == 2 {
                    let start: u64 = parts[0].parse().unwrap_or(0);
                    let end: u64 = if parts[1].is_empty() {
                        file_size - 1
                    } else {
                        parts[1].parse().unwrap_or(file_size - 1).min(file_size - 1)
                    };
                    let len = end - start + 1;
                    (206, start, end, len)
                } else {
                    (200, 0, file_size - 1, file_size)
                }
            } else {
                (200, 0, file_size - 1, file_size)
            }
        } else {
            (200, 0, file_size - 1, file_size)
        };

        // Seek to start position
        if range_start > 0 {
            if file.seek(SeekFrom::Start(range_start)).is_err() {
                send_error_response(stream, 500, "Internal Server Error");
                return;
            }
        }

        // Build response headers
        let mut header_str = String::with_capacity(512);
        if status == 206 {
            header_str.push_str("HTTP/1.1 206 Partial Content\r\n");
            header_str.push_str(&format!(
                "Content-Range: bytes {}-{}/{}\r\n",
                range_start, range_end, file_size
            ));
        } else {
            header_str.push_str("HTTP/1.1 200 OK\r\n");
        }
        header_str.push_str(&format!("Content-Type: {}\r\n", content_type));
        header_str.push_str(&format!("Content-Length: {}\r\n", content_length));
        header_str.push_str("Accept-Ranges: bytes\r\n");
        // CORS headers — key for Web Audio API compatibility
        header_str.push_str("Access-Control-Allow-Origin: *\r\n");
        header_str.push_str("Access-Control-Allow-Methods: GET, OPTIONS\r\n");
        header_str.push_str("Access-Control-Allow-Headers: Range\r\n");
        header_str.push_str("Connection: close\r\n");
        header_str.push_str("\r\n");

        if stream.write_all(header_str.as_bytes()).is_err() {
            return;
        }
        let _ = stream.flush();

        // Stream file in 16 KiB chunks
        let mut buf = [0u8; 16384];
        let mut remaining = content_length as usize;
        loop {
            let to_read = remaining.min(buf.len());
            if to_read == 0 { break; }
            match file.read(&mut buf[..to_read]) {
                Ok(0) => break,
                Ok(n) => {
                    if stream.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    let _ = stream.flush();
                    remaining -= n;
                }
                Err(_) => break,
            }
        }
    }
}

fn send_error_response(stream: &mut TcpStream, code: u16, msg: &str) {
    let body = format!("{{\"error\":\"{}\"}}", msg);
    let resp = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        code, msg, body.len(), body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}
