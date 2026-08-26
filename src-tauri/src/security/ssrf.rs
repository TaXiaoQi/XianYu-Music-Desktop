//! 出站 URL 防 SSRF 统一校验。
//!
//! 音乐/封面直链、插件 HTTP、账号 API 等出站目标均需经过本模块：
//! - 仅允许 http/https
//! - 拒绝带用户凭据的 URL
//! - 端口收敛到常见 Web 端口
//! - 拒绝回环 / 私有 / link-local / 云元数据(169.254.169.254) / CGNAT / 多播 / 保留 IP
//!   等「不可信可伪造公网可达」的目标，防止借渲染进程/插件探测或访问内网与云元数据。
//!
//! > 说明：插件音源、在线搜索等业务本就要求「任意公网域名」，因此这里用
//! > IP 黑名单（仅公网可达）而非域名白名单；账号/更新等固定目标仍按各自配置收敛。

use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};

/// 允许显式使用的端口（缺省按 scheme 的 80/443 允许）。常见 Web/CDN 端口。
fn port_allowed(port: u16) -> bool {
    matches!(port, 80 | 443 | 3000 | 8000 | 8080 | 8443 | 8888)
}

/// 判断 IP 是否为不可信目标（内网/回环/保留等）。
pub fn forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => forbidden_ipv4(v4),
        IpAddr::V6(v6) => {
            // 仅真正映射到 IPv4 的地址（::ffff:a.b.c.d）才按 IPv4 判定。
            // 注意：不可直接短路 to_ipv4()，否则 ::1 会被映射成 0.0.0.1 而绕过回环判定。
            let seg = v6.segments();
            let ipv4_mapped = seg[0] == 0
                && seg[1] == 0
                && seg[2] == 0
                && seg[3] == 0
                && seg[4] == 0
                && seg[5] == 0
                && seg[6] == 0xffff;
            if ipv4_mapped {
                if let Some(v4) = v6.to_ipv4() {
                    return forbidden_ipv4(v4);
                }
            }
            v6.is_unspecified()
                || v6.is_loopback()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00 // ULA fc00::/7
                || (seg[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || seg[0] == 0 // ::/0 已被 is_unspecified 覆盖，此分支冗余防御
        }
    }
}

fn forbidden_ipv4(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    let a = o[0];
    let b = o[1];
    v4.is_unspecified()
        || v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_multicast()
        || v4.is_broadcast()
        || (a == 100 && (64..=127).contains(&b)) // 100.64.0.0/10 CGNAT 共享地址
        || (a == 192 && b == 0 && (o[2] == 2 || o[2] == 0)) // 192.0.0.0/24、192.0.2.0/24
        || (a == 198 && b == 18) // 198.18.0.0/15 基准测试
        || (a == 198 && b == 51 && o[2] == 100) // 198.51.100.0/24 文档
        || (a == 203 && b == 0 && o[2] == 113) // 203.0.113.0/24 文档
        || a >= 224 // 224.0.0.0/4 及以上（多播/保留）
}

/// 解析 host（域名或 IP 字面量）得到的全部地址中，任一命中不可信即拒绝。
fn check_host(host: &str, port: u16) -> Result<(), String> {
    // host 若本身是 IP 字面量，直接判定，避免依赖 DNS
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if forbidden_ip(ip) {
            Err(format!("目标地址被禁止（内网/保留地址）: {ip}"))
        } else {
            Ok(())
        };
    }

    // 域名：解析可能命中的全部地址，任一在禁区内都拒绝
    let target = format!("{host}:{port}");
    let addrs: Vec<IpAddr> = target
        .to_socket_addrs()
        .map_err(|e| format!("域名解析失败: {host} ({e})"))?
        .map(|sa| sa.ip())
        .collect();
    if addrs.is_empty() {
        return Err(format!("域名未解析到任何地址: {host}"));
    }
    for ip in addrs {
        if forbidden_ip(ip) {
            return Err(format!("目标地址被禁止（内网/保留地址）: {ip}"));
        }
    }
    Ok(())
}

/// 轻量出站校验：仅当 host 是 IP 字面量且命中禁区时拒绝。
///
/// 不做 DNS 解析、不做端口白名单，用于音源直链这类端口/IP 多样、不宜硬校验的播放目标，
/// 只挡"直写内网/回环/保留地址"这种明显恶意字面量。
pub fn validate_url_ip_literal(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("无效的 URL: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("仅允许 http/https，收到: {scheme}"));
    }
    // 域名不做 DNS 校验（避免误伤多 IP/CDN），仅拦截 IP 字面量命中禁区。
    // 注意 reqwest 的 host_str() 对 IPv6 会带方括号（如 [::1]），须先去掉再解析。
    let host = parsed.host_str().ok_or("URL 缺少主机名")?;
    let host_trim = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host_trim.parse::<IpAddr>() {
        if forbidden_ip(ip) {
            return Err(format!("目标地址被禁止（内网/保留地址）: {ip}"));
        }
    }
    Ok(())
}

/// 校验并解析出站 URL（同步版，供重定向策略等无法 await 的场景使用）。
///
/// 返回重组后的请求 URL 主体（scheme://host:port）供后续校验，并拒绝不可信目标。
pub fn validate_outbound_url_sync(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("无效的 URL: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("仅允许 http/https，收到: {scheme}"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("URL 不得包含用户凭据".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or("URL 缺少主机名".to_string())?
        // host_str 对 IPv6 会带方括号（如 [::1]），check_host 需识别为 IP 字面量
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let default_port: u16 = if scheme == "https" { 443 } else { 80 };
    if let Some(p) = parsed.port() {
        if !port_allowed(p) {
            return Err(format!("端口不在允许范围（80/443/3000/8000/8080/8443/8888）: {p}"));
        }
    }
    check_host(&host, parsed.port().unwrap_or(default_port))?;
    Ok(parsed)
}

/// 校验出站 URL（异步版，命令入口使用）。
///
/// 在同步校验的基础上，用 tokio 的 DNS 解析再校验一遍实际解析地址，
/// 以防御部分解析时序差异。
pub async fn validate_outbound_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = validate_outbound_url_sync(url)?;
    let host = parsed
        .host_str()
        .ok_or("URL 缺少主机名".to_string())?
        // host_str 对 IPv6 会带方括号（如 [::1]），先去掉便于按 IP 字面量识别
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let default_port: u16 = if parsed.scheme() == "https" { 443 } else { 80 };
    let port = parsed.port().unwrap_or(default_port);

    // 若 host 是 IP 字面量，同步校验已覆盖；仅域名再经 tokio 解析复核
    if host.parse::<IpAddr>().is_err() {
        match tokio::net::lookup_host((host.as_str(), port)).await {
            Ok(mut addrs) => {
                let mut resolved = false;
                let mut first_ip: Option<IpAddr> = None;
                while let Some(sa) = addrs.next() {
                    resolved = true;
                    let ip = sa.ip();
                    if first_ip.is_none() {
                        first_ip = Some(ip);
                    }
                    if forbidden_ip(ip) {
                        return Err(format!(
                            "目标地址被禁止（内网/保留地址）: {ip}"
                        ));
                    }
                }
                if !resolved {
                    return Err(format!("域名未解析到任何地址: {host}"));
                }
                let _ = first_ip;
            }
            Err(e) => return Err(format!("域名解析失败: {host} ({e})")),
        }
    }
    Ok(parsed)
}

/// 供重定向策略使用的目标校验：重定向跳转到不可信目标时返回错误。
///
/// reqwest 的 `Policy::custom` 是同步回调，这里用同步解析封堵内网跳转。
pub fn redirect_target_allowed(url: &str) -> bool {
    // 仅拦截明确不可信的目标；解析失败/异常一律视为拒绝（fail-closed）
    validate_outbound_url_sync(url).is_ok()
}

/// 构建内置 SSRF 防护的重定向策略：
/// 初始请求允许（跟随重定向），但每个跳转目标都需通过出站校验，否则视为致命错误。
/// 若客户端已禁用重定向则不启用策略（调用方负责）。
pub fn ssrf_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if !redirect_target_allowed(attempt.url().as_str()) {
            attempt.error(std::io::Error::other("重定向目标被安全策略禁止"))
        } else {
            attempt.follow()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forbidden_ipv4_covers_private_loopback_linklocal() {
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))));
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))));
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))));
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::new(224, 0, 0, 1))));
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::UNSPECIFIED)));
    }

    #[test]
    fn public_ipv4_allowed() {
        assert!(!forbidden_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!forbidden_ip(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
    }

    #[test]
    fn ipv6_loopback_ula_and_mapped_v4() {
        assert!(forbidden_ip(IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)));
        assert!(forbidden_ip(IpAddr::V6("fd00::1".parse().unwrap())));
        assert!(forbidden_ip(IpAddr::V6("fe80::1".parse().unwrap())));
        // ::ffff:127.0.0.1 → 127.0.0.1 被禁
        assert!(forbidden_ip(IpAddr::V6("::ffff:127.0.0.1".parse().unwrap())));
        assert!(!forbidden_ip(IpAddr::V6("2606:4700:4700::1111".parse().unwrap())));
    }

    #[test]
    fn rejects_bad_scheme_and_credentials() {
        assert!(validate_outbound_url_sync("file:///etc/passwd").is_err());
        assert!(validate_outbound_url_sync("ftp://example.com/x").is_err());
        assert!(validate_outbound_url_sync("https://user:pw@example.com/").is_err());
    }

    #[test]
    fn rejects_literal_private_ip_url() {
        assert!(validate_outbound_url_sync("http://127.0.0.1/admin").is_err());
        assert!(validate_outbound_url_sync("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_outbound_url_sync("http://192.168.0.1/x").is_err());
    }

    #[test]
    fn accepts_public_http_url() {
        assert!(validate_outbound_url_sync("https://example.com/song.mp3").is_ok());
        assert!(validate_outbound_url_sync("http://1.1.1.1/file.flac").is_ok());
    }

    #[test]
    fn rejects_uncommon_port() {
        assert!(validate_outbound_url_sync("http://example.com:3128/").is_err());
    }

    #[test]
    fn rejects_internal_ip_literal() {
        assert!(validate_url_ip_literal("http://127.0.0.1/x").is_err(), "127.0.0.1");
        assert!(validate_url_ip_literal("http://10.0.0.5/x").is_err(), "10.0.0.5");
        assert!(validate_url_ip_literal("http://169.254.169.254/latest/meta-data").is_err(), "meta");
        assert!(validate_url_ip_literal("http://[::1]/x").is_err(), "::1");
        assert!(validate_url_ip_literal("http://[::ffff:192.168.1.1]/x").is_err(), "v4mapped");
    }

    #[test]
    fn accepts_public_ip_literal_and_domain() {
        assert!(validate_url_ip_literal("http://1.1.1.1/file.flac").is_ok());
        assert!(validate_url_ip_literal("https://example.com/song.mp3").is_ok());
        // 域名不做 DNS/端口校验，仅非 http(s) scheme 才拒
        assert!(validate_url_ip_literal("ftp://example.com/x").is_err());
    }
}