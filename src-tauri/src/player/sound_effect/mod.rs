pub mod channel;
pub mod convolution;
pub mod dsp;
pub mod dynamics;
pub mod modulation;
pub mod phase_vocoder;
pub mod pitch;
pub mod reverb;
pub mod shaper;
pub mod spatial;
pub mod wsola;

use rodio::source::SeekError;
use rodio::Source;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

// =========================================================================
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
    fn should_hard_bypass(&self) -> bool {
        self.bypass || !self.has_audible_processing()
    }
}

// =========================================================================
// =========================================================================

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

    pub fn set_settings(&self, new_settings: SoundEffectSettings) {
        if let Ok(mut s) = self.settings.lock() {
            *s = new_settings;
        }
        self.dirty.store(true, Ordering::Release);
    }
}

// =========================================================================
// =========================================================================

pub struct SoundEffectSource<I> {
    inner: I,
    handle: Arc<SoundEffectHandle>,
    settings: SoundEffectSettings,
    pitch: pitch::PitchRateProcessor,
    channel_rack: channel::ChannelRack,
    shaper_rack: shaper::ShaperRack,
    dynamics_rack: dynamics::DynamicsRack,
    modulation_rack: modulation::ModulationRack,
    reverb_rack: reverb::ReverbRack,
    spatial_rack: spatial::SpatialRack,
    v4a_low: dsp::Biquad,
    v4a_high: dsp::Biquad,
    in_frame: Vec<f32>,
    out_frame: Vec<f32>,
    out_idx: usize,
    channels: u16,
    sample_rate: u32,
    frame_counter: usize,
    prepared: bool,
}

impl<I> SoundEffectSource<I>
where
    I: Source<Item = f32>,
{
    pub fn new(inner: I, handle: Arc<SoundEffectHandle>) -> Self {
        let channels = inner.channels();
        let sample_rate = inner.sample_rate();
        let settings = handle
            .settings
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default();
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
        self.out_idx = self.out_frame.len();
        self.prepared = true;
    }

    fn apply_params(&mut self, s: &SoundEffectSettings) {
        let effective = if s.v4a_enabled {
            let mut e = s.clone();
            e.vocal_removal = false;
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
        self.settings = effective.clone();
        self.pitch.update_params(&effective);
        self.channel_rack.update_params(&effective);
        self.shaper_rack.update_params(&effective);
        self.dynamics_rack.update_params(&effective);
        self.modulation_rack.update_params(&effective);
        self.reverb_rack.update_params(&effective);
        self.spatial_rack.update_params(&effective);
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

    fn sync_settings(&mut self) {
        self.frame_counter += 1;
        if self.frame_counter < 64 {
            return;
        }
        self.frame_counter = 0;
        if !self.handle.dirty.load(Ordering::Acquire) {
            return;
        }
        let snapshot = match self.handle.settings.try_lock() {
            Ok(s) => {
                self.handle.dirty.store(false, Ordering::Release);
                s.clone()
            }
            Err(_) => return,
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
        if self.out_idx < self.out_frame.len() {
            let s = self.out_frame[self.out_idx];
            self.out_idx += 1;
            return Some(s);
        }

        let cur_rate = self.inner.sample_rate();
        let cur_ch = self.inner.channels();
        if cur_rate != self.sample_rate || cur_ch != self.channels || !self.prepared {
            self.sample_rate = cur_rate;
            self.channels = cur_ch;
            self.prepare_all();
            let s = self.settings.clone();
            self.apply_params(&s);
        }

        self.sync_settings();

        let hard_bypass = self.settings.should_hard_bypass();
        if hard_bypass {
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

        if !self.pitch.fill(&mut self.inner, &mut self.in_frame) {
            return None;
        }

        let ch = self.channels;
        let s = &self.settings;
        self.out_frame.copy_from_slice(&self.in_frame);
        self.out_idx = 0;

        self.channel_rack.process(&mut self.out_frame, ch, s);
        self.shaper_rack.process(&mut self.out_frame, ch, s);
        self.dynamics_rack.process(&mut self.out_frame, ch, s);
        self.modulation_rack.process(&mut self.out_frame, ch, s);
        self.reverb_rack.process(&mut self.out_frame, ch, s);
        self.spatial_rack.process(&mut self.out_frame, ch, s);

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
// =========================================================================

impl dsp::Biquad {
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
        assert_eq!(s.pitch_drift.speed, 1.0);
        assert!(s.pitch_drift.enabled);
    }

    #[test]
    fn test_default_settings_passthrough() {
        let s = SoundEffectSettings::default();
        assert_eq!(s.reverb_kind, ReverbKind::None);
        assert_eq!(s.spatial_mode, SpatialMode::None);
        assert!(!s.preserves_pitch);
        assert_eq!(s.pitch_shift, 100.0);
        assert_eq!(s.playback_rate, 100.0);
    }

    #[test]
    fn test_handle_mutex_sync() {
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

    #[test]
    fn test_default_passthrough_e2e() {
        use rodio::Source;
        use std::time::Duration;

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

        let mut nonzero = 0;
        let mut total = 0;
        for _ in 0..200 {
            if let Some(s) = src.next() {
                total += 1;
                if s.abs() > 1e-6 {
                    nonzero += 1;
                }
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
