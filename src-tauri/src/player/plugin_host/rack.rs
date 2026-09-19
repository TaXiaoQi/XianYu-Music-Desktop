use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use truce_rack::core::buffer::{AudioBuffer, BusRange};
use truce_rack::core::bus::{Bus, BusLayout, ChannelConfig};
use truce_rack::core::events::EventList;
use truce_rack::core::plugin::{Plugin, ProcessContext, ProcessStatus};

use super::scanner::load_instance;
use super::{RackConfig, RackSlotConfig};

pub(crate) const BLOCK_SIZE: usize = 512;

const DEFAULT_CHANNELS: u16 = 2;
const DEFAULT_SAMPLE_RATE: u32 = 44_100;

fn close_editor_blocking(format: &str, unique_id: &str) {
    #[cfg(target_os = "windows")]
    super::editor_window::close_editor_blocking(format, unique_id);
    #[cfg(not(target_os = "windows"))]
    let _ = (format, unique_id);
}

pub(crate) struct RackSlot {
    pub format: String,
    pub unique_id: String,
    pub name: String,
    pub instance: Box<dyn Plugin<f32> + Send>,
}

impl RackSlot {
    fn key(format: &str, unique_id: &str) -> (String, String) {
        (format.to_string(), unique_id.to_string())
    }

    fn matches(&self, format: &str, unique_id: &str) -> bool {
        self.format == format && self.unique_id == unique_id
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Activation {
    channels: u16,
    sample_rate: u32,
}

struct RackState {
    chain: Vec<RackSlot>,
    activation: Option<Activation>,
    retired: Vec<RackSlot>,
}

pub struct SharedRack {
    config: Mutex<RackConfig>,
    state: Mutex<RackState>,
    last_ready: Mutex<Option<Activation>>,
    chain_empty: AtomicBool,
    rebuild_lock: Mutex<()>,
    last_process_error: Mutex<Option<String>>,
}

impl SharedRack {
    pub fn new(config: RackConfig) -> Self {
        Self {
            config: Mutex::new(config),
            state: Mutex::new(RackState {
                chain: Vec::new(),
                activation: None,
                retired: Vec::new(),
            }),
            last_ready: Mutex::new(None),
            chain_empty: AtomicBool::new(true),
            rebuild_lock: Mutex::new(()),
            last_process_error: Mutex::new(None),
        }
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------

    pub fn set_config(&self, config: RackConfig) {
        let old = {
            let mut guard = self.config.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::replace(&mut *guard, config)
        };
        let new = self.snapshot_config();
        self.sync_chain(None, &param_diffs(&old, &new));
    }

    pub fn snapshot_config(&self) -> RackConfig {
        self.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn update_slot_param(&self, format: &str, unique_id: &str, index: usize, value: f64) {
        {
            let mut config = self.config.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(slot) = find_config_slot(&mut config, format, unique_id) {
                slot.params.insert(index, value);
            }
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(slot) = find_chain_slot(&mut state, format, unique_id) {
            let _ = slot.instance.set_parameter(index, value);
        }
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------

    pub fn ensure_ready(&self, channels: u16, sample_rate: u32) {
        let act = Activation {
            channels,
            sample_rate,
        };
        {
            let mut last = self.last_ready.lock().unwrap_or_else(|e| e.into_inner());
            *last = Some(act);
        }
        self.sync_chain(Some(act), &HashMap::new());
    }

    pub fn ensure_ready_default(&self) {
        self.ensure_ready(DEFAULT_CHANNELS, DEFAULT_SAMPLE_RATE);
    }

    fn sync_chain(
        &self,
        desired: Option<Activation>,
        param_diffs: &HashMap<(String, String), Vec<(usize, f64)>>,
    ) {
        self.sweep_retired();

        let _guard = self.rebuild_lock.lock().unwrap_or_else(|e| e.into_inner());
        let config = self.snapshot_config();

        let (current_keys, current_activation) = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            (
                state
                    .chain
                    .iter()
                    .map(|s| (s.format.clone(), s.unique_id.clone()))
                    .collect::<Vec<_>>(),
                state.activation,
            )
        };
        if current_keys.is_empty() && desired.is_none() {
            let last = self.last_ready.lock().unwrap_or_else(|e| e.into_inner());
            if last.is_none() {
                return;
            }
        }

        let target: Vec<&RackSlotConfig> = if config.has_active_slots() {
            config.slots.iter().filter(|s| s.enabled).collect()
        } else {
            Vec::new()
        };
        let target_keys: Vec<(String, String)> = target
            .iter()
            .map(|s| RackSlot::key(&s.format, &s.unique_id))
            .collect();

        let activation = desired
            .or(current_activation)
            .or(*self.last_ready.lock().unwrap_or_else(|e| e.into_inner()));

        let activation_matches = activation.is_some() && activation == current_activation;
        if target_keys == current_keys && activation_matches {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            for slot in state.chain.iter_mut() {
                if let Some(diffs) = param_diffs.get(&RackSlot::key(&slot.format, &slot.unique_id))
                {
                    for &(index, value) in diffs {
                        let _ = slot.instance.set_parameter(index, value);
                    }
                }
            }
            return;
        }

        // ---- 全量重建（锁外完成 dlopen/activate） ----
        for key in &current_keys {
            if !target_keys.contains(key) {
                close_editor_blocking(&key.0, &key.1);
            }
        }

        let mut old_chain = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut state.chain)
        };

        let mut new_chain: Vec<RackSlot> = Vec::with_capacity(target.len());
        let mut failures: Vec<String> = Vec::new();

        if let Some(act) = activation {
            let layout = layout_for_channels(act.channels as usize);
            let rate = act.sample_rate as f64;
            let reused_keys: Vec<(String, String)> = target_keys.clone();

            for (cfg, key) in target.iter().zip(reused_keys) {
                let reused = old_chain
                    .iter()
                    .position(|s| s.matches(&key.0, &key.1))
                    .map(|i| old_chain.swap_remove(i));
                if let Some(mut slot) = reused {
                    if current_activation != Some(act) {
                        slot.instance.deactivate();
                    }
                    if !slot.instance.is_active() {
                        if let Err(e) = slot.instance.activate(layout.clone(), rate, BLOCK_SIZE) {
                            failures.push(format!("「{}」激活失败: {e}", cfg.name));
                            slot.instance.deactivate();
                            self.retire_slot(slot);
                            continue;
                        }
                    }
                    if let Some(diffs) = param_diffs.get(&key) {
                        for &(index, value) in diffs {
                            let _ = slot.instance.set_parameter(index, value);
                        }
                    }
                    new_chain.push(slot);
                    continue;
                }

                match load_instance(&cfg.format, &cfg.unique_id, &cfg.path) {
                    Ok(mut instance) => {
                        for (&index, &value) in &cfg.params {
                            let _ = instance.set_parameter(index, value);
                        }
                        match instance.activate(layout.clone(), rate, BLOCK_SIZE) {
                            Ok(()) => new_chain.push(RackSlot {
                                format: cfg.format.clone(),
                                unique_id: cfg.unique_id.clone(),
                                name: cfg.name.clone(),
                                instance,
                            }),
                            Err(e) => {
                                failures.push(format!("「{}」激活失败: {e}", cfg.name));
                                instance.deactivate();
                            }
                        }
                    }
                    Err(e) => failures.push(format!("「{}」{e}", cfg.name)),
                }
            }
        }

        {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.chain = new_chain;
            state.activation = if state.chain.is_empty() {
                None
            } else {
                activation
            };
            self.chain_empty
                .store(state.chain.is_empty(), Ordering::Release);
        }

        for slot in old_chain {
            self.retire_slot(slot);
        }
        self.sweep_retired();

        if !failures.is_empty() {
            self.report_process_error(format!(
                "插件机架部分槽位不可用，已跳过: {}",
                failures.join("；")
            ));
        }
    }

    fn retire_slot(&self, slot: RackSlot) {
        let format = slot.format.clone();
        let unique_id = slot.unique_id.clone();
        {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let mut slot = slot;
            slot.instance.deactivate();
            state.retired.push(slot);
        }
        close_editor_blocking(&format, &unique_id);
    }

    pub fn sweep_retired(&self) {
        if self
            .state
            .lock()
            .map(|s| s.retired.is_empty())
            .unwrap_or(true)
        {
            return;
        }
        loop {
            let slot = {
                let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                if state.retired.is_empty() {
                    break;
                }
                state.retired.remove(0)
            };
            close_editor_blocking(&slot.format, &slot.unique_id);
            drop(slot);
        }
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------

    pub fn slot_loaded(&self, format: &str, unique_id: &str) -> bool {
        self.state
            .lock()
            .map(|s| s.chain.iter().any(|slot| slot.matches(format, unique_id)))
            .unwrap_or(false)
    }

    pub fn with_slot<R>(
        &self,
        format: &str,
        unique_id: &str,
        f: impl FnOnce(&mut RackSlot) -> R,
    ) -> Option<R> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        find_chain_slot(&mut state, format, unique_id).map(f)
    }

    pub fn try_with_slot<R>(
        &self,
        format: &str,
        unique_id: &str,
        f: impl FnOnce(&mut RackSlot) -> R,
    ) -> Option<R> {
        let Ok(mut state) = self.state.try_lock() else {
            return None;
        };
        find_chain_slot(&mut state, format, unique_id).map(f)
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------

    pub fn is_bypassed(&self) -> bool {
        self.chain_empty.load(Ordering::Acquire)
    }

    pub fn process_block(
        &self,
        channels: u16,
        sample_rate: u32,
        frames: usize,
        planar_a: &mut Vec<Vec<f32>>,
        planar_b: &mut Vec<Vec<f32>>,
        events: &EventList,
        output_events: &mut EventList,
    ) -> bool {
        if self.chain_empty.load(Ordering::Acquire) || frames == 0 {
            return false;
        }
        let Ok(mut state) = self.state.try_lock() else {
            return false;
        };

        if state.chain.is_empty() {
            return false;
        }

        let needs_reactivate = match state.activation {
            Some(act) => act.channels != channels || act.sample_rate != sample_rate,
            None => true,
        };

        if needs_reactivate {
            let layout = layout_for_channels(channels as usize);
            let rate = sample_rate as f64;
            let mut index = 0;
            while index < state.chain.len() {
                let slot = &mut state.chain[index];
                if slot.instance.is_active() {
                    slot.instance.deactivate();
                }
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    slot.instance.activate(layout.clone(), rate, BLOCK_SIZE)
                }));
                match outcome {
                    Ok(Ok(())) | Ok(Err(_)) => index += 1,
                    Err(_) => {
                        let name = slot.name.clone();
                        let dead = state.chain.remove(index);
                        state.retired.push(dead);
                        self.report_process_error(format!(
                            "插件「{name}」activate 发生 panic，槽位已移除"
                        ));
                    }
                }
            }
            if state.chain.is_empty() {
                state.activation = None;
                self.chain_empty.store(true, Ordering::Release);
                return false;
            }
            state.activation = Some(Activation {
                channels,
                sample_rate,
            });
        }

        let ch = channels as usize;
        let mut index = 0;
        while index < state.chain.len() {
            let slot = &mut state.chain[index];
            for (dest, src) in planar_b.iter_mut().zip(planar_a.iter()) {
                dest[..frames].copy_from_slice(&src[..frames]);
            }
            let result = {
                let inputs: Vec<&[f32]> = planar_a.iter().map(|c| &c[..frames]).collect();
                let mut outputs: Vec<&mut [f32]> =
                    planar_b.iter_mut().map(|c| &mut c[..frames]).collect();
                let in_ranges = [BusRange::new(0, ch)];
                let out_ranges = [BusRange::new(0, ch)];
                let mut buffer =
                    AudioBuffer::new(&inputs, &mut outputs, frames, &in_ranges, &out_ranges);
                let mut context = ProcessContext {
                    sample_rate: sample_rate as f64,
                    max_block_size: BLOCK_SIZE,
                    transport: Some(truce_rack::core::transport::TransportInfo {
                        tempo_bpm: Some(120.0),
                        playing: true,
                        time_signature: Some((4, 4)),
                        song_position_samples: None,
                        song_position_beats: None,
                        bar_start_beats: None,
                        loop_active: false,
                        recording: false,
                    }),
                    output_events,
                };
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    slot.instance.process(&mut buffer, events, &mut context)
                }))
            };
            let failed = match result {
                Err(_) => {
                    for channel in planar_b.iter_mut() {
                        channel[..frames].fill(0.0);
                    }
                    let name = slot.name.clone();
                    let dead = state.chain.remove(index);
                    state.retired.push(dead);
                    if state.chain.is_empty() {
                        state.activation = None;
                        self.chain_empty.store(true, Ordering::Release);
                    }
                    std::mem::swap(planar_a, planar_b);
                    output_events.clear();
                    self.report_process_error(format!(
                        "插件「{name}」process 发生 panic，槽位已移除，本块输出已静音"
                    ));
                    return true;
                }
                Ok(Err(e)) => Some(format!("插件「{}」处理失败: {e}", slot.name)),
                Ok(Ok(ProcessStatus::Error)) => {
                    Some(format!("插件「{}」process 报告错误状态", slot.name))
                }
                Ok(Ok(_)) => None,
            };
            if let Some(message) = failed {
                let mut retired = std::mem::take(&mut state.chain);
                state.activation = None;
                for slot in retired.iter_mut() {
                    slot.instance.deactivate();
                }
                state.retired.extend(retired);
                self.chain_empty.store(true, Ordering::Release);
                self.report_process_error(format!("{message}（机架已旁路，下次起播恢复）"));
                return false;
            }
            std::mem::swap(planar_a, planar_b);
            output_events.clear();
            index += 1;
        }
        true
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------

    pub fn report_process_error(&self, message: String) {
        if let Ok(mut slot) = self.last_process_error.try_lock() {
            *slot = Some(message);
        }
    }

    pub fn take_process_error(&self) -> Option<String> {
        self.sweep_retired();
        self.last_process_error
            .lock()
            .ok()
            .and_then(|mut e| e.take())
    }
}

fn find_config_slot<'a>(
    config: &'a mut RackConfig,
    format: &str,
    unique_id: &str,
) -> Option<&'a mut RackSlotConfig> {
    config
        .slots
        .iter_mut()
        .find(|s| s.enabled && s.format == format && s.unique_id == unique_id)
}

fn find_chain_slot<'a>(
    state: &'a mut RackState,
    format: &str,
    unique_id: &str,
) -> Option<&'a mut RackSlot> {
    state
        .chain
        .iter_mut()
        .find(|s| s.matches(format, unique_id))
}

fn param_diffs(old: &RackConfig, new: &RackConfig) -> HashMap<(String, String), Vec<(usize, f64)>> {
    let mut out = HashMap::new();
    for new_slot in new.slots.iter().filter(|s| s.enabled) {
        let Some(old_slot) = old.slots.iter().find(|s| {
            s.enabled && s.format == new_slot.format && s.unique_id == new_slot.unique_id
        }) else {
            continue;
        };
        let mut diffs = Vec::new();
        for (&index, &value) in &new_slot.params {
            if old_slot.params.get(&index) != Some(&value) {
                diffs.push((index, value));
            }
        }
        if !diffs.is_empty() {
            out.insert(RackSlot::key(&new_slot.format, &new_slot.unique_id), diffs);
        }
    }
    out
}

pub(crate) fn layout_for_channels(ch: usize) -> BusLayout {
    match ch {
        1 => BusLayout::mono(),
        2 => BusLayout::stereo(),
        n => {
            let mut layout = BusLayout::new();
            let channels = ChannelConfig::Discrete(n as u32);
            layout.inputs.push(Bus::main("Input", channels));
            layout.outputs.push(Bus::main("Output", channels));
            layout
        }
    }
}

// =========================================================================
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_slot(enabled: bool, params: HashMap<usize, f64>) -> RackConfig {
        let mut config = RackConfig::default();
        config.master_enabled = true;
        config.slots.push(RackSlotConfig {
            format: "vst3".into(),
            unique_id: "X".into(),
            path: "C:/none.vst3".into(),
            name: "X".into(),
            vendor: String::new(),
            enabled,
            params,
        });
        config
    }

    #[test]
    fn set_config_with_empty_chain_defers_build() {
        let rack = SharedRack::new(RackConfig::default());
        rack.set_config(config_with_slot(true, HashMap::new()));
        assert!(!rack.slot_loaded("vst3", "X"));
    }

    #[test]
    fn ensure_ready_with_unloadable_slot_stays_empty() {
        let rack = SharedRack::new(config_with_slot(true, HashMap::new()));
        rack.ensure_ready(2, 44_100);
        assert!(rack.is_bypassed());
        assert!(rack.take_process_error().is_some(), "加载失败应上报");
    }

    #[test]
    fn update_slot_param_persists_to_config() {
        let rack = SharedRack::new(config_with_slot(true, HashMap::new()));
        rack.update_slot_param("vst3", "X", 0, 0.5);
        let snapshot = rack.snapshot_config();
        assert_eq!(snapshot.slots[0].params.get(&0), Some(&0.5));
    }

    #[test]
    fn update_slot_param_on_disabled_slot_is_noop() {
        let rack = SharedRack::new(config_with_slot(false, HashMap::new()));
        rack.update_slot_param("vst3", "X", 0, 0.5);
        let snapshot = rack.snapshot_config();
        assert!(snapshot.slots[0].params.is_empty());
    }

    #[test]
    fn param_diffs_only_reports_changed_values() {
        let mut old = config_with_slot(true, HashMap::from([(0usize, 0.5), (1usize, 0.25)]));
        old.slots[0].name = "X".into();
        let new = config_with_slot(true, HashMap::from([(0usize, 0.75), (1usize, 0.25)]));
        let diffs = param_diffs(&old, &new);
        let entry = diffs.get(&("vst3".to_string(), "X".to_string())).unwrap();
        assert_eq!(entry, &vec![(0usize, 0.75)]);
    }

    #[test]
    fn param_diffs_ignores_disabled_and_new_slots() {
        let old = config_with_slot(true, HashMap::from([(0usize, 0.5)]));
        let mut new = config_with_slot(false, HashMap::from([(0usize, 0.9)]));
        let diffs = param_diffs(&old, &new);
        assert!(diffs.is_empty());
        new.slots[0].enabled = true;
        new.slots[0].unique_id = "Y".into();
        let diffs = param_diffs(&old, &new);
        assert!(diffs.is_empty());
    }

    #[test]
    fn process_block_bypasses_when_empty_rack() {
        let rack = SharedRack::new(RackConfig::default());
        let mut a = vec![vec![0.5f32; 8], vec![0.5f32; 8]];
        let mut b = vec![vec![0.0f32; 8], vec![0.0f32; 8]];
        let events = EventList::new();
        let mut out = EventList::new();
        assert!(!rack.process_block(2, 44_100, 8, &mut a, &mut b, &events, &mut out));
        assert_eq!(a[0][0], 0.5, "旁路时 planar_a 保持输入未动");
    }

    #[test]
    fn error_report_and_take_roundtrip() {
        let rack = SharedRack::new(RackConfig::default());
        assert_eq!(rack.take_process_error(), None);
        rack.report_process_error("boom".into());
        assert_eq!(rack.take_process_error().as_deref(), Some("boom"));
        assert_eq!(rack.take_process_error(), None);
    }

    #[test]
    fn with_slot_returns_none_for_missing() {
        let rack = SharedRack::new(RackConfig::default());
        assert!(rack.with_slot("vst3", "missing", |_| ()).is_none());
    }

    #[test]
    fn layout_for_channels_matches_count() {
        assert_eq!(layout_for_channels(1).inputs.len(), 1);
        assert_eq!(layout_for_channels(2).inputs.len(), 1);
        assert_eq!(layout_for_channels(6).inputs.len(), 1);
    }
}
