//! 显式路径插件扫描。
//!
//! 不使用 truce-rack 的 `default_vst3_paths()` / `default_clap_paths()`：
//! 它们在 Windows 上读 `HOME` 环境变量拼接用户级路径，而 Windows 标准变量
//! 是 `USERPROFILE`（本机 `HOME` 未设置），默认 `scan()` 会漏掉整个用户级
//! 目录（报告 §5.4）。此处显式枚举四条标准路径：
//!
//! - 用户级 VST3：`%LOCALAPPDATA%\Programs\Common\VST3`
//! - 用户级 CLAP：`%LOCALAPPDATA%\Programs\Common\CLAP`
//! - 系统级 VST3：`%CommonProgramFiles%\VST3`
//! - 系统级 CLAP：`%CommonProgramFiles%\CLAP`

use std::path::PathBuf;

use serde::Serialize;
use truce_rack::clap::ClapScanner;
use truce_rack::core::info::{PluginCategory, PluginInfo};
use truce_rack::core::plugin::Plugin;
use truce_rack::core::scanner::PluginScanner;
use truce_rack::vst3::Vst3Scanner;

/// 扫描结果条目（Tauri 序列化 DTO；PluginInfo 本体含 PathBuf/枚举，统一转字符串）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginScanEntry {
    /// "vst3" | "clap"
    pub format: String,
    /// 格式内稳定 ID（加载实例的 key）
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

/// 标准插件目录（用户级 + 系统级，可能因环境变量缺失而缺失）。
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
    dirs
}

/// 扫描全部标准目录，聚合 VST3 + CLAP 结果。
///
/// 逐目录容错：单个目录不存在/读取失败只跳过，不影响其余目录。
/// 按 (format, unique_id) 去重（用户级优先，系统级重复条目丢弃）。
/// 扫描含 dlopen 级操作，只应在命令线程调用，禁止实时上下文。
pub fn scan_all_directories() -> Vec<PluginScanEntry> {
    let mut seen = std::collections::HashSet::new();
    let mut entries = Vec::new();

    for dir in standard_scan_directories() {
        let is_vst3_dir = dir
            .extension()
            .map(|e| e.eq_ignore_ascii_case("vst3"))
            .unwrap_or_else(|| dir.to_string_lossy().to_uppercase().contains("VST3"));
        let infos: Vec<PluginInfo> = if is_vst3_dir {
            Vst3Scanner::new().scan_path(&dir).unwrap_or_default()
        } else {
            ClapScanner::new().scan_path(&dir).unwrap_or_default()
        };
        for info in infos {
            let key = (info.format.to_string(), info.unique_id.clone());
            if seen.insert(key) {
                entries.push(PluginScanEntry::from(&info));
            }
        }
    }

    entries
}

/// 按格式 + unique_id 加载一个插件实例（dlopen + 工厂实例化）。
///
/// 返回 trait 对象供机架统一处理；错误向上传播由调用方决定
/// 降级策略（起播时跳过该槽位并上报，见 source.rs）。
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
        // 至少能从 LOCALAPPDATA 构出用户级两条
        assert!(dirs.len() >= 2);
        let joined: Vec<String> = dirs.iter().map(|d| d.display().to_string()).collect();
        assert!(joined.iter().any(|d| d.ends_with("VST3")));
        assert!(joined.iter().any(|d| d.ends_with("CLAP")));
    }

    #[test]
    fn load_instance_rejects_unknown_format_as_clap_path() {
        // 无法加载不存在的插件：错误信息应包含格式名
        let err = load_instance("vst3", "nonexistent", "C:/does/not/exist.vst3");
        let Err(msg) = err else {
            panic!("加载不存在的插件应失败");
        };
        assert!(msg.contains("VST3"), "unexpected: {msg}");
    }
}
