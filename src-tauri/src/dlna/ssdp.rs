use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::sync::watch;

pub const SSDP_MULTICAST_V4: Ipv4Addr = Ipv4Addr::new(239, 255, 255, 250);
pub const SSDP_PORT: u16 = 1900;
pub const ALIVE_MAX_AGE: &str = "1800";

fn bind_multicast_socket() -> std::io::Result<Socket> {
    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    sock.set_reuse_address(true)?;
    #[cfg(unix)]
    let _ = sock.set_reuse_port(true);
    let bind_addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, SSDP_PORT));
    sock.bind(&bind_addr.into())?;
    if let Err(e) = sock.join_multicast_v4(&SSDP_MULTICAST_V4, &Ipv4Addr::UNSPECIFIED) {
        eprintln!("[dlna] join SSDP multicast group failed: {e}");
    }
    Ok(sock)
}

fn tokio_udp_from_socket(sock: Socket) -> std::io::Result<UdpSocket> {
    sock.set_nonblocking(true)?;
    let std_sock: std::net::UdpSocket = sock.into();
    UdpSocket::from_std(std_sock)
}

fn header_value(msg: &str, name: &str) -> Option<String> {
    msg.lines().skip(1).find_map(|line| {
        let (k, v) = line.split_once(':')?;
        if k.trim().eq_ignore_ascii_case(name) {
            Some(v.trim().to_string())
        } else {
            None
        }
    })
}

pub async fn search_renderers(timeout_ms: u64) -> Vec<String> {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else {
        return Vec::new();
    };
    let target: SocketAddr = SocketAddrV4::new(SSDP_MULTICAST_V4, SSDP_PORT).into();
    let mut packet = String::from("M-SEARCH * HTTP/1.1\r\n");
    packet.push_str("HOST: 239.255.255.250:1900\r\n");
    packet.push_str("MAN: \"ssdp:discover\"\r\n");
    packet.push_str("MX: 3\r\n");
    packet.push_str("ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n");
    let ssdp_all = packet.replace(
        "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n",
        "ST: ssdp:all\r\n",
    );

    for p in [&packet, &ssdp_all] {
        let _ = sock.send_to(p.as_bytes(), target).await;
    }

    let mut found: Vec<String> = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms.max(300));
    let mut buf = vec![0u8; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, sock.recv_from(&mut buf)).await {
            Ok(Ok((n, _from))) => {
                let msg = String::from_utf8_lossy(&buf[..n]).to_string();
                if !msg.starts_with("HTTP/1.1 200") {
                    continue;
                }
                if let Some(loc) = header_value(&msg, "LOCATION") {
                    if !found.contains(&loc) {
                        found.push(loc);
                    }
                }
            }
            _ => break,
        }
    }
    found
}

pub struct SsdpAdvertiser {
    shutdown_tx: watch::Sender<bool>,
}

pub struct AdvertiseConfig {
    pub udn: String,
    pub location: String,
}

impl SsdpAdvertiser {
    pub async fn start(cfg: AdvertiseConfig) -> Result<Self, String> {
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        super::spawn::spawn_persistent(async move {
            let _ = run_advertiser(cfg, shutdown_rx, ready_tx).await;
        });
        ready_rx
            .await
            .map_err(|_| "SSDP 任务启动失败".to_string())??;
        Ok(Self { shutdown_tx })
    }

    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(true);
    }
}

async fn run_advertiser(
    cfg: AdvertiseConfig,
    mut shutdown_rx: watch::Receiver<bool>,
    ready_tx: tokio::sync::oneshot::Sender<Result<(), String>>,
) -> Result<(), String> {
    let sock = match bind_multicast_socket() {
        Ok(s) => match tokio_udp_from_socket(s) {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("convert SSDP socket failed: {e}")));
                return Err(format!("convert SSDP socket failed: {e}"));
            }
        },
        Err(e) => {
            let _ = ready_tx.send(Err(format!("bind SSDP 1900 failed: {e}")));
            return Err(format!("bind SSDP 1900 failed: {e}"));
        }
    };
    let _ = ready_tx.send(Ok(()));
    let sock = Arc::new(sock);

    let udn = cfg.udn.clone();
    let location = cfg.location.clone();
    let target: SocketAddr = SocketAddrV4::new(SSDP_MULTICAST_V4, SSDP_PORT).into();
    let alive = alive_messages(&udn, &location);
    let byebye = byebye_messages(&udn);

    for _ in 0..2 {
        for msg in &alive {
            let _ = sock.send_to(msg.as_bytes(), target).await;
        }
    }

    let mut interval = tokio::time::interval(Duration::from_secs(30));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut buf = vec![0u8; 2048];

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => break,
            _ = interval.tick() => {
                for msg in &alive {
                    let _ = sock.send_to(msg.as_bytes(), target).await;
                }
            }
            res = sock.recv_from(&mut buf) => {
                let Ok((n, from)) = res else { break };
                let msg = String::from_utf8_lossy(&buf[..n]).to_string();
                if !msg.starts_with("M-SEARCH") {
                    continue;
                }
                let Some(st) = header_value(&msg, "ST") else { continue };
                let matched = st == "ssdp:all"
                    || st == "upnp:rootdevice"
                    || st == "urn:schemas-upnp-org:device:MediaRenderer:1"
                    || st == "urn:schemas-upnp-org:service:AVTransport:1"
                    || st == "urn:schemas-upnp-org:service:RenderingControl:1"
                    || st.starts_with("uuid:");
                if !matched {
                    continue;
                }
                let usn = if st.starts_with("uuid:") {
                    st.clone()
                } else {
                    format!("uuid:{udn}::{st}")
                };
                rand_delay().await;
                let reply = format!(
                    "HTTP/1.1 200 OK\r\n\
                     CACHE-CONTROL: max-age={ALIVE_MAX_AGE}\r\n\
                     EXT:\r\n\
                     LOCATION: {location}\r\n\
                     SERVER: XianYu-Music/1.0 UPnP/1.0 XianYuDLNA/1.0\r\n\
                     ST: {st}\r\n\
                     USN: {usn}\r\n\r\n"
                );
                let _ = sock.send_to(reply.as_bytes(), from).await;
            }
        }
    }

    for msg in &byebye {
        let _ = sock.send_to(msg.as_bytes(), target).await;
    }
    Ok(())
}

fn alive_messages(udn: &str, location: &str) -> Vec<String> {
    let nt_usn = [
        (format!("uuid:{udn}"), format!("uuid:{udn}")),
        (
            "upnp:rootdevice".to_string(),
            format!("uuid:{udn}::upnp:rootdevice"),
        ),
        (
            "urn:schemas-upnp-org:device:MediaRenderer:1".to_string(),
            format!("uuid:{udn}::urn:schemas-upnp-org:device:MediaRenderer:1"),
        ),
        (
            "urn:schemas-upnp-org:service:AVTransport:1".to_string(),
            format!("uuid:{udn}::urn:schemas-upnp-org:service:AVTransport:1"),
        ),
        (
            "urn:schemas-upnp-org:service:RenderingControl:1".to_string(),
            format!("uuid:{udn}::urn:schemas-upnp-org:service:RenderingControl:1"),
        ),
    ];
    nt_usn
        .into_iter()
        .map(|(nt, usn)| {
            format!(
                "NOTIFY * HTTP/1.1\r\n\
                 HOST: 239.255.255.250:1900\r\n\
                 CACHE-CONTROL: max-age={ALIVE_MAX_AGE}\r\n\
                 LOCATION: {location}\r\n\
                 NT: {nt}\r\n\
                 NTS: ssdp:alive\r\n\
                 SERVER: XianYu-Music/1.0 UPnP/1.0 XianYuDLNA/1.0\r\n\
                 USN: {usn}\r\n\r\n"
            )
        })
        .collect()
}

fn byebye_messages(udn: &str) -> Vec<String> {
    [
        format!("uuid:{udn}"),
        format!("uuid:{udn}::upnp:rootdevice"),
        format!("uuid:{udn}::urn:schemas-upnp-org:device:MediaRenderer:1"),
    ]
    .into_iter()
    .map(|nt| {
        format!(
            "NOTIFY * HTTP/1.1\r\n\
             HOST: 239.255.255.250:1900\r\n\
             NT: {nt}\r\n\
             NTS: ssdp:byebye\r\n\
             USN: {nt}\r\n\r\n"
        )
    })
    .collect()
}

async fn rand_delay() {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_millis() % 500)
        .unwrap_or(0);
    tokio::time::sleep(Duration::from_millis(ms as u64)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_lookup_is_case_insensitive() {
        let msg = "HTTP/1.1 200 OK\r\nLOCATION: http://1.2.3.4/desc.xml\r\nusn: uuid:x\r\n\r\n";
        assert_eq!(
            header_value(msg, "location").as_deref(),
            Some("http://1.2.3.4/desc.xml")
        );
        assert_eq!(header_value(msg, "USN").as_deref(), Some("uuid:x"));
        assert_eq!(header_value(msg, "NT"), None);
    }

    #[test]
    fn alive_messages_cover_required_types() {
        let msgs = alive_messages("udn-1", "http://1.2.3.4:9958/dlna/desc.xml");
        assert_eq!(msgs.len(), 5);
        assert!(msgs[0].contains("NTS: ssdp:alive"));
        assert!(msgs.iter().all(|m| m.contains("udn-1")));
    }

    #[tokio::test]
    async fn advertiser_answers_msearch_after_join() {
        let probe = match std::net::UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(_) => return,
        };
        probe
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        let adv = match SsdpAdvertiser::start(AdvertiseConfig {
            udn: "test-udn-1234".into(),
            location: "http://127.0.0.1:9958/dlna/desc.xml".into(),
        })
        .await
        {
            Ok(a) => a,
            Err(_) => return,
        };

        let target: SocketAddr = SocketAddrV4::new(SSDP_MULTICAST_V4, SSDP_PORT).into();
        let msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n";
        probe.send_to(msg.as_bytes(), target).unwrap();

        let mut buf = vec![0u8; 2048];
        let mut got = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match probe.recv_from(&mut buf) {
                Ok((n, _)) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if text.starts_with("HTTP/1.1 200") && text.contains("test-udn-1234") {
                        got = true;
                        break;
                    }
                }
                Err(_) => continue,
            }
        }
        adv.stop();
        assert!(got, "DMR 未应答 M-SEARCH（组播加入可能失败）");
    }
}
