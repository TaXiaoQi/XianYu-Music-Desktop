import type { AudioOutputMode } from '../../types';

export interface AudioDevice {
  id: string;
  name: string;
}

export interface SystemInfoPayload {
  device_brand: string;
  device_model: string;
  os_version: string;
  architecture: string;
  machine_name: string;
}

export interface AudioDeviceFormat {
  sample_format: string;
  min_sample_rate: number;
  max_sample_rate: number;
  channels: number;
}

export interface AudioDeviceFormats {
  id: string;
  name: string;
  formats: AudioDeviceFormat[];
}

export interface AudioOutputStatus {
  selected_device_id: string | null;
  active_device_name: string | null;
  follows_system_default: boolean;
  requested_output_mode: AudioOutputMode;
  active_output_mode: AudioOutputMode;
  fallback_reason: string | null;
}


export interface PlayAudioOptions {
  path: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  outputMode: AudioOutputMode;
  startOffsetMs?: number;
  songId?: number | null;
  volumeBalanceEnabled?: boolean | null;
  gainOffsetDb?: number | null;
  preventClipping?: boolean | null;
  headers?: Record<string, string> | null;
  ekey?: string;
  cek?: string;
  dsdNativePassthrough?: boolean;
  outputBitPerfect?: boolean;
}

export interface PrefetchAudioHeadOptions {
  url: string;
  headers?: Record<string, string> | null;
  maxBytes?: number;
}

export interface UpdateLoudnessSettingsOptions {
  enabled: boolean;
  songId?: number | null;
  songPath?: string | null;
  gainOffsetDb: number;
  preventClipping: boolean;
}

export interface UpdatePlaybackMetadataOptions {
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  isPlaying: boolean;
}

export interface SeekAudioOptions {
  time: number;
  isPlaying: boolean;
  requestId: number;
}

// ===== DLNA 双向投屏（字段与 Rust dlna/types.rs serde 默认命名一致）=====
export interface DlnaDevicePayload {
  udn: string;
  friendly_name: string;
  model_name: string;
  location: string;
  base_url: string;
  avt_control_url: string | null;
  rcs_control_url: string | null;
}

export type DlnaMediaPayload =
  | { kind: 'local'; path: string }
  | { kind: 'remote'; url: string; headers?: Record<string, string>; resolved_at_ms?: number }
  | { kind: 'cover'; url: string; headers?: Record<string, string> }
  | { kind: 'lyric'; text: string };

export interface DlnaCastMediaInfo {
  media_token: string;
  media_url: string;
  cover_token?: string;
  cover_url?: string;
}

export interface DlnaCastTransportState {
  position_secs: number;
  duration_secs: number;
  state: string;
}

export interface DlnaRendererStatus {
  running: boolean;
  friendly_name: string;
  port: number;
}

// ===== 控制通道（桌面 TCP 遥控，与 Rust control_channel/commands.rs 对齐，serde camelCase）=====

export interface ControlChannelDeviceEntry {
  token: string;
  deviceName: string;
  pairedAt: number;
}

export interface ControlChannelClientEntry {
  id: number;
  name: string;
}

export interface ControlChannelStatus {
  running: boolean;
  port: number;
  lanIp: string;
  enabled: boolean;
  desktopName: string;
  pairingCode: string;
  pairingExpiresIn: number;
  devices: ControlChannelDeviceEntry[];
  connected: ControlChannelClientEntry[];
}

export interface ControlPairingCodeInfo {
  pairingCode: string;
  expiresIn: number;
}

// ===== 音效参数（与 Rust src-tauri/src/player/sound_effect.rs 的 SoundEffectSettings 一一对应）=====

export type ReverbKind = 'none' | 'algorithmic' | 'convolution';
export type SpatialMode = 'none' | 'surround3d' | 'd8' | 'd36' | 'virtual';
export type DistortionType = 'soft' | 'hard';
export type DelayType = 'single' | 'pingpong';
export type VirtualSurroundMode = '5.1' | '7.1';

export interface ModulationParams {
  enabled: boolean;
  rate: number;
  depth: number;
}
export interface FlangerParams {
  enabled: boolean;
  rate: number;
  depth: number;
  feedback: number;
  mix: number;
}
export interface PhaserParams {
  enabled: boolean;
  rate: number;
  depth: number;
  feedback: number;
  mix: number;
}
export interface DelayParams {
  enabled: boolean;
  timeMs: number;
  feedback: number;
  mix: number;
  delayType: DelayType;
}
export interface CompressorParams {
  enabled: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
}
export interface MultibandParams {
  enabled: boolean;
  lowFreq: number;
  midFreq: number;
  threshold: number;
  ratio: number;
}
export interface LimiterParams {
  enabled: boolean;
  threshold: number;
}
export interface NoiseGateParams {
  enabled: boolean;
  threshold: number;
  attack: number;
  release: number;
}
export interface ExpanderParams {
  enabled: boolean;
  threshold: number;
  ratio: number;
}
export interface AgcParams {
  enabled: boolean;
  targetLevel: number;
}
export interface DeEsserParams {
  enabled: boolean;
  threshold: number;
  frequency: number;
}
export interface DistortionParams {
  enabled: boolean;
  amount: number;
  distortionType: DistortionType;
}
export interface ExciterParams {
  enabled: boolean;
  amount: number;
  frequency: number;
}
export interface SubBassParams {
  enabled: boolean;
  amount: number;
  frequency: number;
}
export interface LoFiParams {
  enabled: boolean;
  sampleRate: number;
  bitDepth: number;
  noise: number;
}
export interface BitcrushParams {
  enabled: boolean;
  bits: number;
}
export interface StereoWidenParams {
  enabled: boolean;
  amount: number;
}
export interface StereoSepParams {
  enabled: boolean;
  width: number;
  centerLevel: number;
}
export interface CrossfeedParams {
  enabled: boolean;
  strength: number;
}
export interface BassBoostParams {
  enabled: boolean;
  gain: number;
  dynamic: boolean;
}
export interface DynamicEqParams {
  enabled: boolean;
}

export interface SoundEffectSettings {
  pitchShift: number;
  playbackRate: number;
  preservesPitch: boolean;
  reverbKind: ReverbKind;
  reverbPreset: string;
  reverbDry: number;
  reverbWet: number;
  spatialMode: SpatialMode;
  spatialSpeed: number;
  spatialRadius: number;
  spatialIntensity: number;
  virtualSurroundMode: VirtualSurroundMode;
  virtualSurroundSpread: number;
  vibrato: ModulationParams;
  pitchDrift: ModulationParams;
  tremolo: ModulationParams;
  flanger: FlangerParams;
  phaser: PhaserParams;
  delay: DelayParams;
  compressor: CompressorParams;
  multiband: MultibandParams;
  limiter: LimiterParams;
  noiseGate: NoiseGateParams;
  expander: ExpanderParams;
  agc: AgcParams;
  deEsser: DeEsserParams;
  distortion: DistortionParams;
  exciter: ExciterParams;
  subBass: SubBassParams;
  loFi: LoFiParams;
  bitcrush: BitcrushParams;
  vocalRemoval: boolean;
  stereoWiden: StereoWidenParams;
  monoMerge: boolean;
  channelSwap: boolean;
  stereoSeparation: StereoSepParams;
  crossfeed: CrossfeedParams;
  bassBoost: BassBoostParams;
  dynamicEq: DynamicEqParams;
  v4aEnabled: boolean;
  bypass: boolean;
  audioBoost: number;
}
