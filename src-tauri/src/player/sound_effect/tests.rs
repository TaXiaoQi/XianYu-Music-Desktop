//! SoundEffectSettings 序列化与回退路径测试。

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
