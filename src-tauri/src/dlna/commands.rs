//! DLNA Tauri 命令层：发送端（DMC）控制 + 接收端（DMR）启停与指令分发。
//!
//! - DMC：搜索设备 / 投递 / 播控 / 音量 / 状态查询，均转发到 [crate::dlna::DlnaCore]。
//! - DMR：启用渲染器后，播放器指令经 `dlna:dmr-command` 事件推给前端编排层执行，
//!   播放状态快照由 [PlayerDmrHost] 从共享原子直接读取（无锁，供 SOAP 应答）。

use super::types::{
    CastMediaInfo, CastTransportState, DlnaDevice, DmrHost, DmrPlaybackReport, MediaPayload,
    TransportState,
};
use super::DlnaCore;
use crate::player::types::{PlayerState, SharedProgress};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[allow(unused_imports)]
use super::types as dlna_types;

/// DMR 渲染器运行状态。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlnaRendererStatus {
    pub running: bool,
    pub friendly_name: String,
    pub port: u16,
}

/// DMR 宿主：从播放器共享原子读取状态快照（HTTP SOAP 应答线程调用）。
struct PlayerDmrHost {
    progress: Arc<SharedProgress>,
    user_volume: Arc<AtomicU32>,
}

impl DmrHost for PlayerDmrHost {
    fn playback_snapshot(&self) -> DmrPlaybackReport {
        let samples = self.progress.samples_played.load(Ordering::Relaxed);
        let rate = self.progress.sample_rate.load(Ordering::Relaxed);
        let channels = self.progress.channels.load(Ordering::Relaxed);
        let position_secs = if rate > 0 && channels > 0 {
            samples as f64 / (rate as u64 * channels as u64) as f64
        } else {
            0.0
        };
        let duration_secs =
            f64::from_bits(self.progress.total_duration_secs.load(Ordering::Relaxed));
        let playing = self.progress.is_playing.load(Ordering::Relaxed);
        let has_media = rate > 0 && channels > 0;
        let state = if !has_media {
            TransportState::NoMedia
        } else if playing {
            TransportState::Playing
        } else {
            TransportState::PausedPlayback
        };
        DmrPlaybackReport {
            state,
            position_secs,
            duration_secs,
        }
    }

    fn volume_snapshot(&self) -> (u8, bool) {
        let v = f32::from_bits(self.user_volume.load(Ordering::Relaxed));
        ((v.clamp(0.0, 1.0) * 100.0).round() as u8, false)
    }
}

/// 默认渲染器名称（前端未指定时兜底）。
fn fallback_friendly_name() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_default();
    if host.trim().is_empty() {
        "弦予音乐".to_string()
    } else {
        format!("弦予音乐 · {}", host.trim())
    }
}

// ---------------- 发送端（DMC） ----------------

#[tauri::command]
pub async fn dlna_search_devices(timeout_ms: u64) -> Result<Vec<DlnaDevice>, String> {
    Ok(DlnaCore::shared().search_devices(timeout_ms).await)
}

#[tauri::command]
pub async fn dlna_cast_set_uri(
    device: DlnaDevice,
    media: MediaPayload,
    cover: Option<MediaPayload>,
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
) -> Result<CastMediaInfo, String> {
    DlnaCore::shared()
        .cast_set_uri(&device, media, cover, &title, &artist, &album, duration_ms)
        .await
}

#[tauri::command]
pub async fn dlna_cast_play(device: DlnaDevice) -> Result<(), String> {
    DlnaCore::shared().cast_play(&device).await
}

#[tauri::command]
pub async fn dlna_cast_pause(device: DlnaDevice) -> Result<(), String> {
    DlnaCore::shared().cast_pause(&device).await
}

#[tauri::command]
pub async fn dlna_cast_stop(device: DlnaDevice) -> Result<(), String> {
    DlnaCore::shared().cast_stop(&device).await
}

#[tauri::command]
pub async fn dlna_cast_seek(device: DlnaDevice, secs: f64) -> Result<(), String> {
    DlnaCore::shared().cast_seek(&device, secs).await
}

#[tauri::command]
pub async fn dlna_cast_set_volume(device: DlnaDevice, percent: u8) -> Result<(), String> {
    DlnaCore::shared().cast_set_volume(&device, percent).await
}

#[tauri::command]
pub async fn dlna_cast_get_state(device: DlnaDevice) -> Result<CastTransportState, String> {
    DlnaCore::shared().cast_get_state(&device).await
}

/// TTL 续投：热替换 token 上游（电视不断流）。
#[tauri::command]
pub fn dlna_update_media_token(token: String, payload: MediaPayload) -> bool {
    DlnaCore::shared().update_media_token(&token, payload)
}

// ---------------- 接收端（DMR） ----------------

/// 启用渲染器：SSDP 广播 + SOAP 端点。启用后 DMR 指令经 `dlna:dmr-command` 事件
/// 推给前端；状态快照直接读播放器共享原子。
#[tauri::command]
pub async fn dlna_enable_renderer(
    friendly_name: String,
    udn: String,
    state: State<'_, PlayerState>,
    app: AppHandle,
) -> Result<u16, String> {
    let name = if friendly_name.trim().is_empty() {
        fallback_friendly_name()
    } else {
        friendly_name.trim().to_string()
    };
    let core = DlnaCore::shared();
    let host = Arc::new(PlayerDmrHost {
        progress: state.progress.clone(),
        user_volume: state.user_volume.clone(),
    });
    let port = core
        .enable_renderer(
            super::types::RendererConfig {
                friendly_name: name,
                udn,
            },
            host,
        )
        .await?;

    // 取走指令接收端并启动 emit 循环（仅一次；重复启用时 None 则跳过）。
    if let Some(mut rx) = core.take_dmr_command_rx().await {
        std::thread::spawn(move || {
            while let Some(cmd) = rx.blocking_recv() {
                let payload = serde_json::to_value(&cmd).unwrap_or_default();
                if app.emit("dlna:dmr-command", payload).is_err() {
                    break;
                }
            }
        });
    }
    Ok(port)
}

#[tauri::command]
pub async fn dlna_disable_renderer() -> Result<(), String> {
    DlnaCore::shared().disable_renderer().await;
    Ok(())
}

#[tauri::command]
pub fn dlna_renderer_status() -> DlnaRendererStatus {
    let core = DlnaCore::shared();
    let running = core.renderer_running();
    let (friendly_name, port) = core.renderer_info().unwrap_or_default();
    DlnaRendererStatus {
        running,
        friendly_name,
        port,
    }
}
