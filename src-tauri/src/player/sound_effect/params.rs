//! 音效参数类型定义：所有效果的序列化参数结构与默认值。

use serde::{Deserialize, Serialize};

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
// =========================================================================

fn default_pitch_rate() -> f32 {
  100.0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SoundEffectSettings {
  #[serde(default = "default_pitch_rate")]
  pub pitch_shift: f32,
  #[serde(default = "default_pitch_rate")]
  pub playback_rate: f32,
  #[serde(default)]
  pub preserves_pitch: bool,
  pub reverb_kind: ReverbKind,
  pub reverb_preset: String,
  pub reverb_dry: f32,
  pub reverb_wet: f32,
  pub spatial_mode: SpatialMode,
  pub spatial_speed: f32,
  pub spatial_radius: f32,
  pub spatial_intensity: f32,
  pub virtual_surround_mode: VirtualSurroundMode,
  pub virtual_surround_spread: f32,
  pub vibrato: ModulationParams,
  pub pitch_drift: PitchDriftParams,
  pub tremolo: ModulationParams,
  pub flanger: FlangerParams,
  pub phaser: PhaserParams,
  pub delay: DelayParams,
  pub compressor: CompressorParams,
  pub multiband: MultibandParams,
  pub limiter: LimiterParams,
  pub noise_gate: NoiseGateParams,
  pub expander: ExpanderParams,
  pub agc: AgcParams,
  pub de_esser: DeEsserParams,
  pub distortion: DistortionParams,
  pub exciter: ExciterParams,
  pub sub_bass: SubBassParams,
  pub lo_fi: LoFiParams,
  pub bitcrush: BitcrushParams,
  pub vocal_removal: bool,
  pub stereo_widen: StereoWidenParams,
  pub mono_merge: bool,
  pub channel_swap: bool,
  pub stereo_separation: StereoSepParams,
  pub crossfeed: CrossfeedParams,
  pub bass_boost: BassBoostParams,
  pub dynamic_eq: DynamicEqParams,
  pub v4a_enabled: bool,
  pub bypass: bool,
  pub audio_boost: f32,
}

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
  pub(super) fn should_hard_bypass(&self) -> bool {
    self.bypass || !self.has_audible_processing()
  }
}
