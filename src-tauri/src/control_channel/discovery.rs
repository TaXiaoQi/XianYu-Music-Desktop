// 控制通道 SSDP 通告：自家 ST（urn:xianyu-music:control:1）常驻 alive +
// M-SEARCH 应答，让移动端在局域网内免手输发现桌面端。与 DLNA 渲染器通告
// （dlna/ssdp.rs，随渲染器开关启停）独立生命周期；复用其组播 socket 绑定。

use crate::dlna::net_util::lan_ip;
use crate::dlna::ssdp::{
    bind_multicast_socket, tokio_udp_from_socket, SSDP_MULTICAST_V4, SSDP_PORT,
};
use socket2::Socket;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::sync::watch;

pub const CONTROL_ST: &str = "urn:xianyu-music:control:1";
const ALIVE_MAX_AGE: &str = "1800";

pub struct ControlAdvertiser {
    shutdown_tx: watch::Sender<bool>,
}

pub struct ControlAdvertiseConfig {
    pub port: u16,
    pub udn: String,
    pub name: String,
}

impl ControlAdvertiser {
    pub async fn start(cfg: ControlAdvertiseConfig) -> Result<Self, String> {
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        crate::dlna::spawn::spawn_persistent(async move {
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
    cfg: ControlAdvertiseConfig,
    mut shutdown_rx: watch::Receiver<bool>,
    ready_tx: tokio::sync::oneshot::Sender<Result<(), String>>,
) -> Result<(), String> {
    let sock: UdpSocket = match bind_multicast_socket() {
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

    let ip = lan_ip()
        .map(|i| i.to_string())
        .unwrap_or_else(|| "127.0.0.1".into());
    let location = format!("http://{ip}:{}", cfg.port);
    let target: SocketAddr = SocketAddrV4::new(SSDP_MULTICAST_V4, SSDP_PORT).into();
    let alive = alive_messages(&cfg.udn, &location, &ip, &cfg.port.to_string(), &cfg.name);
    let byebye = byebye_messages(&cfg.udn);

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
                let Some(st) = ssdp_header(&msg, "ST") else { continue };
                let matched = st == CONTROL_ST
                    || st == "ssdp:all"
                    || st == format!("uuid:{}", cfg.udn);
                if !matched {
                    continue;
                }
                rand_delay().await;
                let usn = if st.starts_with("uuid:") {
                    st.clone()
                } else {
                    format!("uuid:{}::{st}", cfg.udn)
                };
                let reply = format!(
                    "HTTP/1.1 200 OK\r\n\
                     CACHE-CONTROL: max-age={ALIVE_MAX_AGE}\r\n\
                     EXT:\r\n\
                     LOCATION: {location}\r\n\
                     SERVER: XianYu-Music/1.0 UPnP/1.0 XianYuControl/1.0\r\n\
                     ST: {st}\r\n\
                     USN: {usn}\r\n\
                     XY-CONTROL: {ip}:{}\r\n\
                     XY-NAME: {}\r\n\r\n",
                    cfg.port, cfg.name
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

fn alive_messages(udn: &str, location: &str, ip: &str, port: &str, name: &str) -> Vec<String> {
    let nt_usn = [
        (format!("uuid:{udn}"), format!("uuid:{udn}")),
        (
            CONTROL_ST.to_string(),
            format!("uuid:{udn}::{CONTROL_ST}"),
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
                 SERVER: XianYu-Music/1.0 UPnP/1.0 XianYuControl/1.0\r\n\
                 USN: {usn}\r\n\
                 XY-CONTROL: {ip}:{port}\r\n\
                 XY-NAME: {name}\r\n\r\n"
            )
        })
        .collect()
}

fn byebye_messages(udn: &str) -> Vec<String> {
    [
        format!("uuid:{udn}"),
        format!("uuid:{udn}::{CONTROL_ST}"),
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

fn ssdp_header(msg: &str, name: &str) -> Option<String> {
    msg.lines().skip(1).find_map(|line| {
        let (k, v) = line.split_once(':')?;
        if k.trim().eq_ignore_ascii_case(name) {
            Some(v.trim().to_string())
        } else {
            None
        }
    })
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
    fn alive_messages_carry_xy_headers() {
        let msgs = alive_messages("udn-1", "http://192.168.1.5:9979", "192.168.1.5", "9979", "PC");
        assert_eq!(msgs.len(), 2);
        assert!(msgs.iter().all(|m| m.contains("NTS: ssdp:alive")));
        assert!(msgs.iter().all(|m| m.contains("XY-CONTROL: 192.168.1.5:9979")));
        assert!(msgs.iter().all(|m| m.contains("XY-NAME: PC")));
        assert!(msgs.iter().any(|m| m.contains(CONTROL_ST)));
    }

    #[test]
    fn header_lookup_is_case_insensitive() {
        let msg = "M-SEARCH * HTTP/1.1\r\nst: urn:xianyu-music:control:1\r\n\r\n";
        assert_eq!(ssdp_header(msg, "ST").as_deref(), Some(CONTROL_ST));
    }
}
