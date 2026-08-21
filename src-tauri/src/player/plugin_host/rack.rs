//! 共享插件机架（P1/P2 架构核心）。
//!
//! P0 时代每个 `PluginHostSource`（每次起播）独立 dlopen 插件并在停止时丢弃，
//! 参数只能在 activate 前一次性下发、编辑器无从谈起。共享机架把实例链提升为
//! 全局单例：
//!
//! - **实例跨起播存活**：播放停止后实例与编辑器状态保留，下次起播
//!   （采样率/声道不变时）零重建直接复用；
//! - **实时参数**：UI 修改经 `set_parameter`（VST3 走 pending_params 队列、
//!   CLAP 走 pending_param_changes + flush）在下一个 process 块生效，
//!   不再等下次起播；
//! - **线程纪律**：实例链在 `state` 互斥锁之后。音频线程每块
//!   `try_lock`（拿不到锁本块旁路直通，绝不阻塞等待）；命令线程
//!   （起播/设置/编辑器）用常规 `lock`，持锁时间受控（块处理微秒级）；
//!   dlopen/activate/实例 drop 等慢操作一律在锁外完成，锁内只做指针交换；
//! - **熔断安全**：process 错误时机架 deactivate 全链并移入 `retired`
//!   （不在音频线程 drop —— 插件编辑器子窗口可能仍指向插件代码，音频线程
//!   不能等编辑器线程退出；retired 由命令线程在确认编辑器关闭后清理）。
//!
//! 链内容始终镜像配置中的「启用槽位」集合与顺序；采样率/声道变化通过
//! deactivate → activate 循环重建（编辑器保持打开，VST3 视图不失效）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use truce_rack::core::buffer::{AudioBuffer, BusRange};
use truce_rack::core::bus::{Bus, BusLayout, ChannelConfig};
use truce_rack::core::events::EventList;
use truce_rack::core::plugin::{Plugin, ProcessContext, ProcessStatus};

use super::scanner::load_instance;
use super::{RackConfig, RackSlotConfig};

/// 处理块大小（帧）。512 帧在 44.1kHz 下约 11.6ms，兼顾插件内部块粒度
/// 与起播延迟。
pub(crate) const BLOCK_SIZE: usize = 512;

/// 编辑器先行打开（从未播放）时的默认激活参数。
const DEFAULT_CHANNELS: u16 = 2;
const DEFAULT_SAMPLE_RATE: u32 = 44_100;

/// 机架中已加载的插件实例（链或 retired 中）。
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

/// 当前链的激活参数（链非空时必有）。
#[derive(Clone, Copy, PartialEq, Eq)]
struct Activation {
    channels: u16,
    sample_rate: u32,
}

struct RackState {
    chain: Vec<RackSlot>,
    activation: Option<Activation>,
    /// 熔断后的退役实例（等待命令线程在编辑器关闭后清理）。
    retired: Vec<RackSlot>,
}

/// 全局共享机架。配置（UI 写）与实例链（音频/命令线程共用）分别加锁，
/// 重建全程由 `rebuild_lock` 串行化。
pub struct SharedRack {
    config: Mutex<RackConfig>,
    state: Mutex<RackState>,
    /// 音频线程无锁快速路径：链为空时逐样本直通。
    chain_empty: AtomicBool,
    /// 命令线程重建串行化（不挡音频线程）。
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
            chain_empty: AtomicBool::new(true),
            rebuild_lock: Mutex::new(()),
            last_process_error: Mutex::new(None),
        }
    }

    // ------------------------------------------------------------------
    // 配置读写
    // ------------------------------------------------------------------

    /// 写入新配置并同步实例链（命令线程）。
    pub fn set_config(&self, config: RackConfig) {
        let old = {
            let mut guard = self.config.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::replace(&mut *guard, config)
        };
        let new = self.snapshot_config();
        self.sync_chain(None, &param_diffs(&old, &new));
    }

    /// 配置快照（持久化 / 前端读取）。
    pub fn snapshot_config(&self) -> RackConfig {
        self.config
            .lock()
            .map(|c| c.clone())
            .unwrap_or_default()
    }

    /// 更新单个参数：写配置（持久语义）+ 若实例已加载则实时下发。
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
    // 链同步（命令线程）
    // ------------------------------------------------------------------

    /// 起播/编辑器路径：按 `channels × sample_rate` 同步链到当前配置。
    /// 采样率/声道与已激活参数一致且槽位集合未变时不做任何事（复用实例）。
    pub fn ensure_ready(&self, channels: u16, sample_rate: u32) {
        self.sync_chain(Some(Activation { channels, sample_rate }), &HashMap::new());
    }

    /// 编辑器先行打开：从未播放时以默认参数构建链。
    pub fn ensure_ready_default(&self) {
        self.ensure_ready(DEFAULT_CHANNELS, DEFAULT_SAMPLE_RATE);
    }

    /// 同步链到配置。
    ///
    /// - `desired`：期望激活参数。`None`（set_config 路径）沿用现有激活参数，
    ///   且链为空时直接返回（构建推迟到下次起播）；
    /// - `param_diffs`：仅对「保留槽位」下发的参数差异（旧配置 → 新配置），
    ///   避免把插件编辑器内的手工调整回滚到旧配置值。
    fn sync_chain(
        &self,
        desired: Option<Activation>,
        param_diffs: &HashMap<(String, String), Vec<(usize, f64)>>,
    ) {
        // 清理退役实例（编辑器关闭后 drop，命令线程安全）
        self.sweep_retired();

        let _guard = self.rebuild_lock.lock().unwrap_or_else(|e| e.into_inner());
        let config = self.snapshot_config();

        // 快速路径：链为空且 set_config 路径 → 推迟到起播
        let (current_keys, current_activation) = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            (
                state.chain.iter().map(|s| (s.format.clone(), s.unique_id.clone())).collect::<Vec<_>>(),
                state.activation,
            )
        };
        if current_keys.is_empty() && desired.is_none() {
            return;
        }

        // 目标：启用槽位（顺序即处理顺序）；总开关关闭时目标为空链
        // （实例退役、编辑器关闭，恢复总开关后下次同步重建）
        let target: Vec<&RackSlotConfig> = if config.has_active_slots() {
            config.slots.iter().filter(|s| s.enabled).collect()
        } else {
            Vec::new()
        };
        let target_keys: Vec<(String, String)> = target
            .iter()
            .map(|s| RackSlot::key(&s.format, &s.unique_id))
            .collect();

        // 期望激活参数：set_config 路径沿用现有（链非空必有）
        let activation = desired.or(current_activation);

        // 槽位集合与顺序都未变，且激活参数匹配 → 只下发参数差异
        let activation_matches = activation.is_some() && activation == current_activation;
        if target_keys == current_keys && activation_matches {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            for slot in state.chain.iter_mut() {
                if let Some(diffs) = param_diffs.get(&RackSlot::key(&slot.format, &slot.unique_id)) {
                    for &(index, value) in diffs {
                        let _ = slot.instance.set_parameter(index, value);
                    }
                }
            }
            return;
        }

        // ---- 全量重建（锁外完成 dlopen/activate） ----
        // 1. 关闭被移除槽位的编辑器（实例仍在链上，编辑器线程能找到并 close）
        for key in &current_keys {
            if !target_keys.contains(key) {
                super::editor_window::close_editor_blocking(&key.0, &key.1);
            }
        }

        // 2. 取出旧链（锁内瞬时限），锁外构建
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
                // 复用现有实例（保编辑器与实时状态）
                let reused = old_chain
                    .iter()
                    .position(|s| s.matches(&key.0, &key.1))
                    .map(|i| old_chain.swap_remove(i));
                if let Some(mut slot) = reused {
                    // 激活参数变化 → deactivate → activate（编辑器保持打开）
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
                    // 下发参数差异（保留槽位）
                    if let Some(diffs) = param_diffs.get(&key) {
                        for &(index, value) in diffs {
                            let _ = slot.instance.set_parameter(index, value);
                        }
                    }
                    new_chain.push(slot);
                    continue;
                }

                // 新槽位：dlopen + 设参 + activate（全部锁外）
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

        // 3. 换入新链（锁内瞬时）
        {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.chain = new_chain;
            state.activation = if state.chain.is_empty() { None } else { activation };
            self.chain_empty
                .store(state.chain.is_empty(), Ordering::Release);
        }

        // 4. 旧链中未被复用的实例退役（编辑器先关，命令线程 drop）
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

    /// 退役一个实例：编辑器若开着先关（等编辑器线程退出），再 deactivate，
    /// 移入 retired 等待 sweep drop。必须在命令线程调用。
    fn retire_slot(&self, slot: RackSlot) {
        super::editor_window::close_editor_blocking(&slot.format, &slot.unique_id);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let mut slot = slot;
        slot.instance.deactivate();
        state.retired.push(slot);
    }

    /// 清理退役实例（命令线程；编辑器全部关闭后才能 drop）。
    pub fn sweep_retired(&self) {
        if self.state.lock().map(|s| s.retired.is_empty()).unwrap_or(true) {
            return;
        }
        // 逐个处理：先确保编辑器关闭（可能需要等线程退出），再取出 drop
        loop {
            let slot = {
                let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                if state.retired.is_empty() {
                    break;
                }
                state.retired.remove(0)
            };
            super::editor_window::close_editor_blocking(&slot.format, &slot.unique_id);
            drop(slot);
        }
    }

    // ------------------------------------------------------------------
    // 查询（命令线程 / 编辑器线程）
    // ------------------------------------------------------------------

    /// 槽位实例是否已在链上。
    pub fn slot_loaded(&self, format: &str, unique_id: &str) -> bool {
        self.state
            .lock()
            .map(|s| s.chain.iter().any(|slot| slot.matches(format, unique_id)))
            .unwrap_or(false)
    }

    /// 对链上槽位实例执行操作（持锁；操作应为快速元数据/参数调用）。
    pub fn with_slot<R>(
        &self,
        format: &str,
        unique_id: &str,
        f: impl FnOnce(&mut RackSlot) -> R,
    ) -> Option<R> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        find_chain_slot(&mut state, format, unique_id).map(f)
    }

    // ------------------------------------------------------------------
    // 音频路径
    // ------------------------------------------------------------------

    /// 链是否为空（音频线程无锁快速路径）。
    pub fn is_bypassed(&self) -> bool {
        self.chain_empty.load(Ordering::Acquire)
    }

    /// 处理一个块（音频线程；try_lock，拿不到锁本块旁路）。
    ///
    /// 结果写回 `planar_a`（内部 A/B 交换，最终结果落回 a）；
    /// 返回 `false` 表示旁路（`planar_a` 保持输入未动，调用方直接采用）。
    /// process 错误触发熔断：deactivate 全链并移入 retired（不在音频线程 drop）。
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
        let Some(act) = state.activation else {
            return false;
        };
        if act.channels != channels || act.sample_rate != sample_rate || state.chain.is_empty() {
            return false;
        }

        let ch = channels as usize;
        for slot in state.chain.iter_mut() {
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
                    transport: None,
                    output_events,
                };
                slot.instance
                    .process(&mut buffer, events, &mut context)
            };
            let failed = match result {
                Err(e) => Some(format!("插件「{}」处理失败: {e}", slot.name)),
                Ok(ProcessStatus::Error) => {
                    Some(format!("插件「{}」process 报告错误状态", slot.name))
                }
                Ok(_) => None,
            };
            if let Some(message) = failed {
                // 熔断：deactivate 全链 → retired（编辑器保持打开，
                // 实例由命令线程在 sweep_retired 中关闭编辑器后 drop）
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
        }
        true
    }

    // ------------------------------------------------------------------
    // 错误上报
    // ------------------------------------------------------------------

    /// 上报一次性处理错误（音频线程 try_lock 非阻塞）。
    pub fn report_process_error(&self, message: String) {
        if let Ok(mut slot) = self.last_process_error.try_lock() {
            *slot = Some(message);
        }
    }

    /// 读取并清除最近的处理错误（命令线程；顺带清理退役实例）。
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

/// 计算旧配置 → 新配置的参数差异（只含双方都有且值不同的参数）。
/// 只对「保留槽位」生效，避免回滚插件编辑器内的手工调整。
fn param_diffs(
    old: &RackConfig,
    new: &RackConfig,
) -> HashMap<(String, String), Vec<(usize, f64)>> {
    let mut out = HashMap::new();
    for new_slot in new.slots.iter().filter(|s| s.enabled) {
        let Some(old_slot) = old
            .slots
            .iter()
            .find(|s| s.enabled && s.format == new_slot.format && s.unique_id == new_slot.unique_id)
        else {
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

/// 按声道数选择主线布局（音乐播放器无侧链/辅助总线需求）。
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
// 测试
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
        // 链为空：set_config 不构建（推迟到起播）
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
        // 禁用槽位不算保留槽位
        let diffs = param_diffs(&old, &new);
        assert!(diffs.is_empty());
        // 全新槽位无旧值可比
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
