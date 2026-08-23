//! 插件宿主 Tauri command 面（报告 §6.3 manager 职责 + P1/P2 扩展）。
//!
//! 命令一览：
//! - `plugin_host_scan_plugins`：扫描标准 VST3/CLAP 目录（dlopen 级重操作，
//!   async 不阻塞主线程）；
//! - `plugin_host_get_rack` / `plugin_host_set_rack`：机架配置读写（camelCase
//!   序列化直接对齐前端设置体系，持久化由前端负责，与音效一致）；
//!   set_rack 同步共享机架：槽位集合变化重建链（保编辑器），参数差异实时下发；
//! - `plugin_host_get_plugin_parameters`：参数元数据（优先读活动实例，
//!   否则临时加载 + 内存缓存）；
//! - `plugin_host_get_parameter_values`：参数当前值 + 插件原生格式化文本
//!   （编辑器打开时前端轮询用，实时反映插件内部状态）；
//! - `plugin_host_set_parameter`：实时改参（写配置持久 + 活动实例参数队列，
//!   下一个 process 块生效，无需重建链路）；
//! - `plugin_host_get_plugin_presets` / `plugin_host_load_preset`：工厂预设
//!   浏览与加载（VST3 IUnitInfo 程序列表；CLAP 无工厂预设协议，恒空）；
//! - `plugin_host_open_editor` / `plugin_host_close_editor` /
//!   `plugin_host_editor_states`：原生编辑器窗口（Win32 专用线程 + 消息循环，
//!   owner 主窗口 Z 序）；编辑器被用户关闭时发 `plugin-host-editor-closed`
//!   事件（前端刷新按钮状态）；
//! - `plugin_host_take_process_error`：取走音频线程上报的一次性错误
//!   （加载失败降级 / process 熔断），供前端 toast 透出。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{Emitter, Manager};
use truce_rack::core::info::ParameterFlags;
use truce_rack::core::plugin::Plugin;

use super::scanner::{load_instance, scan_directories_with_extra, PluginScanEntry};
use super::{rack_handle, RackConfig};

/// 编辑器关闭通知事件名（payload: { format, uniqueId }）。
pub const EDITOR_CLOSED_EVENT: &str = "plugin-host-editor-closed";

/// 参数元数据 DTO（前端参数面板渲染用）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginParameterEntry {
    pub index: usize,
    pub id: u32,
    pub name: String,
    pub unit: String,
    /// 原生单位区间（注意：set_parameter 的写入值是归一化 [0,1]，报告 §3）。
    pub min: f64,
    pub max: f64,
    /// 原生单位默认值。
    pub default: f64,
    /// 步进参数的离散档位数（0 = 连续）。
    pub step_count: u32,
    pub is_bypass: bool,
    pub automatable: bool,
    pub hidden: bool,
    pub read_only: bool,
}

/// 参数当前值 DTO（实时轮询用）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginParameterValueEntry {
    pub index: usize,
    pub id: u32,
    /// 归一化值 [0,1]。
    pub value: f64,
    /// 插件原生格式化文本（如 "-6.0 dB"）。
    pub text: String,
}

/// 工厂预设 DTO。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPresetEntry {
    pub index: usize,
    pub name: String,
    /// 格式内稳定预设号（load_preset 入参）。
    pub preset_number: i32,
}

/// 编辑器状态 DTO。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorStateEntry {
    pub format: String,
    pub unique_id: String,
}

/// 参数元数据内存缓存：format::unique_id → 条目列表。
static PARAMETER_CACHE: OnceLock<Mutex<HashMap<String, Vec<PluginParameterEntry>>>> =
    OnceLock::new();

fn parameter_cache() -> &'static Mutex<HashMap<String, Vec<PluginParameterEntry>>> {
    PARAMETER_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 预设列表内存缓存：format::unique_id → 条目列表（工厂预设静态，可缓存）。
static PRESET_CACHE: OnceLock<Mutex<HashMap<String, Vec<PluginPresetEntry>>>> = OnceLock::new();

fn preset_cache() -> &'static Mutex<HashMap<String, Vec<PluginPresetEntry>>> {
    PRESET_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 扫描全部标准插件目录（用户级 + 系统级 VST3/CLAP），合并前端传入的自定义目录。
///
/// `dirs` 为自定义插件目录（绝对路径列表），与标准目录一起去重合并；
/// 目录类别（VST3/CLAP）由 scanner 按目录名/内容判定。
#[tauri::command]
pub async fn plugin_host_scan_plugins(
    app: tauri::AppHandle,
    dirs: Vec<String>,
    disabled_paths: Option<Vec<String>>,
) -> Vec<PluginScanEntry> {
    let extra: Vec<std::path::PathBuf> = dirs
        .into_iter()
        .filter(|d| !d.trim().is_empty())
        .map(std::path::PathBuf::from)
        .collect();
    let disabled = disabled_paths.unwrap_or_default();
    scan_directories_with_extra(&extra, &disabled, Some(&app))
}

/// 读取当前机架配置。
#[tauri::command]
pub fn plugin_host_get_rack() -> RackConfig {
    rack_handle().snapshot_config()
}

/// 写入机架配置并同步共享机架（槽位集合变化重建链、参数差异实时下发）。
#[tauri::command]
pub fn plugin_host_set_rack(config: RackConfig) {
    rack_handle().set_config(config);
}

/// 取走音频线程上报的一次性处理错误（读后即清）。
#[tauri::command]
pub fn plugin_host_take_process_error() -> Option<String> {
    rack_handle().take_process_error()
}

/// 读取插件参数元数据（优先活动实例；否则临时加载 + 缓存）。
#[tauri::command]
pub async fn plugin_host_get_plugin_parameters(
    format: String,
    unique_id: String,
    path: String,
) -> Result<Vec<PluginParameterEntry>, String> {
    let cache_key = format!("{format}::{unique_id}");

    // 活动实例优先（与临时实例元数据一致，但避免重复 dlopen）
    if let Some(entries) = rack_handle().with_slot(&format, &unique_id, |slot| {
        collect_parameter_entries(&mut *slot.instance)
    }) {
        if let Ok(mut cache) = parameter_cache().lock() {
            cache.insert(cache_key.clone(), entries.clone());
        }
        return Ok(entries);
    }

    if let Ok(cache) = parameter_cache().lock() {
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let mut instance = load_instance(&format, &unique_id, &path)?;
    let entries = collect_parameter_entries(&mut *instance);
    drop(instance);

    if let Ok(mut cache) = parameter_cache().lock() {
        cache.insert(cache_key, entries.clone());
    }
    Ok(entries)
}

/// 读取参数当前值（活动实例实时值；未加载时临时实例 + 配置覆盖值）。
#[tauri::command]
pub async fn plugin_host_get_parameter_values(
    format: String,
    unique_id: String,
    path: String,
) -> Result<Vec<PluginParameterValueEntry>, String> {
    let rack = rack_handle();
    if let Some(values) = rack.with_slot(&format, &unique_id, |slot| {
        collect_parameter_values(&mut *slot.instance)
    }) {
        return Ok(values);
    }

    // 未加载：临时实例 + 应用配置覆盖（呈现「下次起播会听到什么」）
    let mut instance = load_instance(&format, &unique_id, &path)?;
    if let Some(config) = find_slot_params(&rack.snapshot_config(), &format, &unique_id) {
        for (&index, &value) in &config {
            let _ = instance.set_parameter(index, value);
        }
    }
    let values = collect_parameter_values(&mut *instance);
    drop(instance);
    Ok(values)
}

/// 实时设置单个参数：写配置（持久）+ 活动实例参数队列（下一块生效）。
#[tauri::command]
pub async fn plugin_host_set_parameter(
    format: String,
    unique_id: String,
    index: usize,
    value: f64,
) -> Result<(), String> {
    let rack = rack_handle();
    let config = rack.snapshot_config();
    let enabled = config.slots.iter().any(|s| {
        s.enabled && s.format == format && s.unique_id == unique_id
    });
    if !enabled {
        return Err("该插件未在机架中启用".into());
    }
    rack.update_slot_param(&format, &unique_id, index, value.clamp(0.0, 1.0));
    Ok(())
}

/// 读取工厂预设列表（活动实例优先；否则临时加载 + 缓存）。
#[tauri::command]
pub async fn plugin_host_get_plugin_presets(
    format: String,
    unique_id: String,
    path: String,
) -> Result<Vec<PluginPresetEntry>, String> {
    let cache_key = format!("{format}::{unique_id}");

    if let Some(presets) = rack_handle().with_slot(&format, &unique_id, |slot| {
        collect_preset_entries(&mut *slot.instance)
    }) {
        if let Ok(mut cache) = preset_cache().lock() {
            cache.insert(cache_key.clone(), presets.clone());
        }
        return Ok(presets);
    }

    if let Ok(cache) = preset_cache().lock() {
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let mut instance = load_instance(&format, &unique_id, &path)?;
    let presets = collect_preset_entries(&mut *instance);
    drop(instance);

    if let Ok(mut cache) = preset_cache().lock() {
        cache.insert(cache_key, presets.clone());
    }
    Ok(presets)
}

/// 加载工厂预设。
///
/// 活动实例：经 load_preset 实时下发（VST3 程序切换参数走参数队列）；
/// 未加载：临时实例加载后把全部参数值收获进配置（下次起播生效）。
#[tauri::command]
pub async fn plugin_host_load_preset(
    format: String,
    unique_id: String,
    path: String,
    preset_number: i32,
) -> Result<(), String> {
    let rack = rack_handle();
    if rack.with_slot(&format, &unique_id, |slot| {
        slot.instance.load_preset(preset_number)
    })
    .is_some_and(|r| r.is_ok())
    {
        return Ok(());
    }

    // 活动实例不存在或加载失败 → 临时实例路径
    let config = rack.snapshot_config();
    let enabled = config.slots.iter().any(|s| {
        s.enabled && s.format == format && s.unique_id == unique_id
    });
    if !enabled {
        return Err("该插件未在机架中启用".into());
    }

    let mut instance = load_instance(&format, &unique_id, &path)?;
    instance
        .load_preset(preset_number)
        .map_err(|e| format!("预设加载失败: {e}"))?;
    // 收获预设的全部参数值进配置
    let count = instance.parameter_count();
    for index in 0..count {
        if let Ok(value) = instance.parameter_value(index) {
            rack.update_slot_param(&format, &unique_id, index, value);
        }
    }
    drop(instance);
    Ok(())
}

/// 打开插件原生编辑器窗口（Win32 专用线程；owner 主窗口 Z 序）。
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn plugin_host_open_editor(
    app: tauri::AppHandle,
    format: String,
    unique_id: String,
    title: String,
) -> Result<(), String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    if !cfg!(target_os = "windows") {
        return Err("仅支持 Windows 平台".into());
    }

    let rack = rack_handle();
    if !rack.slot_loaded(&format, &unique_id) {
        // 从未起播：确认槽位在配置中启用后以默认参数构建链
        let config = rack.snapshot_config();
        let enabled = config.slots.iter().any(|s| {
            s.enabled && s.format == format && s.unique_id == unique_id
        });
        if !enabled {
            return Err("该插件未在机架中启用".into());
        }
        rack.ensure_ready_default();
        if !rack.slot_loaded(&format, &unique_id) {
            return Err("插件实例加载失败，无法打开编辑器".into());
        }
    }

    let owner = app
        .get_webview_window("main")
        .and_then(|window| {
            let handle = window.window_handle().ok()?;
            match handle.as_raw() {
                RawWindowHandle::Win32(win32) => {
                    Some(win32.hwnd.get() as windows_sys::Win32::Foundation::HWND)
                }
                _ => None,
            }
        })
        .unwrap_or(std::ptr::null_mut());
    if owner.is_null() {
        return Err("无法获取主窗口句柄".into());
    }

    let app_for_event = app.clone();
    let format_for_event = format.clone();
    let unique_id_for_event = unique_id.clone();
    super::editor_window::open_editor(
        owner,
        rack,
        &format,
        &unique_id,
        &title,
        move || {
            let _ = app_for_event.emit(
                EDITOR_CLOSED_EVENT,
                serde_json::json!({ "format": format_for_event, "uniqueId": unique_id_for_event }),
            );
        },
    )
}

/// 打开插件原生编辑器窗口（非 Windows 平台占位）。
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn plugin_host_open_editor(
    _app: tauri::AppHandle,
    _format: String,
    _unique_id: String,
    _title: String,
) -> Result<(), String> {
    Err("仅支持 Windows 平台".into())
}

/// 关闭插件编辑器窗口（不阻塞等待）。
#[tauri::command]
pub fn plugin_host_close_editor(format: String, unique_id: String) {
    #[cfg(target_os = "windows")]
    super::editor_window::close_editor(&format, &unique_id);
    #[cfg(not(target_os = "windows"))]
    let _ = (format, unique_id);
}

/// 当前打开的编辑器列表（前端恢复状态用）。
#[tauri::command]
pub fn plugin_host_editor_states() -> Vec<EditorStateEntry> {
    #[cfg(target_os = "windows")]
    {
        super::editor_window::open_editor_keys()
            .into_iter()
            .map(|(format, unique_id)| EditorStateEntry { format, unique_id })
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

fn collect_parameter_entries(
    instance: &mut dyn Plugin<f32>,
) -> Vec<PluginParameterEntry> {
    let count = instance.parameter_count();
    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        if let Ok(info) = instance.parameter_info(index) {
            entries.push(PluginParameterEntry {
                index,
                id: info.id,
                name: if info.name.is_empty() {
                    format!("参数 {index}")
                } else {
                    info.name
                },
                unit: info.unit,
                min: info.min,
                max: info.max,
                default: info.default,
                step_count: info.step_count,
                is_bypass: info.flags.contains(ParameterFlags::BYPASS),
                automatable: info.flags.contains(ParameterFlags::AUTOMATABLE),
                hidden: info.flags.contains(ParameterFlags::HIDDEN),
                read_only: info.flags.contains(ParameterFlags::READ_ONLY),
            });
        }
    }
    entries
}

fn collect_parameter_values(
    instance: &mut dyn Plugin<f32>,
) -> Vec<PluginParameterValueEntry> {
    let count = instance.parameter_count();
    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        let id = instance.parameter_info(index).map(|i| i.id).unwrap_or(0);
        if let Ok(value) = instance.parameter_value(index) {
            let text = instance
                .parameter_value_string(index, value)
                .unwrap_or_default();
            entries.push(PluginParameterValueEntry { index, id, value, text });
        }
    }
    entries
}

fn collect_preset_entries(instance: &mut dyn Plugin<f32>) -> Vec<PluginPresetEntry> {
    let count = instance.preset_count();
    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        if let Ok(info) = instance.preset_info(index) {
            entries.push(PluginPresetEntry {
                index,
                name: if info.name.is_empty() {
                    format!("预设 {index}")
                } else {
                    info.name
                },
                preset_number: info.preset_number,
            });
        }
    }
    entries
}

fn find_slot_params(
    config: &RackConfig,
    format: &str,
    unique_id: &str,
) -> Option<HashMap<usize, f64>> {
    config
        .slots
        .iter()
        .find(|s| s.enabled && s.format == format && s.unique_id == unique_id)
        .map(|s| s.params.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::plugin_host::RackSlotConfig;

    #[test]
    fn rack_roundtrip_via_global_handle() {
        let handle = rack_handle();
        let original = handle.snapshot_config();

        let mut config = RackConfig::default();
        config.master_enabled = true;
        config.slots.push(RackSlotConfig {
            format: "clap".into(),
            unique_id: "org.test.gain".into(),
            path: "C:/x.clap".into(),
            name: "Gain".into(),
            vendor: "Test".into(),
            enabled: true,
            ..Default::default()
        });
        handle.set_config(config);

        let read_back = handle.snapshot_config();
        assert!(read_back.master_enabled);
        assert_eq!(read_back.slots.len(), 1);
        assert_eq!(read_back.slots[0].unique_id, "org.test.gain");

        handle.set_config(original);
    }

    #[test]
    fn parameter_cache_hit_skips_load() {
        let entry = PluginParameterEntry {
            index: 0,
            id: 42,
            name: "Gain".into(),
            unit: "dB".into(),
            min: -24.0,
            max: 24.0,
            default: 0.0,
            step_count: 0,
            is_bypass: false,
            automatable: true,
            hidden: false,
            read_only: false,
        };
        parameter_cache()
            .lock()
            .unwrap()
            .insert("vst3::cache-test".into(), vec![entry.clone()]);
        let cached = parameter_cache()
            .lock()
            .unwrap()
            .get("vst3::cache-test")
            .cloned()
            .unwrap();
        assert_eq!(cached[0].id, 42);
        assert_eq!(cached[0].name, "Gain");
    }

    #[test]
    fn preset_cache_roundtrip() {
        let entry = PluginPresetEntry {
            index: 0,
            name: "Init".into(),
            preset_number: 0,
        };
        preset_cache()
            .lock()
            .unwrap()
            .insert("clap::preset-test".into(), vec![entry]);
        let cached = preset_cache()
            .lock()
            .unwrap()
            .get("clap::preset-test")
            .cloned()
            .unwrap();
        assert_eq!(cached[0].name, "Init");
    }

    #[tokio::test]
    async fn parameters_for_missing_plugin_fails_gracefully() {
        let result =
            plugin_host_get_plugin_parameters("vst3".into(), "nope".into(), "C:/no.vst3".into())
                .await;
        assert!(result.is_err());
        let message = result.unwrap_err();
        assert!(message.contains("VST3"), "unexpected: {message}");
    }

    #[tokio::test]
    async fn values_for_missing_plugin_fails_gracefully() {
        let result =
            plugin_host_get_parameter_values("vst3".into(), "nope".into(), "C:/no.vst3".into())
                .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn presets_for_missing_plugin_fails_gracefully() {
        let result =
            plugin_host_get_plugin_presets("vst3".into(), "nope".into(), "C:/no.vst3".into())
                .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn set_parameter_for_disabled_slot_rejected() {
        let result = plugin_host_set_parameter("vst3".into(), "nope".into(), 0, 0.5).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("未在机架中启用"));
    }

    #[tokio::test]
    async fn load_preset_for_disabled_slot_rejected() {
        let result =
            plugin_host_load_preset("vst3".into(), "nope".into(), "C:/no.vst3".into(), 0).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("未在机架中启用"));
    }

    #[test]
    fn editor_states_empty_by_default() {
        assert!(plugin_host_editor_states().is_empty());
    }
}
