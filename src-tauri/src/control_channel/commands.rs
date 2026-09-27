// 控制通道 tauri 命令：状态查询、开关、配对码、设备管理与状态推送。

use super::pairing::{self, PairingManager};
use super::protocol::{MSG_NOW_PLAYING, MSG_POSITION, MSG_STATE};
use super::ControlCore;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEntry {
    pub token: String,
    pub device_name: String,
    pub paired_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedEntry {
    pub id: u64,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlChannelStatus {
    pub running: bool,
    pub port: u16,
    pub lan_ip: String,
    pub enabled: bool,
    pub desktop_name: String,
    pub pairing_code: String,
    pub pairing_expires_in: u64,
    pub devices: Vec<DeviceEntry>,
    pub connected: Vec<ConnectedEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingCodeInfo {
    pub pairing_code: String,
    pub expires_in: u64,
}

fn pairing() -> Option<std::sync::Arc<PairingManager>> {
    ControlCore::shared().pairing()
}

#[tauri::command]
pub async fn control_channel_status() -> Result<ControlChannelStatus, String> {
    let core = ControlCore::shared();
    let (enabled, pairing_code, expires_in, devices) = match pairing() {
        Some(pm) => {
            let (code, ttl) = pm.pairing_code_info().unwrap_or_default();
            (
                pm.is_enabled(),
                code,
                ttl,
                pm.devices()
                    .into_iter()
                    .map(|t| DeviceEntry {
                        token: t.token,
                        device_name: t.device_name,
                        paired_at: t.paired_at,
                    })
                    .collect(),
            )
        }
        None => (true, String::new(), 0, Vec::new()),
    };
    Ok(ControlChannelStatus {
        running: core.port() != 0,
        port: core.port(),
        lan_ip: crate::dlna::net_util::lan_ip()
            .map(|i| i.to_string())
            .unwrap_or_default(),
        enabled,
        desktop_name: pairing::desktop_name(),
        pairing_code,
        pairing_expires_in: expires_in,
        devices,
        connected: core
            .connected_clients()
            .into_iter()
            .map(|c| ConnectedEntry { id: c.id, name: c.name })
            .collect(),
    })
}

#[tauri::command]
pub async fn control_channel_refresh_pairing_code() -> Result<PairingCodeInfo, String> {
    let pm = pairing().ok_or("控制通道未初始化")?;
    let (code, ttl) = pm.new_pairing_code();
    Ok(PairingCodeInfo {
        pairing_code: code,
        expires_in: ttl,
    })
}

#[tauri::command]
pub async fn control_channel_forget_device(token: String) -> Result<bool, String> {
    let pm = pairing().ok_or("控制通道未初始化")?;
    let removed = pm.forget(&token);
    if removed {
        ControlCore::shared().kick_by_token(&token);
    }
    Ok(removed)
}

#[tauri::command]
pub async fn control_channel_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let core = ControlCore::shared();
    let pm = pairing().ok_or("控制通道未初始化")?;
    pm.set_enabled(enabled);
    if enabled {
        let port = core.ensure_started().await?;
        core.restart_advertising(port, &pm.udn());
    } else {
        core.stop_advertising();
        core.kick_all();
    }
    let _ = app;
    Ok(())
}

// ---------------- 状态推送（TS 语义层回灌） ----------------

#[tauri::command]
pub fn control_channel_push_state(is_playing: bool, volume: f64) -> Result<(), String> {
    let payload = serde_json::json!({
        "isPlaying": is_playing,
        "volume": volume,
    });
    ControlCore::shared().broadcast(MSG_STATE, &payload.to_string());
    Ok(())
}

#[tauri::command]
pub fn control_channel_push_now_playing(
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "id": id,
        "title": title,
        "artist": artist,
        "album": album,
        "duration": duration,
        "daily": false,
    });
    ControlCore::shared().broadcast(MSG_NOW_PLAYING, &payload.to_string());
    Ok(())
}

#[tauri::command]
pub fn control_channel_push_position(pos: f64, duration: f64) -> Result<(), String> {
    let payload = serde_json::json!({
        "pos": pos,
        "duration": duration,
    });
    ControlCore::shared().broadcast(MSG_POSITION, &payload.to_string());
    Ok(())
}
