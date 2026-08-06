import { tauriInvoke } from './invoke';
import type {
  AudioDevice,
  AudioOutputStatus,
  BitstreamInfo,
  EffectParams,
  PlayAudioOptions,
  SeekAudioOptions,
  UpdatePlaybackMetadataOptions,
} from './contracts';

// [YinDong 播放引擎移植] 双路径播放 API：
// - 默认（共享模式）：前端 HTML <audio> + Web Audio，无需 Rust 播放命令
// - WASAPI 独占模式：Rust rodio + set_audio_effects
// 本模块仅暴露 WASAPI 独占路径所需的 Rust 命令 + 设备管理 + URL 代理 + 统计。
// HTML <audio> 路径的播放/暂停/seek/音量由 playerPlayback.ts 直接操作 networkAudio 元素。
export const playbackApi = {
  // ===== WASAPI 独占路径播放控制 =====
  playAudio: (options: PlayAudioOptions): Promise<void> => tauriInvoke('play_audio', options),
  pauseAudio: (): Promise<void> => tauriInvoke('pause_audio'),
  resumeAudio: (): Promise<void> => tauriInvoke('resume_audio'),
  seekAudio: (options: SeekAudioOptions): Promise<void> => tauriInvoke('seek_audio', options),
  setVolume: (volume: number): Promise<void> => tauriInvoke('set_volume', { volume }),
  getPlaybackProgress: (): Promise<number> => tauriInvoke('get_playback_progress'),
  updatePlaybackMetadata: (options: UpdatePlaybackMetadataOptions): Promise<void> =>
    tauriInvoke('update_playback_metadata', options),

  // ===== 频谱可视化（WASAPI 独占模式回退用；HTML 路径用 soundEffectEngine.getAnalyser） =====
  getAudioVisualizerSamples: (): Promise<number[]> =>
    tauriInvoke('get_audio_visualizer_samples'),

  // ===== 统计（XY 保留 countAsPlay 字段） =====
  recordPlay: (payload: {
    songPath: string;
    listenedMs: number;
    durationMs: number;
    title: string;
    artist: string;
    album: string;
    trackNumber?: string;
    countAsPlay: boolean;
  }) =>
    tauriInvoke('record_play', { payload }),

  // ===== 输出设备管理 =====
  setAudioOutputMode: (outputMode: PlayAudioOptions['outputMode']): Promise<void> =>
    tauriInvoke('set_audio_output_mode', { outputMode }),
  setOutputDevice: (deviceId: string | null) =>
    tauriInvoke('set_output_device', { deviceId }),
  getOutputDevices: (): Promise<AudioDevice[]> => tauriInvoke('get_output_devices'),
  getCurrentOutputDevice: (): Promise<AudioOutputStatus> =>
    tauriInvoke('get_current_output_device'),

  // ===== HTML <audio> 路径 URL 代理（注入 CORS 头，使 createMediaElementSource 可处理跨域音频） =====
  getProxiedAudioUrl: (url: string): Promise<string> =>
    tauriInvoke('get_proxied_audio_url', { url }),
  getLocalAudioUrl: (path: string): Promise<string> =>
    tauriInvoke('get_local_audio_url', { path }),

  // ===== USB 独占模式（WASAPI 独占） =====
  // USB DAC 设备枚举
  getUsbDacDevices: (): Promise<AudioDevice[]> => tauriInvoke('get_usb_dac_devices'),
  // 启用 USB 独占模式（设置输出设备 + 切换为 WASAPI 独占）
  enableUsbExclusiveMode: (deviceId: string | null): Promise<void> =>
    tauriInvoke('enable_usb_exclusive_mode', { deviceId }),
  // 禁用 USB 独占模式（回退到共享模式）
  disableUsbExclusiveMode: (): Promise<void> => tauriInvoke('disable_usb_exclusive_mode'),
  // 设置音效参数（EQ/混响/环绕/变调，仅 WASAPI 独占路径）
  setAudioEffects: (params: EffectParams): Promise<void> =>
    tauriInvoke('set_audio_effects', { params }),
  // 获取当前位流信息（采样率/位深/设备名/位完美指示）
  getBitstreamInfo: (): Promise<BitstreamInfo> => tauriInvoke('get_bitstream_info'),
};
