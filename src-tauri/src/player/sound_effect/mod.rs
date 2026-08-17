//! 音效处理模块（sound_effect）。
//!
//! 按 Rust rodio 引擎特性复现 YinDongMusic 全部音效。参数同步采用 `Arc<Mutex<Settings>>`
//! + `dirty: AtomicBool` 模式（与 `equalizer.rs` 一致）：UI 线程 `lock()` 写 + 置 dirty，
//! 音频线程每 64 帧读 dirty（原子，无锁），仅 dirty=true 时 `try_lock()` 非阻塞克隆快照。
//! `try_lock` 失败时下个 64 帧重试，绝不阻塞音频线程。Freeverb 的 `apply_params` 是 O(12)
//! （仅改 comb 系数字段），锁内仅克隆 ~200B 结构 + 改 12 个系数，耗时 ~1μs，无爆音风险。
//!
//! 处理链顺序（每帧 L/R 同时处理）：
//! 变调变速 → 声道处理 → 波形整形 → 动态 → 调制 → 混响 → 空间 → V4A/audioBoost
//!
//! 各子模块：
//! - `dsp`：共享 DSP 原语（Biquad/DelayLine/LFO/平滑值/包络跟随器）
//! - `channel`：声道处理（消人声/单声道/交换/拓宽/分离度/Crossfeed/BassBoost/DynamicEQ）
//! - `shaper`：波形整形（失真/激励器/次低音/比特粉碎/LoFi）
//! - `dynamics`：动态类（噪声门/扩展器/压缩/多段/去齿音/限制器/AGC）
//! - `modulation`：调制类（抖音/颤音/音调漂移/镶边/相位/延迟）
//! - `reverb`：混响（Freeverb 算法，8 梳状 + 4 全通，每样本 O(1)，无 FFT/IR）
//! - `spatial`：空间音效（3D/8D/36D 环绕 + 虚拟多声道）
//! - `pitch`：变调变速（OLA 时间拉伸 + 线性重采样 / 改 sample_rate）

pub mod channel;
pub mod convolution;
pub mod dsp;
pub mod dynamics;
pub mod modulation;
pub mod pitch;
pub mod reverb;
pub mod shaper;
pub mod spatial;

use rodio::source::SeekError;
use rodio::Source;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

// =========================================================================
// 枚举
// =========================================================================

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ReverbKind {
    #[default]
    None,
    Algorithmic,
    Convolution,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SpatialMode {
    #[default]
    None,
    Surround3d,
    D8,
    D36,
    Virtual,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DistortionType {
    #[default]
    Soft,
    Hard,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DelayType {
    #[default]
    Single,
    Pingpong,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum VirtualSurroundMode {
    #[serde(rename = "5.1")]
    FiveOne,
    #[serde(rename = "7.1")]
    #[default]
    SevenOne,
}

// =========================================================================
// 参数结构体
// =========================================================================

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModulationParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub rate: f32,
    #[serde(default)]
    pub depth: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FlangerParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub rate: f32,
    #[serde(default)]
    pub depth: f32,
    #[serde(default)]
    pub feedback: f32,
    #[serde(default)]
    pub mix: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PhaserParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub rate: f32,
    #[serde(default)]
    pub depth: f32,
    #[serde(default)]
    pub feedback: f32,
    #[serde(default)]
    pub mix: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DelayParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub time_ms: f32,
    #[serde(default)]
    pub feedback: f32,
    #[serde(default)]
    pub mix: f32,
    #[serde(default)]
    pub delay_type: DelayType,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CompressorParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub threshold: f32,
    #[serde(default)]
    pub ratio: f32,
    #[serde(default)]
    pub attack: f32,
    #[serde(default)]
    pub release: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MultibandParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub low_freq: f32,
    #[serde(default)]
    pub mid_freq: f32,
    #[serde(default)]
    pub threshold: f32,
    #[serde(default)]
    pub ratio: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LimiterParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub threshold: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NoiseGateParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub threshold: f32,
    #[serde(default)]
    pub attack: f32,
    #[serde(default)]
    pub release: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExpanderParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub threshold: f32,
    #[serde(default)]
    pub ratio: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgcParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub target_level: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeEsserParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub threshold: f32,
    #[serde(default)]
    pub frequency: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DistortionParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub amount: f32,
    #[serde(default)]
    pub distortion_type: DistortionType,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExciterParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub amount: f32,
    #[serde(default)]
    pub frequency: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SubBassParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub amount: f32,
    #[serde(default)]
    pub frequency: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LoFiParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub sample_rate: f32,
    #[serde(default)]
    pub bit_depth: f32,
    #[serde(default)]
    pub noise: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BitcrushParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub bits: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StereoWidenParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub amount: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StereoSepParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub width: f32,
    #[serde(default)]
    pub center_level: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CrossfeedParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub strength: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BassBoostParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub gain: f32,
    #[serde(default)]
    pub dynamic: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DynamicEqParams {
    #[serde(default)]
    pub enabled: bool,
}

/// 音调漂移参数（前端 contracts 中为 ModulationParams{rate,depth}，此处 speed 接收 rate 别名）
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PitchDriftParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, alias = "rate")]
    pub speed: f32,
    #[serde(default)]
    pub depth: f32,
}

// =========================================================================
// SoundEffectSettings（与前端 contracts.ts 一一对应，camelCase）
// =========================================================================
//
// 注意：pitch_shift / playback_rate 以 100 为基准（100 = 原调原速），
// 不能用 f32 的默认值 0.0（会被 pitch 处理器解读为 0% → 极端变调变速 → 破音/静音）。
// 因此 SoundEffectSettings 不使用 #[derive(Default)]，而是手动实现 Default，
// 并为这两个字段提供 serde 级别的默认函数，确保前端漏传字段时也安全。

fn default_pitch_rate() -> f32 {
    100.0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SoundEffectSettings {
    // 变调/变速（100 = 原调原速）
    #[serde(default = "default_pitch_rate")]
    pub pitch_shift: f32,
    #[serde(default = "default_pitch_rate")]
    pub playback_rate: f32,
    #[serde(default)]
    pub preserves_pitch: bool,
    // 混响
    pub reverb_kind: ReverbKind,
    pub reverb_preset: String,
    pub reverb_dry: f32,
    pub reverb_wet: f32,
    // 空间
    pub spatial_mode: SpatialMode,
    pub spatial_speed: f32,
    pub spatial_radius: f32,
    pub spatial_intensity: f32,
    pub virtual_surround_mode: VirtualSurroundMode,
    pub virtual_surround_spread: f32,
    // 调制
    pub vibrato: ModulationParams,
    pub pitch_drift: PitchDriftParams,
    pub tremolo: ModulationParams,
    pub flanger: FlangerParams,
    pub phaser: PhaserParams,
    pub delay: DelayParams,
    // 动态
    pub compressor: CompressorParams,
    pub multiband: MultibandParams,
    pub limiter: LimiterParams,
    pub noise_gate: NoiseGateParams,
    pub expander: ExpanderParams,
    pub agc: AgcParams,
    pub de_esser: DeEsserParams,
    // 波形整形
    pub distortion: DistortionParams,
    pub exciter: ExciterParams,
    pub sub_bass: SubBassParams,
    pub lo_fi: LoFiParams,
    pub bitcrush: BitcrushParams,
    // 声道处理
    pub vocal_removal: bool,
    pub stereo_widen: StereoWidenParams,
    pub mono_merge: bool,
    pub channel_swap: bool,
    pub stereo_separation: StereoSepParams,
    pub crossfeed: CrossfeedParams,
    pub bass_boost: BassBoostParams,
    pub dynamic_eq: DynamicEqParams,
    // 组合
    pub v4a_enabled: bool,
    pub bypass: bool,
    pub audio_boost: f32,
}

/// 手动实现 Default：pitch_shift / playback_rate 必须为 100.0（原调原速），
/// 其余字段沿用类型默认（全部 disabled / 0 / None，等价于纯直通）。
impl Default for SoundEffectSettings {
    fn default() -> Self {
        Self {
            pitch_shift: 100.0,
            playback_rate: 100.0,
            preserves_pitch: false,
            reverb_kind: ReverbKind::None,
            reverb_preset: String::new(),
            reverb_dry: 0.0,
            reverb_wet: 0.0,
            spatial_mode: SpatialMode::None,
            spatial_speed: 0.0,
            spatial_radius: 0.0,
            spatial_intensity: 0.0,
            virtual_surround_mode: VirtualSurroundMode::SevenOne,
            virtual_surround_spread: 0.0,
            vibrato: ModulationParams::default(),
            pitch_drift: PitchDriftParams::default(),
            tremolo: ModulationParams::default(),
            flanger: FlangerParams::default(),
            phaser: PhaserParams::default(),
            delay: DelayParams::default(),
            compressor: CompressorParams::default(),
            multiband: MultibandParams::default(),
            limiter: LimiterParams::default(),
            noise_gate: NoiseGateParams::default(),
            expander: ExpanderParams::default(),
            agc: AgcParams::default(),
            de_esser: DeEsserParams::default(),
            distortion: DistortionParams::default(),
            exciter: ExciterParams::default(),
            sub_bass: SubBassParams::default(),
            lo_fi: LoFiParams::default(),
            bitcrush: BitcrushParams::default(),
            vocal_removal: false,
            stereo_widen: StereoWidenParams::default(),
            mono_merge: false,
            channel_swap: false,
            stereo_separation: StereoSepParams::default(),
            crossfeed: CrossfeedParams::default(),
            bass_boost: BassBoostParams::default(),
            dynamic_eq: DynamicEqParams::default(),
            v4a_enabled: false,
            bypass: false,
            audio_boost: 0.0,
        }
    }
}

impl SoundEffectSettings {
    #[inline]
    fn pitch_rate_is_neutral(&self) -> bool {
        let pitch = if self.pitch_shift.is_finite() {
            self.pitch_shift
        } else {
            100.0
        };
        let rate = if self.playback_rate.is_finite() {
            self.playback_rate
        } else {
            100.0
        };

        (pitch - 100.0).abs() < 0.1 && (rate - 100.0).abs() < 0.1
    }

    /// 是否存在真正会改变音频内容的音效。
    ///
    /// 注意：`audio_boost` 不参与这里的判断。旧版本前端曾把不可见的 audioBoost
    /// 默认设为 60，导致“没开音效”也被额外放大并削波。只有当其它音效/变调/变速
    /// 已经激活时，process() 末尾的 audioBoost 才会作为附加增益参与处理。
    #[inline]
    fn has_audible_processing(&self) -> bool {
        !self.pitch_rate_is_neutral()
            || self.reverb_kind != ReverbKind::None
            || self.spatial_mode != SpatialMode::None
            || self.vibrato.enabled
            || self.pitch_drift.enabled
            || self.tremolo.enabled
            || self.flanger.enabled
            || self.phaser.enabled
            || self.delay.enabled
            || self.compressor.enabled
            || self.multiband.enabled
            || self.limiter.enabled
            || self.noise_gate.enabled
            || self.expander.enabled
            || self.agc.enabled
            || self.de_esser.enabled
            || self.distortion.enabled
            || self.exciter.enabled
            || self.sub_bass.enabled
            || self.lo_fi.enabled
            || self.bitcrush.enabled
            || self.vocal_removal
            || self.stereo_widen.enabled
            || self.mono_merge
            || self.channel_swap
            || self.stereo_separation.enabled
            || self.crossfeed.enabled
            || self.bass_boost.enabled
            || self.dynamic_eq.enabled
            || self.v4a_enabled
    }

    #[inline]
    fn should_hard_bypass(&self) -> bool {
        self.bypass || !self.has_audible_processing()
    }
}

// =========================================================================
// SoundEffectHandle（跨线程共享：UI 线程写，音频线程读）
// =========================================================================
//
// 与 equalizer.rs 的 EqualizerHandle 完全一致的模式：
// - `settings: Arc<Mutex<SoundEffectSettings>>`：UI 线程 lock() 写，音频线程 try_lock() 读
// - `dirty: AtomicBool`：UI 线程 set_settings 后置 true，音频线程先读 dirty（原子，无锁），
//   仅 true 时才 try_lock 克隆快照。try_lock 失败（UI 线程持锁）时下个 64 帧重试，绝不阻塞。
//
// 选型理由：Freeverb 的 apply_params 是 O(12)（仅改 comb feedback/damp 系数），不像旧版 FFT
// 卷积需要重建 86 个分区（2-5ms）。锁内仅克隆 ~200B 结构，耗时 <1μs，无爆音/卡顿风险。
// 无需 arc-swap 外部依赖（crates.io 网络不可达时无法下载）。

pub struct SoundEffectHandle {
    pub settings: Arc<Mutex<SoundEffectSettings>>,
    pub dirty: AtomicBool,
}

impl SoundEffectHandle {
    pub fn new(settings: SoundEffectSettings) -> Self {
        Self {
            settings: Arc::new(Mutex::new(settings)),
            dirty: AtomicBool::new(false),
        }
    }

    /// UI 线程写入新设置并标记 dirty。
    /// lock() 阻塞但仅在 UI 线程调用，持锁时间 = 一次结构体赋值（<1μs）。
    pub fn set_settings(&self, new_settings: SoundEffectSettings) {
        if let Ok(mut s) = self.settings.lock() {
            *s = new_settings;
        }
        // Release：确保上面的写入在 dirty=true 对音频线程可见之前完成
        self.dirty.store(true, Ordering::Release);
    }
}

// =========================================================================
// SoundEffectSource（rodio Source 装饰器，集成全部机架）
// =========================================================================

pub struct SoundEffectSource<I> {
    inner: I,
    handle: Arc<SoundEffectHandle>,
    // 音频线程私有的设置快照
    settings: SoundEffectSettings,
    // 变调变速处理器
    pitch: pitch::PitchRateProcessor,
    // 各效果机架
    channel_rack: channel::ChannelRack,
    shaper_rack: shaper::ShaperRack,
    dynamics_rack: dynamics::DynamicsRack,
    modulation_rack: modulation::ModulationRack,
    reverb_rack: reverb::ReverbRack,
    spatial_rack: spatial::SpatialRack,
    // V4A：低/高 shelf
    v4a_low: dsp::Biquad,
    v4a_high: dsp::Biquad,
    // 帧缓冲
    in_frame: Vec<f32>,
    out_frame: Vec<f32>,
    out_idx: usize,
    // 元数据
    channels: u16,
    sample_rate: u32,
    // 非阻塞同步帧计数
    frame_counter: usize,
    // 是否已 prepare（首次 next 时初始化）
    prepared: bool,
}

impl<I> SoundEffectSource<I>
where
    I: Source<Item = f32>,
{
    pub fn new(inner: I, handle: Arc<SoundEffectHandle>) -> Self {
        let channels = inner.channels();
        let sample_rate = inner.sample_rate();
        // 加载初始设置快照（构造发生在非音频线程，lock() 安全）
        let settings = handle
            .settings
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default();
        // 清除 dirty（本次 new 已应用当前设置，避免首次 sync 重复 apply）
        handle.dirty.store(false, Ordering::Release);
        let mut src = Self {
            inner,
            handle,
            settings: settings.clone(),
            pitch: pitch::PitchRateProcessor::new(channels, sample_rate),
            channel_rack: channel::ChannelRack::new(),
            shaper_rack: shaper::ShaperRack::new(),
            dynamics_rack: dynamics::DynamicsRack::new(),
            modulation_rack: modulation::ModulationRack::new(),
            reverb_rack: reverb::ReverbRack::new(),
            spatial_rack: spatial::SpatialRack::new(),
            v4a_low: dsp::Biquad::new(2),
            v4a_high: dsp::Biquad::new(2),
            in_frame: Vec::new(),
            out_frame: Vec::new(),
            out_idx: 0,
            channels,
            sample_rate,
            frame_counter: 0,
            prepared: false,
        };
        src.prepare_all();
        src.apply_params(&settings);
        src
    }

    fn prepare_all(&mut self) {
        let sr = self.sample_rate as f32;
        let ch = self.channels as usize;
        self.pitch.prepare(sr, ch);
        self.channel_rack.prepare(sr, ch);
        self.shaper_rack.prepare(sr, ch);
        self.dynamics_rack.prepare(sr, ch);
        self.modulation_rack.prepare(sr, ch);
        self.reverb_rack.prepare(sr, ch);
        self.spatial_rack.prepare(sr, ch);
        self.v4a_low.resize_channels(ch);
        self.v4a_high.resize_channels(ch);
        self.in_frame.resize(ch.max(1), 0.0);
        self.out_frame.resize(ch.max(1), 0.0);
        // 标记缓存已耗尽，迫使下一次 next() 直接从 inner 填充新帧，
        // 避免返回 resize 初始化的零值（会导致开头数样本静音）。
        self.out_idx = self.out_frame.len();
        self.prepared = true;
    }

    fn apply_params(&mut self, s: &SoundEffectSettings) {
        // V4A 组合音效：启用时合并子效果参数（匹配 YinDongMusic setV4A 实现）
        // YinDongMusic: bassBoost(true,6,true) + dynamicEq(true) + stereoWiden(true,1.4) + compressor(true,-20,4,3,100)
        // 用 max 语义：用户已手动调高某参数时不覆盖，未启用则强制 V4A 参数
        let effective = if s.v4a_enabled {
            // 对齐 YinDongMusic setV4A：
            // vocalRemoval(false) + bassBoost(true,6,true) + dynamicEq(true)
            // + stereoWiden(true,1.4) + compressor(true,-20,4,3ms,100ms)
            let mut e = s.clone();
            e.vocal_removal = false; // V4A 不消人声
            e.bass_boost.enabled = true;
            e.bass_boost.gain = e.bass_boost.gain.max(6.0);
            e.bass_boost.dynamic = true;
            e.dynamic_eq.enabled = true;
            e.stereo_widen.enabled = true;
            e.stereo_widen.amount = e.stereo_widen.amount.max(1.4);
            e.compressor.enabled = true;
            e.compressor.threshold = e.compressor.threshold.min(-20.0);
            e.compressor.ratio = e.compressor.ratio.max(4.0);
            e.compressor.attack = e.compressor.attack.min(3.0);
            e.compressor.release = e.compressor.release.max(100.0);
            e
        } else {
            s.clone()
        };
        // 关键：把 effective 存入 self.settings，使 process() 中读到的 s 是 V4A 合并后的参数
        // （process 各机架从 s 读取 enabled/dynamic 等运行时标志，不仅依赖 update_params 设的系数）
        self.settings = effective.clone();
        self.pitch.update_params(&effective);
        self.channel_rack.update_params(&effective);
        self.shaper_rack.update_params(&effective);
        self.dynamics_rack.update_params(&effective);
        self.modulation_rack.update_params(&effective);
        self.reverb_rack.update_params(&effective);
        self.spatial_rack.update_params(&effective);
        // V4A 不再单独做 shelving（由 channel_rack 的 bass/dynEq + dynamics_rack 的 compressor 实现）
        // v4a_low/v4a_high 保留为 passthrough 避免影响音质
        self.v4a_low.set_passthrough_inline();
        self.v4a_high.set_passthrough_inline();
    }

    fn reset_all(&mut self) {
        self.pitch.reset();
        self.channel_rack.reset();
        self.shaper_rack.reset();
        self.dynamics_rack.reset();
        self.modulation_rack.reset();
        self.reverb_rack.reset();
        self.spatial_rack.reset();
        self.v4a_low.reset();
        self.v4a_high.reset();
        self.out_frame.fill(0.0);
        self.out_idx = 0;
    }

    /// 非阻塞检查参数变更并同步（每 64 帧调用一次）。
    /// 先读 dirty 原子（无锁快速路径）：false 直接返回；true 时 try_lock 非阻塞克隆快照。
    /// try_lock 失败（UI 线程持锁）时保留 dirty=true，下个 64 帧重试，绝不阻塞音频线程。
    fn sync_settings(&mut self) {
        self.frame_counter += 1;
        if self.frame_counter < 64 {
            return;
        }
        self.frame_counter = 0;
        // 原子读 dirty，无锁快速路径
        if !self.handle.dirty.load(Ordering::Acquire) {
            return; // UI 线程未更新
        }
        // try_lock 在 match 子作用域内完成克隆，确保 MutexGuard 借用（&self.handle.settings）
        // 在 match 结束时释放，之后才能调 apply_params(&mut self)。若用 if let，try_lock()
        // 返回的 Result 临时值会存活到块尾，导致 apply_params 的 &mut self 借用冲突。
        let snapshot = match self.handle.settings.try_lock() {
            Ok(s) => {
                // 成功读取后才清 dirty（避免丢失未读更新）
                self.handle.dirty.store(false, Ordering::Release);
                s.clone()
            }
            Err(_) => return, // try_lock 失败，保留 dirty=true，下个 64 帧重试
        };
        self.settings = snapshot.clone();
        self.apply_params(&snapshot);
    }
}

impl<I> Iterator for SoundEffectSource<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        // 若 out_frame 还有未消费样本，直接返回
        if self.out_idx < self.out_frame.len() {
            let s = self.out_frame[self.out_idx];
            self.out_idx += 1;
            return Some(s);
        }

        // 检测 inner 元数据变化（换轨时采样率/声道数可能变）
        let cur_rate = self.inner.sample_rate();
        let cur_ch = self.inner.channels();
        if cur_rate != self.sample_rate || cur_ch != self.channels || !self.prepared {
            self.sample_rate = cur_rate;
            self.channels = cur_ch;
            self.prepare_all();
            let s = self.settings.clone();
            self.apply_params(&s);
        }

        // 同步参数
        self.sync_settings();

        let hard_bypass = self.settings.should_hard_bypass();
        if hard_bypass {
            // 真正的硬旁路：没有任何音效启用时，不进入 PitchRateProcessor、各 DSP 机架
            // 或 audioBoost，避免默认/残留参数改变本地播放波形。
            let ch = self.channels as usize;
            for i in 0..ch.min(self.out_frame.len()) {
                self.out_frame[i] = self.inner.next()?;
            }
            self.out_idx = 0;

            if self.out_idx < self.out_frame.len() {
                let s = self.out_frame[self.out_idx];
                self.out_idx += 1;
                return Some(s);
            }
            return None;
        }

        // 从 pitch 处理器填充一帧（变调变速后）。只有存在真实音效/变调/变速时才进入，
        // 中性状态下由上面的硬旁路直接读取 inner，保证零处理直通。
        if !self.pitch.fill(&mut self.inner, &mut self.in_frame) {
            return None;
        }

        // 处理效果链
        let ch = self.channels;
        let s = &self.settings;
        // 复制 in_frame → out_frame
        self.out_frame.copy_from_slice(&self.in_frame);
        self.out_idx = 0;

        // V4A 子效果已在 apply_params 中合并到 effective settings，由各机架处理
        // （bass_boost/dynamic_eq/stereo_widen → channel_rack，compressor → dynamics_rack）
        self.channel_rack.process(&mut self.out_frame, ch, s);
        self.shaper_rack.process(&mut self.out_frame, ch, s);
        self.dynamics_rack.process(&mut self.out_frame, ch, s);
        self.modulation_rack.process(&mut self.out_frame, ch, s);
        self.reverb_rack.process(&mut self.out_frame, ch, s);
        self.spatial_rack.process(&mut self.out_frame, ch, s);

        // audioBoost：0-100 → 0~6dB 增益
        let boost_db = (s.audio_boost / 100.0).clamp(0.0, 1.0) * 6.0;
        if boost_db > 0.01 {
            let g = dsp::db_to_gain(boost_db);
            for v in &mut self.out_frame {
                *v = dsp::soft_clip(*v * g);
            }
        }

        if self.out_idx < self.out_frame.len() {
            let s = self.out_frame[self.out_idx];
            self.out_idx += 1;
            Some(s)
        } else {
            None
        }
    }
}

impl<I> Source for SoundEffectSource<I>
where
    I: Source<Item = f32>,
{
    #[inline]
    fn channels(&self) -> u16 {
        self.channels
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        if self.settings.should_hard_bypass() {
            return self.sample_rate;
        }
        // 变速变调（preservesPitch=false）时由 pitch 处理器调整
        self.pitch.effective_sample_rate(self.sample_rate)
    }

    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)?;
        self.reset_all();
        Ok(())
    }
}

// =========================================================================
// dsp 扩展：Biquad 直通设置（供 V4A 使用）
// =========================================================================

impl dsp::Biquad {
    /// 设置为纯直通（增益 0）
    pub fn set_passthrough_inline(&mut self) {
        self.b0 = 1.0;
        self.b1 = 0.0;
        self.b2 = 0.0;
        self.a1 = 0.0;
        self.a2 = 0.0;
        self.passthrough = true;
    }
}

// =========================================================================
// 单元测试
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serde_camel_case_enums() {
        let json = r#"{
            "pitchShift": 100, "playbackRate": 100, "preservesPitch": true,
            "reverbKind": "convolution", "reverbPreset": "church",
            "reverbDry": 0.8, "reverbWet": 0.3,
            "spatialMode": "d8", "spatialSpeed": 10, "spatialRadius": 1,
            "spatialIntensity": 5, "virtualSurroundMode": "7.1", "virtualSurroundSpread": 10,
            "vibrato": {"enabled": true, "rate": 5, "depth": 3},
            "pitchDrift": {"enabled": true, "rate": 1, "depth": 2},
            "tremolo": {"enabled": false, "rate": 6, "depth": 50},
            "flanger": {"enabled": false, "rate": 0.5, "depth": 5, "feedback": 40, "mix": 50},
            "phaser": {"enabled": false, "rate": 0.5, "depth": 1, "feedback": 30, "mix": 50},
            "delay": {"enabled": false, "timeMs": 250, "feedback": 30, "mix": 30, "delayType": "pingpong"},
            "compressor": {"enabled": false, "threshold": -20, "ratio": 4, "attack": 3, "release": 250},
            "multiband": {"enabled": false, "lowFreq": 200, "midFreq": 2000, "threshold": -20, "ratio": 3},
            "limiter": {"enabled": false, "threshold": -1},
            "noiseGate": {"enabled": false, "threshold": -60, "attack": 5, "release": 50},
            "expander": {"enabled": false, "threshold": -40, "ratio": 2},
            "agc": {"enabled": false, "targetLevel": 50},
            "deEsser": {"enabled": false, "threshold": -20, "frequency": 6000},
            "distortion": {"enabled": false, "amount": 50, "distortionType": "soft"},
            "exciter": {"enabled": false, "amount": 50, "frequency": 4000},
            "subBass": {"enabled": false, "amount": 50, "frequency": 80},
            "loFi": {"enabled": false, "sampleRate": 8000, "bitDepth": 8, "noise": 20},
            "bitcrush": {"enabled": false, "bits": 8},
            "vocalRemoval": false,
            "stereoWiden": {"enabled": false, "amount": 50},
            "monoMerge": false, "channelSwap": false,
            "stereoSeparation": {"enabled": false, "width": 100, "centerLevel": 100},
            "crossfeed": {"enabled": false, "strength": 50},
            "bassBoost": {"enabled": false, "gain": 6, "dynamic": true},
            "dynamicEq": {"enabled": false},
            "v4aEnabled": false, "bypass": false, "audioBoost": 0
        }"#;
        let s: SoundEffectSettings = serde_json::from_str(json).unwrap();
        assert_eq!(s.reverb_kind, ReverbKind::Convolution);
        assert_eq!(s.reverb_preset, "church");
        assert_eq!(s.spatial_mode, SpatialMode::D8);
        assert_eq!(s.virtual_surround_mode, VirtualSurroundMode::SevenOne);
        assert_eq!(s.delay.delay_type, DelayType::Pingpong);
        assert_eq!(s.distortion.distortion_type, DistortionType::Soft);
        assert!(s.preserves_pitch);
        assert_eq!(s.pitch_shift, 100.0);
        // pitchDrift 的 rate 别名应映射到 speed
        assert_eq!(s.pitch_drift.speed, 1.0);
        assert!(s.pitch_drift.enabled);
    }

    #[test]
    fn test_default_settings_passthrough() {
        let s = SoundEffectSettings::default();
        assert_eq!(s.reverb_kind, ReverbKind::None);
        assert_eq!(s.spatial_mode, SpatialMode::None);
        assert!(!s.preserves_pitch);
        // 默认必须为 100（原调原速），0 会导致 pitch 处理器进入极端变调变速 → 破音/静音
        assert_eq!(s.pitch_shift, 100.0);
        assert_eq!(s.playback_rate, 100.0);
    }

    #[test]
    fn test_handle_mutex_sync() {
        // Mutex + dirty 同步：set_settings 后 lock() 应读到新值，dirty=true
        let h = SoundEffectHandle::new(SoundEffectSettings::default());
        assert!(!h.dirty.load(Ordering::Acquire));
        assert_eq!(h.settings.lock().unwrap().audio_boost, 0.0);
        let mut s = SoundEffectSettings::default();
        s.audio_boost = 50.0;
        h.set_settings(s);
        assert!(
            h.dirty.load(Ordering::Acquire),
            "set_settings 后 dirty 应为 true"
        );
        assert_eq!(h.settings.lock().unwrap().audio_boost, 50.0);
    }

    /// 端到端直通测试：默认设置下 SoundEffectSource 必须无损透传输入样本。
    /// 这是「播放无声音」问题的回归防线——默认 pitch_shift=100/playback_rate=100，
    /// 所有效果 disabled，整个处理链应等价于直通。
    #[test]
    fn test_default_passthrough_e2e() {
        use rodio::Source;
        use std::time::Duration;

        /// 简单测试源：立体声，输出已知的交替非零样本
        struct TestSource {
            pos: usize,
            channels: u16,
            sample_rate: u32,
        }
        impl Iterator for TestSource {
            type Item = f32;
            fn next(&mut self) -> Option<f32> {
                let v = if self.pos % 2 == 0 { 0.5 } else { -0.3 };
                self.pos += 1;
                Some(v)
            }
        }
        impl Source for TestSource {
            fn channels(&self) -> u16 {
                self.channels
            }
            fn sample_rate(&self) -> u32 {
                self.sample_rate
            }
            fn current_frame_len(&self) -> Option<usize> {
                None
            }
            fn total_duration(&self) -> Option<Duration> {
                None
            }
            fn try_seek(&mut self, _pos: Duration) -> Result<(), SeekError> {
                Ok(())
            }
        }

        let inner = TestSource {
            pos: 0,
            channels: 2,
            sample_rate: 44100,
        };
        let handle = Arc::new(SoundEffectHandle::new(SoundEffectSettings::default()));
        let mut src = SoundEffectSource::new(inner, handle);

        // 读取若干帧，验证输出非零且与输入一致（直通）
        let mut nonzero = 0;
        let mut total = 0;
        for _ in 0..200 {
            if let Some(s) = src.next() {
                total += 1;
                if s.abs() > 1e-6 {
                    nonzero += 1;
                }
                // 直通时输出应为 0.5 或 -0.3
                assert!(
                    (s - 0.5).abs() < 1e-3 || (s - (-0.3)).abs() < 1e-3,
                    "passthrough 期望输出 ±输入值，实际得到 {s}"
                );
            }
        }
        assert!(total > 100, "应产出样本，实际 {total}");
        assert!(
            nonzero > 100,
            "默认直通不应静音，非零样本 {nonzero}/{total}"
        );
    }

    #[test]
    fn test_legacy_audio_boost_without_effects_is_bypassed() {
        use rodio::Source;
        use std::time::Duration;

        struct TestSource {
            samples: Vec<f32>,
            pos: usize,
        }
        impl Iterator for TestSource {
            type Item = f32;
            fn next(&mut self) -> Option<f32> {
                let sample = self.samples[self.pos % self.samples.len()];
                self.pos += 1;
                Some(sample)
            }
        }
        impl Source for TestSource {
            fn channels(&self) -> u16 {
                2
            }
            fn sample_rate(&self) -> u32 {
                44100
            }
            fn current_frame_len(&self) -> Option<usize> {
                None
            }
            fn total_duration(&self) -> Option<Duration> {
                None
            }
            fn try_seek(&mut self, _pos: Duration) -> Result<(), SeekError> {
                Ok(())
            }
        }

        let mut settings = SoundEffectSettings::default();
        settings.audio_boost = 60.0;
        let inner = TestSource {
            samples: vec![0.8, -0.8, 0.25, -0.25],
            pos: 0,
        };
        let handle = Arc::new(SoundEffectHandle::new(settings));
        let mut src = SoundEffectSource::new(inner, handle);

        for expected in [0.8, -0.8, 0.25, -0.25].into_iter().cycle().take(64) {
            let actual = src.next().expect("应持续产出样本");
            assert!(
                (actual - expected).abs() < 1e-6,
                "未启用音效时旧 audioBoost 残留不应改变样本，expected={expected}, actual={actual}"
            );
        }
    }
}
