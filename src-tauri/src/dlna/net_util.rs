use std::net::IpAddr;

pub fn lan_ip() -> Option<IpAddr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip())
}

pub fn lan_base_url(port: u16) -> String {
    let ip = lan_ip()
        .map(|i| i.to_string())
        .unwrap_or_else(|| "127.0.0.1".into());
    format!("http://{ip}:{port}")
}
