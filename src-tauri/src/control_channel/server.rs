// 控制通道 TCP server：纯 tokio 字节管道 + 帧协议，语义（播放控制/状态推送）
// 全部上交 TS 层。连接生命周期：
//   未鉴权连接 10s 内未完成 hello 握手即断开；
//   已鉴权连接 30s 无任何帧判死（移动端 10s ping 兜活）；
//   鉴权策略由注入的 HelloAuth 决定（阶段 1 测试桩 / 阶段 2 配对码+token）。

use super::protocol::{
    encode_frame, FrameDecoder, MSG_BYE, MSG_CMD, MSG_HELLO, MSG_PING, MSG_PONG,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const WRITE_CHANNEL_DEPTH: usize = 64;

/// 上报给 TS 语义层的连接事件（经 ControlCore 转 tauri emit）。
#[derive(Debug, Clone)]
pub enum ServerEvent {
    ClientConnected { id: u64, name: String },
    ClientDisconnected { id: u64, name: String },
    Command {
        id: u64,
        action: String,
        arg: serde_json::Value,
    },
}

/// hello 鉴权结果；新配对通过时携带下发的 token。
pub struct AuthOutcome {
    pub ok: bool,
    pub desktop_name: String,
    pub token: Option<String>,
}

pub trait HelloAuth: Send + Sync + 'static {
    fn authenticate(
        &self,
        device_name: &str,
        token: Option<&str>,
        pairing_code: Option<&str>,
    ) -> AuthOutcome;
}

struct ClientHandle {
    name: String,
    tx: mpsc::Sender<Vec<u8>>,
    close_tx: watch::Sender<bool>,
}

struct ServerState {
    clients: Mutex<HashMap<u64, ClientHandle>>,
    next_id: AtomicU64,
}

/// server 保活句柄：持有它监听才存活（连接 task 自行常驻），
/// 同时提供对已鉴权 client 的广播与踢除能力。
pub struct ServerGuard {
    pub port: u16,
    state: Arc<ServerState>,
}

impl ServerGuard {
    /// 向所有已鉴权 client 广播一帧。
    pub fn broadcast(&self, msg_type: u8, payload: &str) {
        let frame = encode_frame(msg_type, 0, payload);
        let clients = self.state.clients.lock().unwrap();
        for client in clients.values() {
            // 通道满视为 consumer 卡死，丢帧优于阻塞广播方
            let _ = client.tx.try_send(frame.clone());
        }
    }

    pub fn client_count(&self) -> usize {
        self.state.clients.lock().unwrap().len()
    }

    /// 踢除指定 client（忘记设备用）。
    pub fn kick(&self, id: u64) {
        let client = self.state.clients.lock().unwrap().remove(&id);
        if let Some(c) = client {
            let _ = c.close_tx.send(true);
        }
    }

    pub fn kick_all(&self) {
        let clients: Vec<ClientHandle> = self
            .state
            .clients
            .lock()
            .unwrap()
            .drain()
            .map(|(_, c)| c)
            .collect();
        for c in clients {
            let _ = c.close_tx.send(true);
        }
    }
}

/// 启动 accept 循环。listener 由调用方绑定（便于测试绑 127.0.0.1:0）。
pub async fn serve(
    listener: TcpListener,
    auth: Arc<dyn HelloAuth>,
    event_tx: mpsc::Sender<ServerEvent>,
) -> ServerGuard {
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let state = Arc::new(ServerState {
        clients: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
    });
    let loop_state = state.clone();
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, peer)) => {
                    let auth = auth.clone();
                    let events = event_tx.clone();
                    let st = loop_state.clone();
                    tokio::spawn(async move {
                        handle_connection(st, socket, peer.to_string(), auth, events).await;
                    });
                }
                Err(e) => {
                    eprintln!("[control] accept failed: {e}");
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }
    });
    ServerGuard { port, state }
}

async fn handle_connection(
    state: Arc<ServerState>,
    socket: TcpStream,
    peer: String,
    auth: Arc<dyn HelloAuth>,
    event_tx: mpsc::Sender<ServerEvent>,
) {
    let (mut rd, mut wr) = socket.into_split();
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(WRITE_CHANNEL_DEPTH);
    let (close_tx, close_rx) = watch::channel(false);

    // 写 task：close 信号或通道关闭即退出
    let writer_close_rx = close_rx.clone();
    let writer = tokio::spawn(async move {
        let mut close_rx = writer_close_rx;
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Some(bytes) => {
                            if wr.write_all(&bytes).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                _ = close_rx.changed() => break,
            }
        }
        let _ = wr.shutdown().await;
    });

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let mut decoder = FrameDecoder::new();
    let mut authenticated = false;
    let mut my_name = String::new();
    let mut seq: u16 = 0;
    let mut buf = [0u8; 8192];
    let mut read_rx = close_rx.clone();

    loop {
        if *read_rx.borrow() {
            break;
        }
        let timeout = if authenticated {
            IDLE_TIMEOUT
        } else {
            HANDSHAKE_TIMEOUT
        };
        let chunk = tokio::select! {
            r = rd.read(&mut buf) => r,
            _ = read_rx.changed() => break,
            _ = tokio::time::sleep(timeout) => {
                eprintln!("[control] {peer} idle/handshake timeout");
                break;
            }
        };
        match chunk {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for frame in decoder.feed(&buf[..n]) {
                    match frame.msg_type {
                        MSG_HELLO if !authenticated => {
                            let hello: serde_json::Value =
                                serde_json::from_str(&frame.payload).unwrap_or_default();
                            let device_name =
                                hello["name"].as_str().unwrap_or("remote").to_string();
                            let token = hello["token"].as_str().map(str::to_string);
                            let pairing_code =
                                hello["pairing_code"].as_str().map(str::to_string);
                            let outcome =
                                auth.authenticate(&device_name, token.as_deref(), pairing_code.as_deref());
                            seq = seq.wrapping_add(1);
                            if outcome.ok {
                                let mut resp = serde_json::json!({
                                    "ver": 1,
                                    "role": "desktop",
                                    "name": outcome.desktop_name,
                                    "auth": "ok",
                                });
                                if let Some(t) = &outcome.token {
                                    resp["token"] = serde_json::Value::String(t.clone());
                                }
                                let _ = tx
                                    .try_send(encode_frame(MSG_HELLO, seq, &resp.to_string()))
                                    .ok();
                                authenticated = true;
                                my_name = device_name.clone();
                                state.clients.lock().unwrap().insert(
                                    id,
                                    ClientHandle {
                                        name: device_name,
                                        tx: tx.clone(),
                                        close_tx: close_tx.clone(),
                                    },
                                );
                                let _ = event_tx
                                    .send(ServerEvent::ClientConnected {
                                        id,
                                        name: my_name.clone(),
                                    })
                                    .await;
                            } else {
                                let resp = serde_json::json!({
                                    "ver": 1,
                                    "role": "desktop",
                                    "name": outcome.desktop_name,
                                    "auth": "bad_token",
                                });
                                let _ = tx
                                    .try_send(encode_frame(MSG_HELLO, seq, &resp.to_string()))
                                    .ok();
                                tokio::time::sleep(Duration::from_millis(200)).await;
                                break;
                            }
                        }
                        MSG_PING => {
                            if authenticated {
                                seq = seq.wrapping_add(1);
                                let _ = tx.try_send(encode_frame(MSG_PONG, seq, &frame.payload));
                            }
                        }
                        MSG_CMD if authenticated => {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&frame.payload)
                            {
                                let action = v["action"].as_str().unwrap_or_default().to_string();
                                if action.is_empty() {
                                    continue;
                                }
                                let arg = v.get("arg").cloned().unwrap_or(serde_json::Value::Null);
                                let _ = event_tx
                                    .send(ServerEvent::Command { id, action, arg })
                                    .await;
                            }
                        }
                        MSG_BYE => break,
                        _ => {}
                    }
                }
            }
        }
    }

    // 清理：从已鉴权集合移除并上报断开
    let removed = state.clients.lock().unwrap().remove(&id);
    if authenticated {
        let _ = event_tx
            .send(ServerEvent::ClientDisconnected {
                id,
                name: my_name.clone(),
            })
            .await;
    }
    let _ = close_tx.send(true);
    drop(tx);
    let _ = writer.await;
    if removed.is_some() {
        eprintln!("[control] client {peer} ({my_name}) disconnected");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_channel::protocol::{FrameDecoder, MSG_HELLO};

    /// 阶段 1 桩：任意 hello 均通过。
    struct AcceptAll;

    impl HelloAuth for AcceptAll {
        fn authenticate(
            &self,
            _device_name: &str,
            _token: Option<&str>,
            _pairing_code: Option<&str>,
        ) -> AuthOutcome {
            AuthOutcome {
                ok: true,
                desktop_name: "TEST-DESKTOP".to_string(),
                token: Some("newtoken".to_string()),
            }
        }
    }

    fn hello_frame(token: Option<&str>) -> Vec<u8> {
        let mut payload = serde_json::json!({
            "ver": 1,
            "role": "remote",
            "name": "测试手机",
        });
        match token {
            Some(t) => payload["token"] = serde_json::json!(t),
            None => payload["pairing_code"] = serde_json::json!("123456"),
        }
        encode_frame(MSG_HELLO, 1, &payload.to_string())
    }

    #[tokio::test]
    async fn handshake_cmd_and_broadcast_roundtrip() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (event_tx, mut event_rx) = mpsc::channel(16);
        let guard = serve(listener, Arc::new(AcceptAll), event_tx).await;
        let port = guard.port;

        let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        client.write_all(&hello_frame(None)).await.unwrap();

        // 读到 auth ok 响应
        let mut dec = FrameDecoder::new();
        let hello_resp = loop {
            let mut buf = [0u8; 4096];
            let n = client.read(&mut buf).await.unwrap();
            assert!(n > 0, "connection closed during handshake");
            let frames = dec.feed(&buf[..n]);
            if let Some(f) = frames
                .iter()
                .find(|f| f.msg_type == MSG_HELLO)
            {
                break f.clone();
            }
        };
        let resp: serde_json::Value = serde_json::from_str(&hello_resp.payload).unwrap();
        assert_eq!(resp["auth"], "ok");
        assert_eq!(resp["name"], "TEST-DESKTOP");
        assert_eq!(resp["token"], "newtoken");

        // server 侧确认连接事件
        let evt = event_rx.recv().await.unwrap();
        assert!(matches!(evt, ServerEvent::ClientConnected { .. }));

        // 发 cmd 指令
        let cmd = encode_frame(
            MSG_CMD,
            2,
            r#"{"action":"seek","arg":{"pos":30.5}}"#,
        );
        client.write_all(&cmd).await.unwrap();
        let evt = event_rx.recv().await.unwrap();
        match evt {
            ServerEvent::Command { action, arg, .. } => {
                assert_eq!(action, "seek");
                assert_eq!(arg["pos"], 30.5);
            }
            other => panic!("expected command, got {other:?}"),
        }

        // 广播状态帧 → client 收到
        guard.broadcast(super::super::protocol::MSG_STATE, r#"{"isPlaying":true}"#);
        let state_frame = loop {
            let mut buf = [0u8; 4096];
            let n = client.read(&mut buf).await.unwrap();
            assert!(n > 0);
            let frames = dec.feed(&buf[..n]);
            if let Some(f) = frames.into_iter().find(|f| f.msg_type == super::super::protocol::MSG_STATE) {
                break f;
            }
        };
        assert_eq!(state_frame.payload, r#"{"isPlaying":true}"#);

        // bye 断开 → server 上报
        client
            .write_all(&encode_frame(MSG_BYE, 3, "{}"))
            .await
            .unwrap();
        drop(client);
        let evt = event_rx.recv().await.unwrap();
        assert!(matches!(evt, ServerEvent::ClientDisconnected { .. }));
    }

    #[tokio::test]
    async fn bad_auth_gets_rejected() {
        struct RejectAll;
        impl HelloAuth for RejectAll {
            fn authenticate(
                &self,
                _d: &str,
                _t: Option<&str>,
                _p: Option<&str>,
            ) -> AuthOutcome {
                AuthOutcome {
                    ok: false,
                    desktop_name: "TEST".to_string(),
                    token: None,
                }
            }
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (event_tx, _event_rx) = mpsc::channel(16);
        let guard = serve(listener, Arc::new(RejectAll), event_tx).await;

        let mut client = TcpStream::connect(("127.0.0.1", guard.port)).await.unwrap();
        client.write_all(&hello_frame(None)).await.unwrap();
        let mut dec = FrameDecoder::new();
        loop {
            let mut buf = [0u8; 4096];
            let n = client.read(&mut buf).await.unwrap();
            let frames = dec.feed(&buf[..n]);
            if let Some(f) = frames.iter().find(|f| f.msg_type == MSG_HELLO) {
                let resp: serde_json::Value = serde_json::from_str(&f.payload).unwrap();
                assert_eq!(resp["auth"], "bad_token");
                break;
            }
        }
        // server 随后断开连接
        let mut buf = [0u8; 64];
        assert_eq!(client.read(&mut buf).await.unwrap_or(0), 0);
    }
}
