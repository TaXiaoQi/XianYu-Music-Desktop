// WebDAV 访问层：URL 拼接、PROPFIND 解析、歌词文本读取与音频落盘。
// 对外行为（请求头、请求体、状态码文案、断点续传语义）与前端契约保持一致。
use super::types::RemoteFileEntry;
use super::types::RemoteSourceCredentials;
use encoding_rs::GBK;
use quick_xml::events::{Event};
use reqwest::header::{HeaderMap, HeaderValue, RANGE};
use reqwest::{StatusCode, Client, Method};
use std::{collections::VecDeque, path::Path, sync::OnceLock, time::Duration};
use tokio::io::AsyncWriteExt as _;

/// 全局共享的 HTTP 客户端：带连接/总超时与 SSRF 防护（重定向策略 + 固定 DNS 解析器）。
pub(crate) fn shared_client() -> &'static Client {
    static WEBDAV_CLIENT: OnceLock<Client> = OnceLock::new();
    let initializer = || {
        let builder = Client::builder();
        builder
            .connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(300))
            .pool_max_idle_per_host(4).redirect(crate::security::ssrf::ip_literal_redirect_policy())
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build().expect("build webdav http client")
    };
    WEBDAV_CLIENT.get_or_init(initializer)
}

// ---------------------------------------------------------------------------
// 路径规整与 URL 拼接
// ---------------------------------------------------------------------------

/// 把任意写法的远程路径统一成 "/a/b" 形式：反斜杠转斜杠、补前导斜杠、去尾部斜杠。
fn canonical_remote_path(path: &str) -> String {
    let unified = path.replace('\\', "/").trim().to_string();
    if unified.is_empty() || unified == "/" { return "/".to_string(); }
    let leaded = if unified.starts_with('/') { unified } else { format!("/{unified}") };
    leaded.trim_end_matches('/').to_string()
}

/// 逐段百分号编码路径（保留分隔符）。
fn percent_encode_segments(path: &str) -> String {
    let pieces: Vec<String> = path
        .split('/')
        .filter(|piece| !piece.is_empty())
        .map(|piece| urlencoding::encode(piece).into_owned())
        .collect();
    pieces.join("/")
}

/// 把相对路径挂到音源根路径之下；已是根内绝对路径则原样返回。
fn request_path(source: &RemoteSourceCredentials, path: &str) -> String {
    let target = canonical_remote_path(path);
    let root = canonical_remote_path(&source.root_path);
    let root_prefix = format!("{root}/");
    if root == "/" || target == root || target.starts_with(&root_prefix) { return target; }
    if target == "/" { return root; }
    format!("{}/{}", root.trim_end_matches('/'), target.trim_start_matches('/'))
}

/// 拼出完整请求 URL：base_url 去尾斜杠 + 编码后的请求路径。
pub(crate) fn build_url(
    source: &RemoteSourceCredentials, path: &str,
) -> String {
    let base = source.base_url.trim_end_matches('/');
    let encoded = percent_encode_segments(&request_path(source, path));
    if encoded.is_empty() { format!("{base}/") } else { format!("{base}/{encoded}") }
}

/// 从路径里取出末段文件名；无末段时回退为原路径。
fn base_name_of(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some((_, last)) if !last.is_empty() => last.to_string(),
        _ if !trimmed.is_empty() => trimmed.to_string(),
        _ => path.to_string(),
    }
}

/// 支持的音频扩展名白名单。
const AUDIO_SUFFIXES: [&str; 13] = [
    "mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "aiff", "aif", "dsf", "dff", "ape", "wv",
];

/// 判断路径是否以受支持的音频扩展名结尾。
fn has_audio_suffix(path: &str) -> bool {
    let Some(suffix) = path.rsplit('.').next() else { return false };
    AUDIO_SUFFIXES.iter().any(|known| suffix.eq_ignore_ascii_case(known))
}

/// 非空用户名才附加 Basic 认证。
fn with_auth(
    request: reqwest::RequestBuilder, source: &RemoteSourceCredentials,
) -> reqwest::RequestBuilder {
    let needs_credentials = source.username.as_deref().map_or(false, |name| !name.trim().is_empty());
    if !needs_credentials { return request; }
    let username = source.username.clone().unwrap_or_default();
    request.basic_auth(username, source.password.clone())
}

// ---------------------------------------------------------------------------
// PROPFIND 响应解析
// ---------------------------------------------------------------------------

/// PROPFIND 请求体（多服务器兼容的最小属性集）。
const PROPFIND_REQUEST_BODY: &str = r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype />
    <d:getcontentlength />
    <d:getlastmodified />
    <d:getetag />
  </d:prop>
</d:propfind>"#;

/// 取 XML 限定名的本地部分（去掉命名空间前缀）。
fn xml_tag_local_name(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    match text.rsplit_once(':') {
        Some((_, local)) => local.to_string(),
        None => text.into_owned(),
    }
}

/// 一条 `<d:response>` 聚合出的属性。
#[derive(Default)]
struct MultistatusItem {
    href: String, size: u64, is_dir: bool,
    etag: Option<String>, modified_at: Option<String>,
}

/// 解析过程中的游标状态。
#[derive(Default)]
struct PropfindCursor {
    inside_response: bool,
    active_tag: String,
    item: MultistatusItem,
}

impl PropfindCursor {
    /// 进入新的 `<d:response>` 时清空聚合状态。
    fn begin_item(&mut self) {
        self.inside_response = true;
        self.item = MultistatusItem::default();
    }

    /// 把文本节点按当前标签归位。
    fn absorb_text(&mut self, text: &str) {
        match self.active_tag.as_str() {
            "href" => self.item.href = text.to_string(),
            "getcontentlength" => self.item.size = text.parse::<u64>().unwrap_or(0),
            "getetag" => self.item.etag = Some(text.trim_matches('"').to_string()),
            "getlastmodified" => self.item.modified_at = Some(text.to_string()),
            _ => {}
        }
    }
}

/// 把响应里的 href 折算成相对音源根路径的 remote_path。
fn remote_path_from_href(href: &str, source: &RemoteSourceCredentials) -> Option<String> {
    let decoded = urlencoding::decode(href).ok()?.replace("\\", "/");
    let base_prefix = reqwest::Url::parse(&source.base_url).ok().map(|parsed| parsed.path().trim_end_matches('/').to_string()).unwrap_or_default();
    let trimmed_base = if !base_prefix.is_empty() && decoded.starts_with(&base_prefix) { decoded[base_prefix.len()..].to_string() } else { decoded };

    let candidate = canonical_remote_path(&trimmed_base);
    let root = canonical_remote_path(&source.root_path);
    if root == "/" || !candidate.starts_with(&root) { return Some(candidate); }
    let tail = candidate[root.len()..].trim_start_matches('/');
    Some(if tail.is_empty() { "/".to_string() } else { format!("/{tail}") })
}

/// 解析 207 Multistatus XML 为文件条目列表。
fn parse_multistatus(
    xml: &str, source: &RemoteSourceCredentials,
) -> Result<Vec<RemoteFileEntry>, String> {
    let mut reader = quick_xml::Reader::from_str(xml); reader.config_mut().trim_text(true);

    let mut entries = Vec::new();
    let mut cursor = PropfindCursor::default();

    loop {
        let event = reader.read_event().map_err(|e| e.to_string())?;
        let within = cursor.inside_response;
        match event {
            Event::Start(event) => {
                let tag = xml_tag_local_name(event.name().as_ref());
                if tag == "response" {
                    cursor.begin_item();
                } else if within {
                    if tag == "collection" { cursor.item.is_dir = true; }
                    cursor.active_tag = tag;
                }
            }
            Event::Empty(event) if within => {
                if xml_tag_local_name(event.name().as_ref()) == "collection" { cursor.item.is_dir = true; }
            }
            Event::Text(event) if within => {
                let payload = String::from_utf8_lossy(event.as_ref()).trim().to_string();
                cursor.absorb_text(&payload);
            }
            Event::End(event) => {
                let tag = xml_tag_local_name(event.name().as_ref());
                if tag == "response" && within {
                    if let Some(remote_path) = remote_path_from_href(&cursor.item.href, source) {
                        let finished = RemoteFileEntry {
                            name: base_name_of(&remote_path), remote_path,
                            size: cursor.item.size, is_dir: cursor.item.is_dir,
                            etag: cursor.item.etag.clone(), modified_at: cursor.item.modified_at.clone(),
                        };
                        entries.push(finished);
                    }
                    cursor.inside_response = false;
                }
                cursor.active_tag.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }

    Ok(entries)
}

// ---------------------------------------------------------------------------
// 远程操作
// ---------------------------------------------------------------------------

/// 列出某个远程目录的一级子项（Depth: 1），并剔除目录自身。
pub(crate) async fn list_directory(
    client: &Client, source: &RemoteSourceCredentials, path: &str,
) -> Result<Vec<RemoteFileEntry>, String> {
    let method = Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?;
    let mut headers = HeaderMap::new();
    // Depth: 1 只列一层；PROPFIND 请求体视为 XML。
    for (name, value) in [("Depth", "1"), ("Content-Type", "application/xml")] {
        headers.insert(name, HeaderValue::from_static(value));
    }

    let request = client.request(method, build_url(source, path)).headers(headers).body(PROPFIND_REQUEST_BODY.to_string());
    let response = with_auth(request, source).send().await.map_err(|e| e.to_string())?;

    let status = response.status();
    if !status.is_success() { return Err(format!("WebDAV 返回状态码 {status}")); }

    let body = response.text().await.map_err(|e| e.to_string())?;
    let current = canonical_remote_path(path);
    let entries = parse_multistatus(&body, source)?;
    Ok(entries.into_iter().filter(|entry| entry.remote_path != current).collect())
}

/// 从根目录开始广度优先收集全部音频文件。
pub(crate) async fn collect_audio_files(
    source: &RemoteSourceCredentials,
) -> Result<Vec<RemoteFileEntry>, String> {
    let client = shared_client();
    let mut queue: VecDeque<String> = VecDeque::new();
    queue.push_back("/".to_string());

    let mut audio_files = Vec::new();
    while let Some(directory) = queue.pop_front() {
        for entry in list_directory(&client, source, &directory).await? {
            if entry.is_dir { queue.push_back(entry.remote_path); }
            else if has_audio_suffix(&entry.remote_path) { audio_files.push(entry); }
        }
    }
    Ok(audio_files)
}

/// 连接测试：能列出根目录即视为可用。
pub(crate) async fn test_connection(
    source: &RemoteSourceCredentials,
) -> Result<(), String> {
    let client = shared_client(); list_directory(&client, source, "/").await.map(|_| ())
}

/// 文本解码：优先 UTF-8，失败回退 GBK，并剥离 BOM。
fn text_payload_from(bytes: &[u8]) -> String {
    let fallback = |_| GBK.decode(bytes).0.into_owned();
    let decoded = std::str::from_utf8(bytes).map(str::to_string).unwrap_or_else(fallback);
    decoded.trim_start_matches('\u{feff}').to_owned()
}

/// 读取远程文本文件（歌词等）；404 视为不存在。
pub(crate) async fn read_text_file(
    source: &RemoteSourceCredentials, path: &str,
) -> Result<Option<String>, String> {
    let requested = with_auth(shared_client().get(build_url(source, path)), source)
        .send().await.map_err(|e| e.to_string())?;

    if requested.status() == StatusCode::NOT_FOUND { return Ok(None); }
    let status = requested.status();
    if !status.is_success() { return Err(format!("WebDAV 返回状态码 {status}")); }

    let bytes = requested.bytes().await.map_err(|e| e.to_string())?;
    Ok(Some(text_payload_from(&bytes)))
}

/// 下载落盘策略：已有部分数据且服务端返回 206 时追加，否则整文件重写。
enum TransferMode {
    ResumeFrom(u64),
    Rewrite,
}

fn transfer_mode_for(existing_bytes: u64, status: StatusCode) -> TransferMode {
    match (existing_bytes > 0, status == StatusCode::PARTIAL_CONTENT) {
        (true, true) => TransferMode::ResumeFrom(existing_bytes),
        _ => TransferMode::Rewrite,
    }
}

/// 下载远程文件到本地路径，边下边回调进度（已下载字节, 总字节）。
pub(crate) async fn download_file_to_path(
    source: &RemoteSourceCredentials, remote_path: &str, target_path: &Path,
    mut on_progress: impl FnMut(u64, Option<u64>) + Send,
) -> Result<(), String> {
    let client = shared_client(); let resumed_at = tokio::fs::metadata(target_path).await.map(|meta| meta.len()).unwrap_or(0);

    let mut outgoing = client.get(build_url(source, remote_path));
    if resumed_at > 0 { outgoing = outgoing.header(RANGE, format!("bytes={resumed_at}-")); }
    let mut response = with_auth(outgoing, source).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() { return Err(format!("远程文件下载失败：{status}")); }

    let mode = transfer_mode_for(resumed_at, response.status());
    let declared = response.content_length();
    let (total, mut downloaded, mut sink) = match mode {
        TransferMode::ResumeFrom(offset) => {
            let stream = tokio::fs::OpenOptions::new().append(true).open(target_path).await
                .map_err(|e| e.to_string())?;
            (declared.map(|length| offset + length), offset, stream)
        }
        TransferMode::Rewrite => {
            let fresh = tokio::fs::File::create(target_path).await.map_err(|e| e.to_string())?;
            (declared, 0, fresh)
        }
    };
    on_progress(downloaded, total);

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        let grown = downloaded.saturating_add(chunk.len() as u64); downloaded = grown;
        sink.write_all(&chunk).await.map_err(|e| e.to_string())?;
        on_progress(downloaded, total);
    }
    sink.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;

    fn source_with(base_url: &str, root_path: &str) -> RemoteSourceCredentials {
        let credentials = RemoteSourceCredentials {
            id: "source".into(), name: "Source".into(), provider: "webdav".into(),
            base_url: base_url.into(), username: None, password: None,
            root_path: root_path.into(), enabled: true,
            last_sync_at: None, last_sync_error: None, created_at: 0, updated_at: 0,
        };
        credentials
    }

    #[test]
    fn url_keeps_root_prefix_for_root_relative_target() {
        let source = source_with("https://dav.example.com", "/music");
        assert_eq!(build_url(&source, "/song.wav"), "https://dav.example.com/music/song.wav");
    }

    #[test]
    fn url_avoids_duplicating_root_prefix() {
        let source = source_with("https://dav.example.com", "/music");
        assert_eq!(build_url(&source, "/music/song.wav"), "https://dav.example.com/music/song.wav");
    }

    #[test]
    fn url_merges_base_path_with_root_path() {
        let source = source_with("https://dav.example.com/dav", "/music");
        assert_eq!(build_url(&source, "/song.wav"), "https://dav.example.com/dav/music/song.wav");
    }

    #[test]
    fn href_conversion_strips_configured_root() {
        let source = source_with("https://dav.example.com", "/music");
        assert_eq!(remote_path_from_href("/music/song.wav", &source), Some("/song.wav".into()));
        assert_eq!(remote_path_from_href("/music/", &source), Some("/".into()));
    }

    #[test]
    fn partial_content_with_existing_bytes_resumes() {
        assert!(matches!(transfer_mode_for(1024, StatusCode::PARTIAL_CONTENT), TransferMode::ResumeFrom(1024)));
    }

    #[test]
    fn full_content_restarts_download() {
        assert!(matches!(transfer_mode_for(1024, StatusCode::OK), TransferMode::Rewrite));
    }

    #[test]
    fn empty_local_file_restarts_download() {
        assert!(matches!(transfer_mode_for(0, StatusCode::OK), TransferMode::Rewrite));
    }

    #[test]
    fn gbk_encoded_lyrics_decode_correctly() {
        let encoded = GBK.encode("[00:01.00]中文歌词").0;
        assert_eq!(text_payload_from(&encoded), "[00:01.00]中文歌词");
    }

    #[test]
    fn utf8_bom_is_removed_from_lyrics() {
        assert_eq!(text_payload_from(b"\xef\xbb\xbf[00:01.00]hello"), "[00:01.00]hello");
    }
}
