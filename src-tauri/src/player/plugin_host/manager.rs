use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{Emitter, Manager};
use truce_rack::core::info::ParameterFlags;
use truce_rack::core::plugin::Plugin;

use super::scanner::{load_instance, scan_directories_with_extra, PluginScanEntry};
use super::{rack_handle, RackConfig};

pub const EDITOR_CLOSED_EVENT: &str = "plugin-host-editor-closed";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginParameterEntry {
    pub index: usize,
    pub id: u32,
    pub name: String,
    pub unit: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    pub step_count: u32,
    pub is_bypass: bool,
    pub automatable: bool,
    pub hidden: bool,
    pub read_only: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginParameterValueEntry {
    pub index: usize,
    pub id: u32,
    pub value: f64,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPresetEntry {
    pub index: usize,
    pub name: String,
    pub preset_number: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorStateEntry {
    pub format: String,
    pub unique_id: String,
}

static PARAMETER_CACHE: OnceLock<Mutex<HashMap<String, Vec<PluginParameterEntry>>>> =
    OnceLock::new();

fn parameter_cache() -> &'static Mutex<HashMap<String, Vec<PluginParameterEntry>>> {
    PARAMETER_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

static PRESET_CACHE: OnceLock<Mutex<HashMap<String, Vec<PluginPresetEntry>>>> = OnceLock::new();

fn preset_cache() -> &'static Mutex<HashMap<String, Vec<PluginPresetEntry>>> {
    PRESET_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

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

#[tauri::command]
pub fn plugin_host_get_rack() -> RackConfig {
    rack_handle().snapshot_config()
}

#[tauri::command]
pub fn plugin_host_set_rack(config: RackConfig) {
    rack_handle().set_config(config);
}

#[tauri::command]
pub fn plugin_host_take_process_error() -> Option<String> {
    rack_handle().take_process_error()
}

#[tauri::command]
pub async fn plugin_host_get_plugin_parameters(
    format: String,
    unique_id: String,
    path: String,
) -> Result<Vec<PluginParameterEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_plugin_parameters_blocking(format, unique_id, path)
    })
    .await
    .map_err(|e| format!("插件参数任务执行失败: {e}"))?
}

fn get_plugin_parameters_blocking(
    format: String,
    unique_id: String,
    path: String,
) -> Result<Vec<PluginParameterEntry>, String> {
    let cache_key = format!("{format}::{unique_id}");

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

#[tauri::command]
pub async fn plugin_host_get_parameter_values(
    format: String,
    unique_id: String,
    path: String,
) -> Result<Vec<PluginParameterValueEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_parameter_values_blocking(format, unique_id, path)
    })
    .await
    .map_err(|e| format!("插件参数值任务执行失败: {e}"))?
}

fn get_parameter_values_blocking(
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

#[tauri::command]
pub async fn plugin_host_set_parameter(
    format: String,
    unique_id: String,
    index: usize,
    value: f64,
) -> Result<(), String> {
    let rack = rack_handle();
    let config = rack.snapshot_config();
    let enabled = config
        .slots
        .iter()
        .any(|s| s.enabled && s.format == format && s.unique_id == unique_id);
    if !enabled {
        return Err("该插件未在机架中启用".into());
    }
    rack.update_slot_param(&format, &unique_id, index, value.clamp(0.0, 1.0));
    Ok(())
}

#[tauri::command]
pub async fn plugin_host_get_plugin_presets(
    format: String,
    unique_id: String,
    path: String,
) -> Result<Vec<PluginPresetEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_plugin_presets_blocking(format, unique_id, path)
    })
    .await
    .map_err(|e| format!("插件预设任务执行失败: {e}"))?
}

fn get_plugin_presets_blocking(
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

#[tauri::command]
pub async fn plugin_host_load_preset(
    format: String,
    unique_id: String,
    path: String,
    preset_number: i32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_preset_blocking(format, unique_id, path, preset_number)
    })
    .await
    .map_err(|e| format!("插件预设加载任务执行失败: {e}"))?
}

fn load_preset_blocking(
    format: String,
    unique_id: String,
    path: String,
    preset_number: i32,
) -> Result<(), String> {
    let rack = rack_handle();
    if rack
        .with_slot(&format, &unique_id, |slot| {
            slot.instance.load_preset(preset_number)
        })
        .is_some_and(|r| r.is_ok())
    {
        return Ok(());
    }

    let config = rack.snapshot_config();
    let enabled = config
        .slots
        .iter()
        .any(|s| s.enabled && s.format == format && s.unique_id == unique_id);
    if !enabled {
        return Err("该插件未在机架中启用".into());
    }

    let mut instance = load_instance(&format, &unique_id, &path)?;
    instance
        .load_preset(preset_number)
        .map_err(|e| format!("预设加载失败: {e}"))?;
    let count = instance.parameter_count();
    for index in 0..count {
        if let Ok(value) = instance.parameter_value(index) {
            rack.update_slot_param(&format, &unique_id, index, value);
        }
    }
    drop(instance);
    Ok(())
}

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
        let config = rack.snapshot_config();
        let enabled = config
            .slots
            .iter()
            .any(|s| s.enabled && s.format == format && s.unique_id == unique_id);
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
    super::editor_window::open_editor(owner, rack, &format, &unique_id, &title, move || {
        let _ = app_for_event.emit(
            EDITOR_CLOSED_EVENT,
            serde_json::json!({ "format": format_for_event, "uniqueId": unique_id_for_event }),
        );
    })
}

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

#[tauri::command]
pub fn plugin_host_close_editor(format: String, unique_id: String) {
    #[cfg(target_os = "windows")]
    super::editor_window::close_editor(&format, &unique_id);
    #[cfg(not(target_os = "windows"))]
    let _ = (format, unique_id);
}

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
// ---------------------------------------------------------------------------

fn collect_parameter_entries(instance: &mut dyn Plugin<f32>) -> Vec<PluginParameterEntry> {
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

fn collect_parameter_values(instance: &mut dyn Plugin<f32>) -> Vec<PluginParameterValueEntry> {
    let count = instance.parameter_count();
    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        let id = instance.parameter_info(index).map(|i| i.id).unwrap_or(0);
        if let Ok(value) = instance.parameter_value(index) {
            let text = instance
                .parameter_value_string(index, value)
                .unwrap_or_default();
            entries.push(PluginParameterValueEntry {
                index,
                id,
                value,
                text,
            });
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
            plugin_host_get_plugin_presets("vst3".into(), "nope".into(), "C:/no.vst3".into()).await;
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
