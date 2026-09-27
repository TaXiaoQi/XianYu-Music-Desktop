// 桌面 TCP 控制通道：移动端/腕上端（经移动中继）在局域网内遥控桌面播放器。
// 复用移动端腕表 WatchLink 帧协议（见 protocol.rs 模块注释）。
// 架构：Rust 纯协议层（本模块）+ TS 语义层（cmd 经 tauri 事件上交、
// 播放状态经 command 推回广播）。

pub mod commands;
pub mod discovery;
pub mod pairing;
pub mod protocol;
pub mod server;

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::mpsc;

pub use server::{ServerEvent, ServerGuard};

/// 9979 固定主端口（避开 httpd 9958..=9978），被占时向后顺延。
const PORT_RANGE: std::ops::RangeInclusive<u16> = 9979..=9983;

pub struct ControlCore {
    port: AtomicU64,
    /// server 保活句柄：保留 broadcast/kick 能力；生产进程内随进程退出。
    guard: Mutex<Option<Arc<ServerGuard>>>,
    event_rx: tokio::sync::Mutex<Option<mpsc::Receiver<ServerEvent>>>,
    /// 鉴权与配对状态（config_dir 初始化后存在）。
    pairing: OnceLock<Arc<pairing::PairingManager>>,
    /// SSDP 自家通告（随「允许遥控」开关启停）。
    advertiser: Arc<Mutex<Option<discovery::ControlAdvertiser>>>,
    /// 通告启动哨兵（start 是异步的，防止重复 spawn）。
    adv_running: std::sync::atomic::AtomicBool,
}

static CORE: OnceLock<ControlCore> = OnceLock::new();

impl ControlCore {
    pub fn shared() -> &'static ControlCore {
        CORE.get_or_init(|| ControlCore {
            port: AtomicU64::new(0),
            guard: Mutex::new(None),
            event_rx: tokio::sync::Mutex::new(None),
            pairing: OnceLock::new(),
            advertiser: Arc::new(Mutex::new(None)),
            adv_running: std::sync::atomic::AtomicBool::new(false),
        })
    }

    /// 注入鉴权策略（测试钩子；生产路径使用 init_pairing 注入 PairingManager）。
    pub fn set_auth(&self, auth: Arc<dyn server::HelloAuth>) {
        *CUSTOM_AUTH.lock().unwrap() = Some(auth);
    }

    /// 初始化配对管理器（幂等；须在 ensure_started 前调用）。
    pub fn init_pairing(&self, config_dir: &Path) -> Arc<pairing::PairingManager> {
        self.pairing
            .get_or_init(|| Arc::new(pairing::PairingManager::load(config_dir)))
            .clone()
    }

    pub fn pairing(&self) -> Option<Arc<pairing::PairingManager>> {
        self.pairing.get().cloned()
    }

    /// 启动 TCP 监听与 SSDP 通告（幂等）。事件经返回的 Receiver 上交
    /// （setup_app 消费 emit）。
    pub async fn ensure_started(&self) -> Result<u16, String> {
        let cur = self.port.load(Ordering::SeqCst) as u16;
        if cur != 0 {
            self.ensure_advertising();
            return Ok(cur);
        }
        let (event_tx, event_rx) = mpsc::channel::<ServerEvent>(64);
        let auth: Arc<dyn server::HelloAuth> = match self.pairing() {
            Some(pm) => pm.clone(),
            None => match CUSTOM_AUTH.lock().unwrap().clone() {
                Some(a) => a,
                None => Arc::new(OpenStub),
            },
        };
        let mut bound = None;
        for port in PORT_RANGE {
            match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
                Ok(l) => {
                    bound = Some(l);
                    break;
                }
                Err(_) => continue,
            }
        }
        let listener = bound.ok_or_else(|| "9979-9983 端口均被占用".to_string())?;
        let guard = Arc::new(server::serve(listener, auth, event_tx).await);
        self.port.store(guard.port as u64, Ordering::SeqCst);
        *self.guard.lock().unwrap() = Some(guard);
        *self.event_rx.lock().await = Some(event_rx);
        self.ensure_advertising();
        Ok(self.port.load(Ordering::SeqCst) as u16)
    }

    /// SSDP 通告保活：开关开启且未在通告时启动（start 为异步，经哨兵防重入）。
    fn ensure_advertising(&self) {
        let enabled = self.pairing().map(|p| p.is_enabled()).unwrap_or(true);
        if !enabled {
            return;
        }
        if self.adv_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let port = self.port();
        let Some(pm) = self.pairing() else {
            self.adv_running.store(false, Ordering::SeqCst);
            return;
        };
        let cfg = discovery::ControlAdvertiseConfig {
            port,
            udn: pm.udn(),
            name: pairing::desktop_name(),
        };
        let slot = self.advertiser.clone();
        crate::dlna::spawn::spawn_persistent(async move {
            match discovery::ControlAdvertiser::start(cfg).await {
                Ok(a) => *slot.lock().unwrap() = Some(a),
                Err(e) => eprintln!("[control] SSDP advertise failed: {e}"),
            }
        });
    }

    /// 重启通告（开关重新打开时调用）。
    pub fn restart_advertising(&self, _port: u16, _udn: &str) {
        self.stop_advertising();
        self.ensure_advertising();
    }

    /// 停止 SSDP 通告。
    pub fn stop_advertising(&self) {
        self.adv_running.store(false, Ordering::SeqCst);
        if let Some(a) = self.advertiser.lock().unwrap().take() {
            a.stop();
        }
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::SeqCst) as u16
    }

    /// 广播一帧给所有已鉴权 client。
    pub fn broadcast(&self, msg_type: u8, payload: &str) {
        if let Some(g) = self.guard.lock().unwrap().as_ref() {
            g.broadcast(msg_type, payload);
        }
    }

    pub fn client_count(&self) -> usize {
        self.guard
            .lock()
            .unwrap()
            .as_ref()
            .map(|g| g.client_count())
            .unwrap_or(0)
    }

    /// 当前在线 client 概要（设置页连接状态展示用）。
    pub fn connected_clients(&self) -> Vec<server::ClientSummary> {
        self.guard
            .lock()
            .unwrap()
            .as_ref()
            .map(|g| g.connected_clients())
            .unwrap_or_default()
    }

    pub fn kick_client(&self, id: u64) {
        if let Some(g) = self.guard.lock().unwrap().as_ref() {
            g.kick(id);
        }
    }

    pub fn kick_by_token(&self, token: &str) {
        if let Some(g) = self.guard.lock().unwrap().as_ref() {
            g.kick_by_token(token);
        }
    }

    pub fn kick_all(&self) {
        if let Some(g) = self.guard.lock().unwrap().as_ref() {
            g.kick_all();
        }
    }

    /// 取走事件接收端（仅 setup_app 消费一次）。
    pub async fn take_event_rx(&self) -> Option<mpsc::Receiver<ServerEvent>> {
        self.event_rx.lock().await.take()
    }
}

static CUSTOM_AUTH: Mutex<Option<Arc<dyn server::HelloAuth>>> = Mutex::new(None);

/// 阶段 1 无鉴权桩：仅用于独立验证；生产路径使用 PairingManager。
struct OpenStub;

impl server::HelloAuth for OpenStub {
    fn authenticate(
        &self,
        device_name: &str,
        _token: Option<&str>,
        _pairing_code: Option<&str>,
    ) -> server::AuthOutcome {
        server::AuthOutcome {
            ok: true,
            desktop_name: device_name.to_string(),
            token: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ensure_started_binds_and_reports_port() {
        let core = ControlCore::shared();
        let port = core.ensure_started().await.expect("should bind");
        assert!((9979..=9983).contains(&port));
        assert_eq!(core.port(), port);
        // 无 client 时广播不应 panic
        core.broadcast(protocol::MSG_STATE, r#"{"isPlaying":false}"#);
        assert_eq!(core.client_count(), 0);
        // 事件接收端可取（幂等性由单一 setup 流程保证，二次取为 None）
        assert!(core.take_event_rx().await.is_some());
    }
}
