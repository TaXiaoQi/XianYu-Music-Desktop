//! VST3 / CLAP 原生插件宿主模块（plugin_host）。
//!
//! 基于 vendor 的 truce-rack 1.1.5 fork（含两个已验证补丁，见
//! `vendor/truce-rack` 的 git log 与 `truce-rack-feasibility/` 可行性报告）：
//! - VST3：`_module` 字段重排到结构体末尾，修复实例 drop 时的访问违例；
//! - CLAP：以最小合法 `clap_host` 替代空指针，修复插件加载 abort。
//!
//! P1/P2 架构（共享机架，见 `rack.rs`）：
//! - `rack`：全局共享实例链 —— 实例跨起播存活（保编辑器/实时状态）、
//!   UI 参数修改经参数队列实时生效、音频线程每块 try_lock 处理；
//! - `source`：`PluginHostSource` rodio Source 适配器 —— 512 帧块缓冲、
//!   交织/解交织、链处理委托给共享机架、空机架/锁忙/激活失配旁路；
//! - `editor_window`：Win32 原生编辑器窗口（专用线程 + 消息循环 +
//!   owner 主窗口 Z 序）；
//! - `scanner`：显式路径扫描（用户级 + 系统级 VST3/CLAP 目录），
//!   规避上游 `default_*_paths` 在 Windows 读 `HOME` 的缺陷（报告 §5.4）；
//! - `manager`：机架状态与 Tauri command 面（扫描 / 参数元数据 / 机架配置 /
//!   实时参数 / 预设 / 编辑器窗口）。
//!
//! 管线插入位置（报告 §6.1）：SoundEffectSource 之后、UserVolumeSource 之前，
//! 双输出路径（共享模式 runtime.rs、独占模式 wasapi_exclusive.rs）各一行
//! `plugin_host::wrap(...)`。bit-perfect 分支不经过本模块（解码器直达限幅，
//! 继承项目硬约束）；DSD 直出不经过 PCM DSP，同样不涉及。
//!
//! 参数值语义：VST3/CLAP 参数值均为归一化 [0,1]（报告 §3 实测澄清）。
//! 实时路径：VST3 set_parameter 在 processing 时入 pending_params 队列、
//! process 经 inputParameterChanges 下发；CLAP 入 pending_param_changes、
//! process 经输入事件下发（未处理时 flush 立即生效）。

pub mod manager;
pub mod rack;
pub mod scanner;
pub mod source;

#[cfg(target_os = "windows")]
pub mod editor_window;

use std::sync::{Arc, OnceLock};

use rodio::Source;
use serde::{Deserialize, Serialize};

pub use rack::SharedRack;

// =========================================================================
// 机架配置（UI 线程写，持久化由前端设置体系负责，与音效一致）
// =========================================================================

/// 机架中的一个插件槽位。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RackSlotConfig {
    /// 插件格式："vst3" | "clap"
    pub format: String,
    /// truce-rack PluginInfo::unique_id（加载实例的稳定标识）
    pub unique_id: String,
    /// 插件 bundle 路径（展示与诊断用，加载按 unique_id 走扫描索引）
    pub path: String,
    /// 显示名
    pub name: String,
    /// 厂商
    pub vendor: String,
    /// 是否参与处理
    pub enabled: bool,
    /// 参数覆盖：参数下标（枚举序）→ 归一化值 [0,1]
    /// （VST3/CLAP 参数值均为归一化语义，见报告 §3 踩坑记录）
    pub params: std::collections::HashMap<usize, f64>,
}

/// 完整机架配置。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RackConfig {
    /// 机架总开关（false 时即使有槽位也整链旁路）
    pub master_enabled: bool,
    /// 槽位列表（顺序即处理顺序）
    pub slots: Vec<RackSlotConfig>,
}

impl RackConfig {
    /// 是否有任何插件会参与处理（决定链是否构建）。
    pub(crate) fn has_active_slots(&self) -> bool {
        self.master_enabled && self.slots.iter().any(|s| s.enabled)
    }
}

// =========================================================================
// 全局共享机架（管线组装处不透传参数，保持「两处各一行」的最小侵入）
// =========================================================================

static RACK: OnceLock<Arc<SharedRack>> = OnceLock::new();

/// 获取全局共享机架（首次调用时以空配置初始化）。
pub fn rack_handle() -> Arc<SharedRack> {
    RACK.get_or_init(|| Arc::new(SharedRack::new(RackConfig::default()))).clone()
}

/// 管线插入点：包装 SoundEffectSource 之后的源。
///
/// 机架为空/锁忙/激活失配时本块直通 inner；实例加载与激活在共享机架中
/// 完成（命令线程），音频线程只做 try_lock 处理。
pub fn wrap<I>(inner: I) -> source::PluginHostSource<I>
where
    I: Source<Item = f32>,
{
    source::PluginHostSource::new(inner, rack_handle())
}

// =========================================================================
// 测试
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rack_config_active_slots_requires_master_and_enabled() {
        let mut config = RackConfig::default();
        assert!(!config.has_active_slots());

        config.master_enabled = true;
        config.slots.push(RackSlotConfig {
            enabled: false,
            ..Default::default()
        });
        assert!(!config.has_active_slots());

        config.slots[0].enabled = true;
        assert!(config.has_active_slots());

        config.master_enabled = false;
        assert!(!config.has_active_slots());
    }

    #[test]
    fn global_rack_handle_is_stable() {
        let a = rack_handle();
        let b = rack_handle();
        assert!(Arc::ptr_eq(&a, &b));
    }

    #[test]
    fn rack_slot_config_deserializes_camel_case() {
        let json = r#"{
            "format": "clap",
            "uniqueId": "org.vendor.plugin",
            "path": "C:/x.clap",
            "name": "Plugin",
            "vendor": "Vendor",
            "enabled": true,
            "params": {"0": 0.5, "2": 0.25}
        }"#;
        let slot: RackSlotConfig = serde_json::from_str(json).expect("deserialize");
        assert_eq!(slot.format, "clap");
        assert_eq!(slot.unique_id, "org.vendor.plugin");
        assert!(slot.enabled);
        assert_eq!(slot.params.get(&0), Some(&0.5));
        assert_eq!(slot.params.get(&2), Some(&0.25));
    }

    #[test]
    fn rack_config_deserializes_camel_case() {
        let json = r#"{
            "masterEnabled": true,
            "slots": [{"format": "vst3", "uniqueId": "AB", "enabled": true}]
        }"#;
        let config: RackConfig = serde_json::from_str(json).expect("deserialize");
        assert!(config.master_enabled);
        assert_eq!(config.slots.len(), 1);
        assert_eq!(config.slots[0].unique_id, "AB");
    }
}
