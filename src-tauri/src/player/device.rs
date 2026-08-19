use crate::player::types::{
    AudioCommand, AudioDevice, AudioDeviceFormat, AudioDeviceFormats, AudioOutputMode,
    AudioOutputStatus, PlayerState,
};
use cpal::traits::{DeviceTrait, HostTrait};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// 枚举输出设备的原生能力(样本格式/采样率范围/声道)，用于 bit-perfect 输出配置。
/// 与 get_output_devices 同理，枚举可能耗时，放到后台阻塞线程池执行。
#[tauri::command]
pub async fn get_audio_device_formats() -> Result<Vec<AudioDeviceFormats>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let host = cpal::default_host();
        let devices = host.output_devices().map_err(|e| e.to_string())?;
        let mut result = Vec::new();

        for device in devices {
            let name = match device.name() {
                Ok(name) => name,
                Err(_) => continue,
            };

            let mut seen = HashSet::new();
            let mut formats = Vec::new();
            if let Ok(configs) = device.supported_output_configs() {
                for cfg in configs {
                    let format_name = format!("{:?}", cfg.sample_format()).to_lowercase();
                    let key = (
                        cfg.channels(),
                        cfg.min_sample_rate().0,
                        cfg.max_sample_rate().0,
                        format_name.clone(),
                    );
                    if seen.insert(key) {
                        formats.push(AudioDeviceFormat {
                            sample_format: format_name,
                            min_sample_rate: cfg.min_sample_rate().0,
                            max_sample_rate: cfg.max_sample_rate().0,
                            channels: cfg.channels(),
                        });
                    }
                }
            }

            result.push(AudioDeviceFormats {
                id: name.clone(),
                name,
                formats,
            });
        }

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    // cpal 的 output_devices() 与 device.name() 在 Windows 上走 WASAPI，
    // 枚举设备（尤其存在蓝牙 / 虚拟声卡 / HDMI 设备时）可能耗时数秒，且为同步阻塞操作。
    // 原先是同步 #[tauri::command]，会直接在 Tauri 主线程（webview 线程）上执行，
    // 导致每次进入设置页调用 get_output_devices 时整个 UI 卡死数秒。
    // 改为 async 并通过 spawn_blocking 把枚举放到后台阻塞线程池，
    // 主线程 / webview 不再被阻塞，设备列表在后台加载完成后异步返回。
    // （本项目播放线程本就在非主线程上使用 cpal，cpal 会自行在调用线程初始化 COM，故后台线程可用。）
    tauri::async_runtime::spawn_blocking(|| {
        let host = cpal::default_host();
        let devices = host.output_devices().map_err(|e| e.to_string())?;
        let mut result = Vec::new();

        for device in devices {
            if let Ok(name) = device.name() {
                result.push(AudioDevice {
                    id: name.clone(),
                    name,
                });
            }
        }

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_output_device(
    device_id: Option<String>,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetDevice(device_id))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_audio_output_mode(
    output_mode: AudioOutputMode,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetOutputMode(output_mode))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_current_output_device(
    state: tauri::State<PlayerState>,
) -> Result<AudioOutputStatus, String> {
    let status = state.output_status.lock().map_err(|e| e.to_string())?;
    Ok(status.clone())
}

pub(crate) fn default_output_device_name(host: &cpal::Host) -> Option<String> {
    host.default_output_device()?.name().ok()
}

pub(crate) fn emit_output_status(
    app: &AppHandle,
    status: &Arc<Mutex<AudioOutputStatus>>,
    selected_device_id: Option<String>,
    active_device_name: Option<String>,
    requested_output_mode: AudioOutputMode,
    active_output_mode: AudioOutputMode,
    fallback_reason: Option<String>,
) {
    let next_status = AudioOutputStatus {
        selected_device_id: selected_device_id.clone(),
        active_device_name,
        follows_system_default: selected_device_id.is_none(),
        requested_output_mode,
        active_output_mode,
        fallback_reason,
    };

    if let Ok(mut current_status) = status.lock() {
        *current_status = next_status.clone();
    }

    let _ = app.emit("audio-output-device-changed", next_status);
}
