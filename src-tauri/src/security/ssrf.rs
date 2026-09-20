use reqwest::dns::{Name, Resolve, Resolving};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

fn pinned_ips() -> &'static Mutex<HashMap<String, Vec<IpAddr>>> {
    static M: OnceLock<Mutex<HashMap<String, Vec<IpAddr>>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

fn record_pinned_ips(host: &str, ips: Vec<IpAddr>) {
    if let Ok(mut m) = pinned_ips().lock() {
        m.insert(host.to_ascii_lowercase(), ips);
    }
}

fn pinned_anchor(host: &str) -> Option<Vec<IpAddr>> {
    pinned_ips()
        .lock()
        .ok()?
        .get(&host.to_ascii_lowercase())
        .cloned()
}

/// 判定 IP 是否为代理 fake-ip 保留段（198.18.0.0/15）。
fn is_fake_ipv4(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            o[0] == 198 && (o[1] == 18 || o[1] == 19)
        }
        IpAddr::V6(_) => false,
    }
}

/// 判定 host 的钉住解析结果是否全部落在 fake-ip 保留段（198.18.0.0/15）。
///
/// 该段常见于代理软件 fake-ip 模式：本应用流量若被代理分应用排除（不走 TUN），
/// 直连这些地址必然黑洞直至超时。用于在 HTTP 层快速失败并给出针对性提示，
/// 正常走 TUN 的场景（fake-ip 连接被代理接管）不受影响，仍照常请求。
pub fn host_is_fake_ip_target(host: &str) -> bool {
    match pinned_anchor(host) {
        Some(ips) if !ips.is_empty() => ips.iter().all(is_fake_ipv4),
        _ => false,
    }
}

#[derive(serde::Deserialize)]
struct DohAnswerRecord {
    #[serde(rename = "type")]
    _type: i64,
    data: String,
}

#[derive(serde::Deserialize)]
struct DohResponse {
    #[serde(default, rename = "Answer")]
    answer: Vec<DohAnswerRecord>,
}

/// 用公共 DNS 的 DoH JSON API（IP 直连，不依赖系统 DNS）解析域名真实 A 记录。
///
/// 用于 fake-ip 环境：系统 DNS 被代理接管返回 198.18.0.0/15 假地址，而本应用
/// 又被代理分应用排除（直连假地址黑洞）时，绕过系统 DNS 拿到真实 IP 直连。
/// 结果已过滤内网/保留段（SSRF 防线不放松）。
pub async fn resolve_real_ips_via_doh(host: &str) -> Result<Vec<IpAddr>, String> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    let client = CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(4))
                .no_proxy()
                .build()
                .ok()
        })
        .clone()
        .ok_or_else(|| "DoH 客户端初始化失败".to_string())?;

    let endpoints = [
        format!("https://223.5.5.5/resolve?name={host}&type=A"),
        format!("https://120.53.53.53/dns-query?name={host}&type=A"),
    ];
    for ep in endpoints {
        let ok = async {
            let resp = client
                .get(&ep)
                .header("accept", "application/dns-json")
                .send()
                .await
                .ok()?;
            let text = resp.text().await.ok()?;
            let parsed: DohResponse = serde_json::from_str(&text).ok()?;
            let ips: Vec<IpAddr> = parsed
                .answer
                .iter()
                .filter(|a| a._type == 1)
                .filter_map(|a| a.data.parse::<IpAddr>().ok())
                .filter(|ip| !forbidden_ip(*ip) && !is_fake_ipv4(ip))
                .collect();
            if ips.is_empty() {
                None
            } else {
                Some(ips)
            }
        };
        if let Some(ips) = ok.await {
            return Ok(ips);
        }
    }
    Err(format!("DoH 解析失败: {host}"))
}

pub async fn resolve_allowed_ips(host: &str, port: u16) -> Result<Vec<IpAddr>, String> {
    let mut addrs = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("域名解析失败: {host} ({e})"))?;
    let mut out: Vec<IpAddr> = Vec::new();
    while let Some(sa) = addrs.next() {
        let ip = sa.ip();
        if forbidden_ip(ip) {
            return Err(format!("目标地址被禁止（内网/保留地址）: {ip}"));
        }
        if !out.contains(&ip) {
            out.push(ip);
        }
    }
    if out.is_empty() {
        return Err(format!("域名未解析到任何地址: {host}"));
    }
    Ok(out)
}

#[derive(Clone, Debug, Default)]
pub struct OutboundDnsResolver;

impl Resolve for OutboundDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_ascii_lowercase();
        Box::pin(async move {
            let ips: Vec<IpAddr> = match pinned_anchor(&host) {
                Some(ips) if !ips.is_empty() => ips,
                _ => resolve_allowed_ips(&host, 443)
                    .await
                    .map_err(boxed_io_err)?,
            };
            let addrs: Box<dyn Iterator<Item = SocketAddr> + Send> =
                Box::new(ips.into_iter().map(|ip| SocketAddr::new(ip, 0)));
            Ok(addrs)
        })
    }
}

pub fn pinned_dns_resolver() -> std::sync::Arc<OutboundDnsResolver> {
    std::sync::Arc::new(OutboundDnsResolver)
}

fn boxed_io_err(e: String) -> Box<dyn std::error::Error + Send + Sync> {
    std::io::Error::other(e).into()
}

fn port_allowed(port: u16) -> bool {
    matches!(port, 80 | 443 | 3000 | 8000 | 8080 | 8082 | 8443 | 8888)
}

pub fn forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => forbidden_ipv4(v4),
        IpAddr::V6(v6) => {
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
                || (seg[0] & 0xfe00) == 0xfc00
                || (seg[0] & 0xffc0) == 0xfe80
                || seg[0] == 0
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
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && (o[2] == 2 || o[2] == 0))
        || (a == 198 && b == 18)
        || (a == 198 && b == 51 && o[2] == 100)
        || (a == 203 && b == 0 && o[2] == 113)
        || a >= 224
}

fn check_host(host: &str) -> Result<(), String> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if forbidden_ip(ip) {
            Err(format!("目标地址被禁止（内网/保留地址）: {ip}"))
        } else {
            Ok(())
        };
    }
    Ok(())
}

pub fn validate_url_ip_literal(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("无效的 URL: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("仅允许 http/https，收到: {scheme}"));
    }
    let host = parsed.host_str().ok_or("URL 缺少主机名")?;
    let host_trim = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host_trim.parse::<IpAddr>() {
        if forbidden_ip(ip) {
            return Err(format!("目标地址被禁止（内网/保留地址）: {ip}"));
        }
    }
    Ok(())
}

pub fn ip_literal_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if validate_url_ip_literal(attempt.url().as_str()).is_ok() {
            attempt.follow()
        } else {
            attempt.error(std::io::Error::other("重定向目标被安全策略禁止"))
        }
    })
}

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
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    if let Some(p) = parsed.port() {
        if !port_allowed(p) {
            return Err(format!(
                "端口不在允许范围（80/443/3000/8000/8080/8082/8443/8888）: {p}"
            ));
        }
    }
    check_host(&host)?;
    Ok(parsed)
}

pub async fn validate_outbound_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = validate_outbound_url_sync(url)?;
    let host = parsed
        .host_str()
        .ok_or("URL 缺少主机名".to_string())?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let default_port: u16 = if parsed.scheme() == "https" { 443 } else { 80 };
    let port = parsed.port().unwrap_or(default_port);

    if host.parse::<IpAddr>().is_err() {
        let mut ips = resolve_allowed_ips(&host, port).await?;
        // fake-ip 环境（系统 DNS 被代理接管返回 198.18.0.0/15 且本应用未走其隧道时
        // 直连黑洞）：用 DoH 独立解析真实 IP 替换钉住值，TLS/SNI 仍按域名、SSRF 过滤保留
        if ips.iter().all(is_fake_ipv4) {
            if let Ok(real) = resolve_real_ips_via_doh(&host).await {
                ips = real;
            }
        }
        record_pinned_ips(&host, ips);
    }
    Ok(parsed)
}

pub fn redirect_target_allowed(url: &str) -> bool {
    validate_outbound_url_sync(url).is_ok()
}

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

    #[tokio::test]
    async fn outbound_connectivity_u_y_qq_com() {
        // 真实连通性测试：验证 validate_outbound_url + reqwest 请求 QQ 接口全链路
        let url = validate_outbound_url("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .await
            .expect("validate_outbound_url 应通过");
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("client 构建失败");
        let resp = client
            .get(url)
            .send()
            .await
            .expect("QQ 接口请求应成功（网络层连通）");
        assert!(resp.status().is_success(), "状态码异常: {}", resp.status());
    }

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
        assert!(forbidden_ip(IpAddr::V6(
            "::ffff:127.0.0.1".parse().unwrap()
        )));
        assert!(!forbidden_ip(IpAddr::V6(
            "2606:4700:4700::1111".parse().unwrap()
        )));
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
        assert!(
            validate_url_ip_literal("http://127.0.0.1/x").is_err(),
            "127.0.0.1"
        );
        assert!(
            validate_url_ip_literal("http://10.0.0.5/x").is_err(),
            "10.0.0.5"
        );
        assert!(
            validate_url_ip_literal("http://169.254.169.254/latest/meta-data").is_err(),
            "meta"
        );
        assert!(validate_url_ip_literal("http://[::1]/x").is_err(), "::1");
        assert!(
            validate_url_ip_literal("http://[::ffff:192.168.1.1]/x").is_err(),
            "v4mapped"
        );
    }

    #[test]
    fn accepts_public_ip_literal_and_domain() {
        assert!(validate_url_ip_literal("http://1.1.1.1/file.flac").is_ok());
        assert!(validate_url_ip_literal("https://example.com/song.mp3").is_ok());
        assert!(validate_url_ip_literal("ftp://example.com/x").is_err());
    }

    #[tokio::test]
    async fn outbound_dns_resolver_uses_pinned_ips_without_network() {
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        record_pinned_ips("pinned.example", vec![ip]);
        let resolver = pinned_dns_resolver();
        let name: reqwest::dns::Name = "pinned.example".parse().unwrap();
        let fut = resolver.resolve(name);
        let mut addr = tokio::time::timeout(std::time::Duration::from_secs(2), fut)
            .await
            .expect("resolver 不应超时")
            .expect("解析应成功");
        assert!(addr.any(|sa| sa.ip() == ip));
    }

    #[tokio::test]
    async fn outbound_dns_resolver_rejects_pinned_forbidden_redirect_rebinding() {
        let resolver = pinned_dns_resolver();
        let name: reqwest::dns::Name = "ssrf-rebinding-fail.invalid".parse().unwrap();
        let fut = resolver.resolve(name);
        let res = tokio::time::timeout(std::time::Duration::from_secs(2), fut)
            .await
            .expect("resolver 不应超时");
        match res {
            Err(_) => {}
            Ok(addr) => {
                for sa in addr {
                    assert!(!forbidden_ip(sa.ip()), "兜底不允许返回内网 IP");
                }
            }
        }
    }
}
