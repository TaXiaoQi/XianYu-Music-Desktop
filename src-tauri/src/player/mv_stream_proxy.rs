//! MV 流式代理：把 MV 直链映射到本地 HTTP 服务，数据统一走歌曲的流缓存池
//! （stream_cache），同享 LRU 上限与「清理缓存」。已完整下载的部分本地伺服，
//! 未命中回源透传——播放即流式，不再整段下载到独立目录。

use axum::body::Body;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio_util::io::ReaderStream;

use super::stream_cache;

#[derive(Default)]
struct SourceMeta {
    headers: HashMap<String, String>,
    content_type: Option<String>,
}

fn registry() -> &'static Mutex<HashMap<String, SourceMeta>> {
    static REG: OnceLock<Mutex<HashMap<String, SourceMeta>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 注册某 MV 直链的请求头（注册表 key 与流缓存 key 对齐）。
pub fn register_mv_source(url: &str, headers: HashMap<String, String>) {
    let key = stream_cache::stream_cache_key(url);
    if let Ok(mut reg) = registry().lock() {
        reg.entry(key).or_default().headers = headers;
    }
}

fn source_headers(url: &str) -> HashMap<String, String> {
    let key = stream_cache::stream_cache_key(url);
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&key)
        .map(|meta| meta.headers.clone())
        .unwrap_or_default()
}

fn remember_content_type(url: &str, ct: String) {
    let key = stream_cache::stream_cache_key(url);
    if let Ok(mut reg) = registry().lock() {
        reg.entry(key).or_default().content_type = Some(ct);
    }
}

fn known_content_type(url: &str) -> Option<String> {
    let key = stream_cache::stream_cache_key(url);
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&key)
        .and_then(|meta| meta.content_type.clone())
}

fn upstream_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(60))
            .redirect(crate::security::ssrf::ssrf_redirect_policy())
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Range {
    None,
    /// bytes=N-
    From(u64),
    /// bytes=N-M（M 含端点）
    FromTo(u64, u64),
    /// bytes=-N
    Suffix(u64),
}

fn parse_range(spec: Option<&str>) -> Range {
    let Some(spec) = spec else {
        return Range::None;
    };
    let Some(rest) = spec.trim().strip_prefix("bytes=") else {
        return Range::None;
    };
    let Some(first) = rest.split(',').next() else {
        return Range::None;
    };
    let Some((s, e)) = first.trim().split_once('-') else {
        return Range::None;
    };
    let (s, e) = (s.trim(), e.trim());
    if s.is_empty() {
        return e.parse::<u64>().map(Range::Suffix).unwrap_or(Range::None);
    }
    let Ok(start) = s.parse::<u64>() else {
        return Range::None;
    };
    if e.is_empty() {
        return Range::From(start);
    }
    match e.parse::<u64>() {
        Ok(end) if end >= start => Range::FromTo(start, end),
        _ => Range::None,
    }
}

fn empty_response(status: StatusCode) -> Response {
    Response::builder()
        .status(status)
        .body(Body::empty())
        .unwrap()
}

fn with_common_headers(
    builder: axum::http::response::Builder,
    ct: Option<&str>,
) -> axum::http::response::Builder {
    let mut builder = builder.header(axum::http::header::ACCEPT_RANGES, "bytes");
    if let Some(ct) = ct {
        builder = builder.header(axum::http::header::CONTENT_TYPE, ct);
    }
    builder
}

fn range_not_satisfiable(size: u64) -> Response {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(axum::http::header::CONTENT_RANGE, format!("bytes */{size}"))
        .body(Body::empty())
        .unwrap()
}

/// 缓存完整：整个文件本地流式伺服（不占内存，tokio 分块读盘）。
async fn serve_local_complete(url: &str, range: Range) -> Option<Response> {
    let completed = stream_cache::open_completed_cache(url).ok()?;
    let size = completed.size;
    let (status, start, end) = match range {
        Range::None => (StatusCode::OK, 0, size.saturating_sub(1)),
        Range::From(s) => {
            if s >= size {
                return Some(range_not_satisfiable(size));
            }
            (StatusCode::PARTIAL_CONTENT, s, size - 1)
        }
        Range::FromTo(s, e) => {
            if s >= size {
                return Some(range_not_satisfiable(size));
            }
            (StatusCode::PARTIAL_CONTENT, s, e.min(size - 1))
        }
        Range::Suffix(n) => {
            let n = n.min(size);
            (StatusCode::PARTIAL_CONTENT, size - n, size - 1)
        }
    };
    let len = end - start + 1;
    let mut file = completed.file;
    use std::io::Seek as _;
    file.seek(std::io::SeekFrom::Start(start)).ok()?;
    let ct = known_content_type(url);
    let stream = ReaderStream::with_capacity(tokio::fs::File::from_std(file), 256 * 1024);
    let mut builder = Response::builder().status(status);
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            axum::http::header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{size}"),
        );
    }
    with_common_headers(builder, ct.as_deref())
        .header(axum::http::header::CONTENT_LENGTH, len)
        .body(Body::from_stream(stream))
        .ok()
}

/// 明确区间整体落在已下载前缀内：直接读本地字节伺服（避免重复回源）。
fn serve_local_prefix(url: &str, start: u64, end: u64) -> Option<Response> {
    let want = end - start + 1;
    let data = stream_cache::cache_read_range(url, start, want as usize).ok()?;
    if (data.len() as u64) != want {
        return None;
    }
    let ct = known_content_type(url);
    with_common_headers(
        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(
                axum::http::header::CONTENT_RANGE,
                format!("bytes {start}-{end}/*"),
            ),
        ct.as_deref(),
    )
    .header(axum::http::header::CONTENT_LENGTH, want)
    .body(Body::from(data))
    .ok()
}

/// 未命中缓存：回源透传（含 Range）。206/200 均转发主体流；
/// 上游不支持 Range 返回 200 时同样透传（浏览器可容错）。
async fn serve_upstream(url: &str, range: Range) -> Response {
    let mut req = upstream_client().get(url);
    for (key, value) in source_headers(url) {
        if !key.trim().is_empty() && !value.trim().is_empty() {
            req = req.header(key.as_str(), value.as_str());
        }
    }
    req = match range {
        Range::None => req,
        Range::From(s) => req.header("range", format!("bytes={s}-")),
        Range::FromTo(s, e) => req.header("range", format!("bytes={s}-{e}")),
        Range::Suffix(n) => req.header("range", format!("bytes=-{n}")),
    };

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[mv-proxy] upstream 请求失败: {e}");
            return empty_response(StatusCode::BAD_GATEWAY);
        }
    };
    let status = resp.status();
    if !status.is_success() {
        eprintln!("[mv-proxy] upstream 返回 HTTP {}", status);
        return empty_response(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
        );
    }

    let ct = resp
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if let Some(ref ct) = ct {
        remember_content_type(url, ct.clone());
    }
    let content_length = resp
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let content_range = resp
        .headers()
        .get(axum::http::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let mut builder = Response::builder().status(
        if status.as_u16() == 206 {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        },
    );
    if let Some(ref cr) = content_range {
        builder = builder.header(axum::http::header::CONTENT_RANGE, cr);
    }
    if let Some(cl) = content_length {
        builder = builder.header(axum::http::header::CONTENT_LENGTH, cl);
    }
    with_common_headers(builder, ct.as_deref())
        .body(Body::from_stream(resp.bytes_stream()))
        .unwrap_or_else(|_| empty_response(StatusCode::BAD_GATEWAY))
}

/// axum 未启用 query feature，手动解析 `?u=<encoded>`。
fn parse_mv_query(query: Option<&str>) -> Option<String> {
    let query = query?;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        if key == "u" {
            return urlencoding::decode(value)
                .ok()
                .map(|decoded| decoded.into_owned());
        }
    }
    None
}

async fn serve_mv(uri: axum::http::Uri, headers: HeaderMap) -> Response {
    let Some(url) = parse_mv_query(uri.query()) else {
        return empty_response(StatusCode::BAD_REQUEST);
    };
    let url = url.trim().to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return empty_response(StatusCode::BAD_REQUEST);
    }
    let range = parse_range(
        headers
            .get(axum::http::header::RANGE)
            .and_then(|v| v.to_str().ok()),
    );

    // 1) 缓存完整 → 全部本地伺服。
    if stream_cache::mv_cache_status(&url).complete {
        if let Some(resp) = serve_local_complete(&url, range).await {
            return resp;
        }
    }
    // 2) 明确区间且整体落在已下载前缀内 → 本地读。
    if let Range::FromTo(start, end) = range {
        if let Some(resp) = serve_local_prefix(&url, start, end) {
            return resp;
        }
    }
    // 3) 未命中 → 回源透传（后台流缓存继续推进，完整后转为本地伺服）。
    serve_upstream(&url, range).await
}

static START_LOCK: Mutex<Option<u16>> = Mutex::new(None);

/// 惰性启动本地 MV 代理（127.0.0.1 随机端口），进程内只启动一次。
pub async fn ensure_started() -> Result<u16, String> {
    {
        let guard = START_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(port) = *guard {
            return Ok(port);
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<u16, String>>();
    tokio::spawn(async move {
        let app = Router::new().route("/mv", get(serve_mv));
        match tokio::net::TcpListener::bind(("127.0.0.1", 0)).await {
            Ok(listener) => {
                let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
                if let Err(e) = axum::serve(listener, app).await {
                    eprintln!("[mv-proxy] 服务退出: {e}");
                    let _ = tx.send(Err(format!("MV 代理服务退出: {e}")));
                } else {
                    let _ = tx.send(Err("MV 代理服务已停止".to_string()));
                }
            }
            Err(e) => {
                let _ = tx.send(Err(format!("MV 代理端口绑定失败: {e}")));
            }
        }
    });
    let port = rx
        .await
        .map_err(|_| "MV 代理启动失败".to_string())??;
    if port == 0 {
        return Err("MV 代理端口无效".to_string());
    }
    let mut guard = START_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(port);
    Ok(port)
}

/// 前端入口：注册流缓存 + 请求头，返回本地代理 URL（缓存 key = MV 直链）。
#[tauri::command]
pub async fn mv_proxy_url(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Unsupported video URL".to_string());
    }
    crate::security::ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| e.to_string())?;
    register_mv_source(&url, headers.unwrap_or_default());
    let url_for_start = url.clone();
    // start_streaming_download_video 涉及文件创建/线程启动，放阻塞线程池避免卡 tokio worker。
    tokio::task::spawn_blocking(move || {
        let hdrs = source_headers(&url_for_start);
        stream_cache::start_streaming_download_video(&url_for_start, Some(&hdrs), None)
    })
    .await
    .map_err(|e| format!("MV 流缓存启动失败: {e}"))??;
    let port = ensure_started().await?;
    Ok(format!(
        "http://127.0.0.1:{port}/mv?u={}",
        urlencoding::encode(&url)
    ))
}
