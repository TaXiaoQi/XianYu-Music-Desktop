//! USB DAC 设备识别、热插拔监听与独占模式管理
//!
//! 架构：
//! - `UsbDeviceMonitor`: 后台线程每 2 秒轮询 WASAPI 设备列表，发送 `usb-device-changed` 事件
//! - `UsbExclusiveState`: 独占模式状态机，跟踪获取/激活/释放过程
//! - `enable_usb_exclusive_mode`: 启用独占模式（SetDevice → SetOutputMode）
//! - `disable_usb_exclusive_mode`: 禁用独占模式（回退 Shared）
//! - `query_exclusive_status`: 查询当前独占状态
//!
//! 独占原理：
//! 通过 WASAPI `StreamMode::PollingExclusive` 初始化音频客户端，Win32 API 底层
//! 使用 `AUDCLNT_SHAREMODE_EXCLUSIVE`，确保设备被本应用独占，其他应用无法访问。

use crate::player::types::{AudioDevice, PlayerState};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// ===== USB 设备变更事件载荷 =====

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsbDeviceChangedPayload {
    pub usb_devices: Vec<AudioDevice>,
    pub added: Vec<AudioDevice>,
    pub removed: Vec<AudioDevice>,
    /// 是否有 USB DAC 当前可用
    pub any_usb_available: bool,
}

// ===== 独占状态快照（发往前端） =====

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExclusiveStateSnapshot {
    /// 独占模式是否已启用（用户开关）
    pub enabled: bool,
    /// 独占模式是否已成功激活（设备真正被独占）
    pub active: bool,
    /// 当前独占的设备 ID
    pub device_id: Option<String>,
    /// 当前独占的设备名称
    pub device_name: Option<String>,
    /// 设备激活时间戳（Unix 毫秒）
    pub activated_at_ms: Option<u64>,
    /// 上次错误信息
    pub last_error: Option<String>,
    /// 失败重试次数
    pub retry_count: u32,
}

// ===== USB 设备监视器 =====

pub struct UsbDeviceMonitor {
    stop_flag: Arc<AtomicBool>,
    join_handle: Option<thread::JoinHandle<()>>,
}

impl UsbDeviceMonitor {
    /// 启动 USB 设备监视器
    pub fn start(app: AppHandle) -> Self {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_clone = stop_flag.clone();

        let join_handle = thread::spawn(move || {
            eprintln!("[USB Monitor] Started — polling every 2s");
            let mut prev_devices: Vec<AudioDevice> = list_usb_devices().unwrap_or_default();

            // 启动时发送初始列表
            let _ = app.emit(
                "usb-device-changed",
                UsbDeviceChangedPayload {
                    usb_devices: prev_devices.clone(),
                    added: prev_devices.clone(),
                    removed: Vec::new(),
                    any_usb_available: !prev_devices.is_empty(),
                },
            );
            eprintln!(
                "[USB Monitor] Initial scan: {} USB DAC(s) found",
                prev_devices.len()
            );

            while !stop_flag_clone.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(2));

                if stop_flag_clone.load(Ordering::Relaxed) {
                    break;
                }

                let current_devices = match list_usb_devices() {
                    Ok(devices) => devices,
                    Err(error) => {
                        eprintln!("[USB Monitor] Device scan failed: {error}");
                        continue;
                    }
                };

                // 检测变化
                let added: Vec<AudioDevice> = current_devices
                    .iter()
                    .filter(|d| !prev_devices.iter().any(|p| p.id == d.id))
                    .cloned()
                    .collect();

                let removed: Vec<AudioDevice> = prev_devices
                    .iter()
                    .filter(|p| !current_devices.iter().any(|d| d.id == p.id))
                    .cloned()
                    .collect();

                if !added.is_empty() || !removed.is_empty() {
                    eprintln!(
                        "[USB Monitor] Device change detected: +{} -{}",
                        added.len(),
                        removed.len()
                    );
                    let _ = app.emit(
                        "usb-device-changed",
                        UsbDeviceChangedPayload {
                            any_usb_available: !current_devices.is_empty(),
                            usb_devices: current_devices.clone(),
                            added,
                            removed,
                        },
                    );
                    prev_devices = current_devices;
                }
            }
            eprintln!("[USB Monitor] Stopped");
        });

        Self {
            stop_flag,
            join_handle: Some(join_handle),
        }
    }

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for UsbDeviceMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}

// ===== USB 设备枚举 =====

/// 枚举所有 USB DAC 输出设备
///
/// 通过 wasapi DeviceEnumerator 枚举 Render 设备，通过友好名称关键字识别 USB DAC。
pub fn list_usb_devices() -> Result<Vec<AudioDevice>, String> {
    #[cfg(target_os = "windows")]
    {
        use wasapi::{DeviceEnumerator, Direction};

        let enumerator = DeviceEnumerator::new().map_err(|e| {
            eprintln!("[USB Monitor] Failed to create DeviceEnumerator: {e}");
            e.to_string()
        })?;
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|e| {
                eprintln!("[USB Monitor] Failed to get device collection: {e}");
                e.to_string()
            })?;

        let mut result = Vec::new();
        let mut all_names = Vec::new();
        let count = collection.get_nbr_devices().map_err(|e| e.to_string())?;

        for i in 0..count {
            if let Ok(device) = collection.get_device_at_index(i) {
                if let Ok(name) = device.get_friendlyname() {
                    all_names.push(name.clone());
                    // 通过名称关键字识别 USB DAC
                    let name_upper = name.to_uppercase();
                    let is_usb = name_upper.contains("USB")
                        || name_upper.contains("DAC")
                        || name_upper.contains("FIIO")
                        || name_upper.contains("TOPPING")
                        || name_upper.contains("SABAJ")
                        || name_upper.contains("AUDIOQUEST")
                        || name_upper.contains("CHORD")
                        || name_upper.contains("IFI");

                    if is_usb {
                        result.push(AudioDevice {
                            id: name.clone(),
                            name,
                        });
                    }
                }
            }
        }

        if result.is_empty() {
            eprintln!("[USB Monitor] No USB DAC devices found among {count} render devices. All devices: {all_names:?}");
        }

        Ok(result)
    }

    #[cfg(not(target_os = "windows"))]
    {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        let devices = host.output_devices().map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for device in devices {
            if let Ok(name) = device.name() {
                let name_upper = name.to_uppercase();
                if name_upper.contains("USB") || name_upper.contains("DAC") {
                    result.push(AudioDevice { id: name.clone(), name });
                }
            }
        }
        Ok(result)
    }
}

// ==================== Tauri 命令 ====================

/// 获取所有 USB DAC 设备
#[tauri::command]
pub async fn get_usb_dac_devices() -> Result<Vec<AudioDevice>, String> {
    // [修复防御]: list_usb_devices() 内部枚举 WASAPI 设备，可能阻塞数秒，
    // 必须用 spawn_blocking 避免阻塞 Tauri 主线程。
    tauri::async_runtime::spawn_blocking(|| list_usb_devices())
        .await
        .map_err(|e| e.to_string())?
}

/// 启用 USB 独占模式
///
/// 发送 SetDevice（如果指定设备） + SetOutputMode(WasapiExclusive) 到播放线程。
/// 如果当前有播放，播放线程的 `restore_preferred_output` 会在新输出模式下重新启动流。
/// 如果当前无播放，设定后前端应 re-trigger playSong 以启动独占播放。
#[tauri::command]
pub fn enable_usb_exclusive_mode(
    device_id: Option<String>,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    use crate::player::types::AudioCommand;

    eprintln!(
        "[USB Exclusive] enable_usb_exclusive_mode called | device_id={:?}",
        device_id
    );

    let tx = state.tx.lock().map_err(|e| {
        eprintln!("[USB Exclusive] Failed to lock command channel: {e}");
        e.to_string()
    })?;

    // 1. 设置输出设备（如果有）
    if let Some(ref id) = device_id {
        eprintln!("[USB Exclusive] Sending SetDevice('{id}')");
        tx.send(AudioCommand::SetDevice(Some(id.clone())))
            .map_err(|e| {
                eprintln!("[USB Exclusive] Failed to send SetDevice command: {e}");
                e.to_string()
            })?;
    }

    // 2. 设置输出模式为 WASAPI 独占
    eprintln!("[USB Exclusive] Sending SetOutputMode(WasapiExclusive)");
    tx.send(AudioCommand::SetOutputMode(
        crate::player::types::AudioOutputMode::WasapiExclusive,
    ))
    .map_err(|e| {
        eprintln!("[USB Exclusive] Failed to send SetOutputMode command: {e}");
        e.to_string()
    })?;

    eprintln!("[USB Exclusive] Commands sent — player thread will switch to exclusive mode");
    Ok(())
}

/// 禁用 USB 独占模式（回退到共享模式）
#[tauri::command]
pub fn disable_usb_exclusive_mode(state: tauri::State<PlayerState>) -> Result<(), String> {
    use crate::player::types::{AudioCommand, AudioOutputMode};

    eprintln!("[USB Exclusive] disable_usb_exclusive_mode called");

    let tx = state.tx.lock().map_err(|e| {
        eprintln!("[USB Exclusive] Failed to lock command channel: {e}");
        e.to_string()
    })?;

    tx.send(AudioCommand::SetOutputMode(AudioOutputMode::Shared))
        .map_err(|e| {
            eprintln!("[USB Exclusive] Failed to send SetOutputMode(Shared): {e}");
            e.to_string()
        })?;

    eprintln!("[USB Exclusive] Shared mode restored");
    Ok(())
}

/// 查询 USB 独占模式当前状态
///
/// 返回 `ExclusiveStateSnapshot` 包含 enabled/active/device_name/last_error 等。
#[tauri::command]
pub fn query_exclusive_status(state: tauri::State<PlayerState>) -> ExclusiveStateSnapshot {
    let active = state
        .usb_exclusive_active
        .load(std::sync::atomic::Ordering::Relaxed);
    ExclusiveStateSnapshot {
        enabled: active,
        active,
        device_id: state
            .exclusive_device_name
            .read()
            .unwrap()
            .clone(),
        device_name: state
            .exclusive_device_name
            .read()
            .unwrap()
            .clone(),
        activated_at_ms: None,
        last_error: None,
        retry_count: 0,
    }
}

/// 在 Tauri 应用启动时调用，启动 USB 设备监视器
pub fn start_usb_device_monitor(app: &AppHandle) -> Arc<UsbDeviceMonitor> {
    Arc::new(UsbDeviceMonitor::start(app.clone()))
}

#[cfg(not(target_os = "windows"))]
pub mod stub {
    pub fn init() {}
}
