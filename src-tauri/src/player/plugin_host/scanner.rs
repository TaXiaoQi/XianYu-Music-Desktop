use std::path::PathBuf;

use serde::Serialize;
use tauri::Emitter;
use truce_rack::clap::ClapScanner;
use truce_rack::core::info::{PluginCategory, PluginInfo};
use truce_rack::core::plugin::Plugin;
use truce_rack::core::scanner::PluginScanner;
use truce_rack::vst3::Vst3Scanner;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginScanEntry {
    pub format: String,
    pub unique_id: String,
    pub name: String,
    pub vendor: String,
    pub version: u32,
    pub category: String,
    pub path: String,
    pub has_editor: bool,
    pub accepts_midi: bool,
}

impl From<&PluginInfo> for PluginScanEntry {
    fn from(info: &PluginInfo) -> Self {
        Self {
            format: info.format.to_string(),
            unique_id: info.unique_id.clone(),
            name: info.name.clone(),
            vendor: info.vendor.clone(),
            version: info.version,
            category: category_label(info.category).to_string(),
            path: info.path.display().to_string(),
            has_editor: info.has_editor,
            accepts_midi: info.accepts_midi,
        }
    }
}

fn category_label(category: truce_rack::core::info::PluginCategory) -> &'static str {
    use truce_rack::core::info::PluginCategory;
    match category {
        PluginCategory::Effect => "effect",
        PluginCategory::Instrument => "instrument",
        PluginCategory::NoteEffect => "noteEffect",
        PluginCategory::Analyzer => "analyzer",
        PluginCategory::Tool => "tool",
    }
}

pub fn standard_scan_directories() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local).join("Programs").join("Common");
        dirs.push(base.join("VST3"));
        dirs.push(base.join("CLAP"));
    }
    if let Some(common) = std::env::var_os("CommonProgramFiles") {
        let base = PathBuf::from(common);
        dirs.push(base.join("VST3"));
        dirs.push(base.join("CLAP"));
    }
    #[cfg(target_os = "windows")]
    {
        let default_vst3 = PathBuf::from(r"C:\Program Files\Common Files\VST3");
        if !dirs.contains(&default_vst3) {
            dirs.push(default_vst3);
        }
        let default_clap = PathBuf::from(r"C:\Program Files\Common Files\CLAP");
        if !dirs.contains(&default_clap) {
            dirs.push(default_clap);
        }
    }
    dirs
}

#[allow(dead_code)]
pub fn scan_all_directories() -> Vec<PluginScanEntry> {
    scan_directories_with_extra(&[], &[], None)
}

pub fn scan_directories_with_extra(
    extra: &[std::path::PathBuf],
    disabled_paths: &[String],
    app: Option<&tauri::AppHandle>,
) -> Vec<PluginScanEntry> {
    let disabled_set: std::collections::HashSet<String> = disabled_paths
        .iter()
        .map(|p| p.trim().to_lowercase())
        .collect();

    let dirs = standard_scan_directories()
        .into_iter()
        .chain(extra.iter().filter(|d| !d.as_os_str().is_empty()).cloned());

    let mut seen = std::collections::HashSet::new();
    let mut entries = Vec::new();

    let on_current = |path: &std::path::Path| {
        let path_str = path.display().to_string();
        if let Some(app) = app {
            let _ = app.emit("plugin-host-scan-current", &path_str);
        }
    };

    for dir in dirs {
        if !dir.exists() {
            continue;
        }

        for info in scan_dir_plugin_infos_recursive(&dir, &disabled_set, &on_current) {
            let key = (info.format.to_string(), info.unique_id.clone());
            if seen.insert(key) {
                let scan_entry = PluginScanEntry::from(&info);
                if let Some(app) = app {
                    let _ = app.emit("plugin-host-scan-item", &scan_entry);
                }
                entries.push(scan_entry);
            }
        }
    }

    entries
}

fn scan_dir_plugin_infos_recursive(
    dir: &std::path::Path,
    disabled_set: &std::collections::HashSet<String>,
    on_current: &impl Fn(&std::path::Path),
) -> Vec<PluginInfo> {
    if !dir.exists() {
        return Vec::new();
    }

    let path_str = dir.display().to_string();
    let path_lower = path_str.to_lowercase();
    if disabled_set.contains(&path_lower) {
        return Vec::new();
    }

    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let is_vst3 = name.ends_with(".vst3");
    let is_clap = name.ends_with(".clap");

    let name_lower = name.to_lowercase();
    if name.eq_ignore_ascii_case("Universal Audio.vst3") || name_lower.contains("waveshell") {
        return Vec::new();
    }

    if is_vst3 || is_clap {
        on_current(dir);
        if is_vst3 {
            return Vst3Scanner::new().scan_bundle(dir).unwrap_or_default();
        } else {
            return ClapScanner::new().scan_bundle(dir).unwrap_or_default();
        }
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let child = entry.path();
        out.extend(scan_dir_plugin_infos_recursive(
            &child,
            disabled_set,
            on_current,
        ));
    }
    out
}

pub fn load_instance(
    format: &str,
    unique_id: &str,
    path: &str,
) -> Result<Box<dyn truce_rack::core::plugin::Plugin<f32> + Send>, String> {
    let info = PluginInfo {
        name: String::new(),
        vendor: String::new(),
        version: 0,
        category: PluginCategory::Effect,
        path: PathBuf::from(path),
        unique_id: unique_id.to_string(),
        format: if format.eq_ignore_ascii_case("vst3") {
            "vst3"
        } else {
            "clap"
        },
        has_editor: false,
        accepts_midi: false,
    };
    if info.format == "vst3" {
        Vst3Scanner::new()
            .load(&info)
            .map(|p| Box::new(p) as Box<dyn Plugin<f32> + Send>)
            .map_err(|e| format!("VST3 插件加载失败: {e}"))
    } else {
        ClapScanner::new()
            .load(&info)
            .map(|p| Box::new(p) as Box<dyn Plugin<f32> + Send>)
            .map_err(|e| format!("CLAP 插件加载失败: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_entry_from_info_maps_fields() {
        let info = PluginInfo {
            name: "Gain".into(),
            vendor: "Moist".into(),
            version: 256,
            category: PluginCategory::Effect,
            path: PathBuf::from("C:/plug/gain.clap"),
            unique_id: "org.moist.gain".into(),
            format: "clap",
            has_editor: false,
            accepts_midi: false,
        };
        let entry = PluginScanEntry::from(&info);
        assert_eq!(entry.format, "clap");
        assert_eq!(entry.unique_id, "org.moist.gain");
        assert_eq!(entry.name, "Gain");
        assert_eq!(entry.path, "C:/plug/gain.clap");
    }

    #[test]
    fn standard_directories_cover_user_and_system() {
        let dirs = standard_scan_directories();
        assert!(dirs.len() >= 2);
        let joined: Vec<String> = dirs.iter().map(|d| d.display().to_string()).collect();
        assert!(joined.iter().any(|d| d.ends_with("VST3")));
        assert!(joined.iter().any(|d| d.ends_with("CLAP")));
    }

    #[test]
    fn load_instance_rejects_unknown_format_as_clap_path() {
        let err = load_instance("vst3", "nonexistent", "C:/does/not/exist.vst3");
        let Err(msg) = err else {
            panic!("加载不存在的插件应失败");
        };
        assert!(msg.contains("VST3"), "unexpected: {msg}");
    }
}
