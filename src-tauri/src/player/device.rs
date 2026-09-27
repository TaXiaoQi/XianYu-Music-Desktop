// 输出设备命令层（本文件为全新组织）：设备/格式枚举、设备与输出模式切换、
// 当前输出状态查询；另提供播放线程复用的默认设备读取与状态广播工具。
// 事件名与命令签名对前端/播放线程冻结。

use crate::player::types::{
    AudioCommand, AudioDevice, AudioDeviceFormat, AudioDeviceFormats, AudioOutputMode,
    AudioOutputStatus, PlayerState,
};
use cpal::traits::{DeviceTrait, HostTrait};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, AppHandle};

/// 输出状态变化事件名（前端契约冻结）。
const OUTPUT_STATUS_EVENT: &str = "audio-output-device-changed";

/// 命令投递的统一封装（锁失败/发送失败统一转文本错误）。
fn post_command(state: &tauri::State<PlayerState>, command: AudioCommand) -> Result<(), String> {
    let sender = state.tx.lock().map_err(|e| e.to_string())?;
    sender.send(command).map_err(|e| e.to_string())
}

/// 抽取某设备的输出配置区间，按“声道+采样率区间+格式名”去重。
fn extract_supported_formats(device: &cpal::Device) -> Vec<AudioDeviceFormat> {
    let mut seen: HashSet<(u16, u32, u32, String)> = HashSet::new();
    let mut formats = Vec::new();
    let Ok(configs) = device.supported_output_configs() else {
        return formats;
    };

    for cfg in configs {
        let fmt_label = format!("{:?}", cfg.sample_format()).to_lowercase();
        let fingerprint = (
            cfg.channels(),
            cfg.min_sample_rate().0,
            cfg.max_sample_rate().0,
            fmt_label.clone(),
        );
        if seen.insert(fingerprint) {
            formats.push(AudioDeviceFormat {
                sample_format: fmt_label,
                min_sample_rate: cfg.min_sample_rate().0,
                max_sample_rate: cfg.max_sample_rate().0,
                channels: cfg.channels(),
            });
        }
    }

    formats
}

/// 汇总主机全部输出设备与支持格式；取不到名字的设备跳过。
fn gather_device_catalog(host: &cpal::Host) -> Result<Vec<AudioDeviceFormats>, String> {
    let devices = host.output_devices().map_err(|e| e.to_string())?;
    let mut catalog = Vec::new();

    for device in devices {
        let Ok(label) = device.name() else {
            continue;
        };
        let formats = extract_supported_formats(&device);
        catalog.push(AudioDeviceFormats { id: label.clone(), name: label, formats });
    }

    Ok(catalog)
}

/// 仅枚举输出设备名称列表。
fn gather_device_names(host: &cpal::Host) -> Result<Vec<AudioDevice>, String> {
    let devices = host.output_devices().map_err(|e| e.to_string())?;
    let mut names = Vec::new();

    for device in devices {
        if let Ok(label) = device.name() {
            names.push(AudioDevice { id: label.clone(), name: label });
        }
    }

    Ok(names)
}

#[tauri::command]
pub async fn get_audio_device_formats() -> Result<Vec<AudioDeviceFormats>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let host = cpal::default_host();
        gather_device_catalog(&host)
    })
    .await
    .map_err(|why| why.to_string())?
}

#[tauri::command]
pub async fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let host = cpal::default_host();
        gather_device_names(&host)
    })
    .await
    .map_err(|why| why.to_string())?
}

#[tauri::command]
pub fn set_output_device(
    device_id: Option<String>,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    post_command(&state, AudioCommand::SetDevice(device_id))
}

#[tauri::command]
pub fn set_audio_output_mode(
    output_mode: AudioOutputMode,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    post_command(&state, AudioCommand::SetOutputMode(output_mode))
}

#[tauri::command]
pub fn get_current_output_device(
    state: tauri::State<PlayerState>,
) -> Result<AudioOutputStatus, String> {
    let guard = state.output_status.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// 读取系统默认输出设备名；无设备或取名失败时为 None。
pub(crate) fn default_output_device_name(host: &cpal::Host) -> Option<String> {
    let fallback = host.default_output_device()?;
    fallback.name().ok()
}

/// 组装最新输出状态：写回共享槽位，并广播给前端。
pub(crate) fn emit_output_status(
    app: &AppHandle,
    status: &Arc<Mutex<AudioOutputStatus>>,
    selected_device_id: Option<String>,
    active_device_name: Option<String>,
    requested_output_mode: AudioOutputMode,
    active_output_mode: AudioOutputMode,
    fallback_reason: Option<String>,
) {
    let following_default = selected_device_id.is_none();
    let fresh = AudioOutputStatus {
        follows_system_default: following_default,
        selected_device_id,
        active_device_name,
        requested_output_mode,
        active_output_mode,
        fallback_reason,
    };

    if let Ok(mut slot) = status.lock() {
        *slot = fresh.clone();
    }

    let _ = app.emit(OUTPUT_STATUS_EVENT, fresh);
}
