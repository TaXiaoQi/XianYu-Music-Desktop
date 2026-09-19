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
// =========================================================================

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RackSlotConfig {
    pub format: String,
    pub unique_id: String,
    pub path: String,
    pub name: String,
    pub vendor: String,
    pub enabled: bool,
    pub params: std::collections::HashMap<usize, f64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RackConfig {
    pub master_enabled: bool,
    pub slots: Vec<RackSlotConfig>,
}

impl RackConfig {
    pub(crate) fn has_active_slots(&self) -> bool {
        self.master_enabled && self.slots.iter().any(|s| s.enabled)
    }
}

// =========================================================================
// =========================================================================

static RACK: OnceLock<Arc<SharedRack>> = OnceLock::new();

pub fn rack_handle() -> Arc<SharedRack> {
    RACK.get_or_init(|| Arc::new(SharedRack::new(RackConfig::default())))
        .clone()
}

pub fn wrap<I>(inner: I) -> source::PluginHostSource<I>
where
    I: Source<Item = f32>,
{
    source::PluginHostSource::new(inner, rack_handle())
}

// =========================================================================
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
