// music/palette.rs - 封面取色（Tauri 命令层）
//
// 取色算法（HSL 桶聚类）已迁入共享仓库 XianYu-Music-Core，本文件仅保留桌面端
// 的 Tauri 命令包装与图片加载通道。HTTP 加载走 netproxy（系统代理），与 Core
// 的 tokio 直连版本不同；data: URI 与本地文件读取逻辑保持一致。

use base64::Engine;
use xianyu_core::music::palette::extract_palette_from_bytes;

fn load_image_bytes(source: &str) -> Result<Vec<u8>, String> {
    if let Some(rest) = source.strip_prefix("data:") {
        let comma = rest
            .find(',')
            .ok_or_else(|| "invalid data URI".to_string())?;
        let meta = &rest[..comma];
        let data = &rest[comma + 1..];
        if meta.contains("base64") {
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|e| e.to_string())
        } else {
            let decoded = percent_decode(data);
            Ok(decoded)
        }
    } else if source.starts_with("http://") || source.starts_with("https://") {
        crate::security::ssrf::validate_outbound_url_sync(&source)
            .map_err(|e| format!("图片源校验失败: {e}"))?;
        let client = crate::netproxy::blocking_client_builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
            .redirect(crate::security::ssrf::ssrf_redirect_policy())
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build()
            .map_err(|e| e.to_string())?;
        let bytes = client
            .get(source)
            .send()
            .map_err(|e| e.to_string())?
            .bytes()
            .map_err(|e| e.to_string())?;
        Ok(bytes.to_vec())
    } else {
        std::fs::read(source).map_err(|e| e.to_string())
    }
}

fn percent_decode(input: &str) -> Vec<u8> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

#[tauri::command]
pub async fn extract_palette(
    source: String,
    count: usize,
    color_boost: f64,
    depth: f64,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 图片加载失败或解码失败均返回静态回退调色板（Core 的
        // extract_palette_from_bytes 内部处理解码失败分支）。
        match load_image_bytes(&source) {
            Ok(bytes) => Ok(extract_palette_from_bytes(&bytes, count, color_boost, depth)),
            Err(_) => Ok(extract_palette_from_bytes(&[], count, color_boost, depth)),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
