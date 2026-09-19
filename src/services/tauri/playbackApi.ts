import { tauriInvoke } from './invoke';
import type {
  AudioDevice,
  AudioDeviceFormats,
  AudioOutputStatus,
  PlayAudioOptions,
  PrefetchAudioHeadOptions,
  SeekAudioOptions,
  SoundEffectSettings,
  UpdateLoudnessSettingsOptions,
  UpdatePlaybackMetadataOptions,
  LoudnessRecord,
} from './contracts';
import { useConcurrentScheduler } from '../../composables/useConcurrentScheduler';

export function createEqualizerSignature(enabled: boolean, preamp: number, gains: number[]): string {
  const gainsStr = gains.map(g => g.toFixed(1)).join(',');
  return `${enabled}:${preamp.toFixed(1)}:[${gainsStr}]`;
}

const eqScheduler = useConcurrentScheduler();
let lastSyncedParams: string | null = null;

let throttleTimer: any = null;
let nextRequestArgs: { enabled: boolean, preamp: number, gains: number[] } | null = null;
let lastThrottleTime = 0;

export const playbackApi = {
  setVolume: (volume: number): Promise<void> => tauriInvoke('set_volume', { volume }),
  getPlaybackProgress: (): Promise<number> => tauriInvoke('get_playback_progress'),
  getPlaybackDuration: (): Promise<number> => tauriInvoke('get_playback_duration'),
  getPlaybackReady: (): Promise<boolean> => tauriInvoke('get_playback_ready'),
  getPlaybackStartFailed: (): Promise<boolean> => tauriInvoke('get_playback_start_failed'),
  getPlaybackStartFailedReason: (): Promise<string | null> =>
    tauriInvoke('get_playback_start_failed_reason'),
  getPlaybackStartFailedInfo: (): Promise<{ failed: boolean; reason: string | null }> =>
    tauriInvoke('get_playback_start_failed_info'),
  getAudioVisualizerSamples: (): Promise<number[]> =>
    tauriInvoke('get_audio_visualizer_samples'),
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
  playAudio: (options: PlayAudioOptions): Promise<void> => tauriInvoke('play_audio', options),
  updatePlaybackMetadata: (options: UpdatePlaybackMetadataOptions): Promise<void> =>
    tauriInvoke('update_playback_metadata', options),
  pauseAudio: (): Promise<void> => tauriInvoke('pause_audio'),
  stopAudio: (): Promise<void> => tauriInvoke('stop_audio'),
  resumeAudio: (): Promise<void> => tauriInvoke('resume_audio'),
  seekAudio: (options: SeekAudioOptions): Promise<void> => tauriInvoke('seek_audio', options),
  setAudioOutputMode: (outputMode: PlayAudioOptions['outputMode']): Promise<void> =>
    tauriInvoke('set_audio_output_mode', { outputMode }),
  setOutputDevice: (deviceId: string | null) =>
    tauriInvoke('set_output_device', { deviceId }),
  setPreventSleep: (active: boolean): Promise<void> =>
    tauriInvoke('set_prevent_sleep', { active }),
  getOutputDevices: (): Promise<AudioDevice[]> => tauriInvoke('get_output_devices'),
  getCurrentOutputDevice: (): Promise<AudioOutputStatus> =>
    tauriInvoke('get_current_output_device'),
  getAudioDeviceFormats: (): Promise<AudioDeviceFormats[]> =>
    tauriInvoke('get_audio_device_formats'),
  getTrackLoudnessInfo: (songId: number): Promise<LoudnessRecord | null> =>
    tauriInvoke('get_track_loudness_info', { songId }),
  updateLoudnessSettings: (options: UpdateLoudnessSettingsOptions): Promise<void> =>
    tauriInvoke('update_loudness_settings', options),

  setSoundEffectSettings: (settings: SoundEffectSettings): Promise<void> =>
    tauriInvoke('set_sound_effect_settings', { settings }),

  setStreamCacheMaxSize: (bytes: number): Promise<void> =>
    tauriInvoke('set_stream_cache_max_size', { bytes }),
  getStreamCacheInfo: (): Promise<{ current: number; max: number }> =>
    tauriInvoke('get_stream_cache_info'),
  clearStreamCache: (): Promise<void> => tauriInvoke('clear_stream_cache'),
  setStreamCacheDir: (path: string): Promise<void> =>
    tauriInvoke('set_stream_cache_dir', { path }),
  getStreamCacheDir: (): Promise<string> =>
    tauriInvoke('get_stream_cache_dir'),

  prefetchAudioHead: (options: PrefetchAudioHeadOptions): Promise<boolean> =>
    tauriInvoke('prefetch_audio_head', options),

  getLastSyncedParams: () => lastSyncedParams,

  setEqualizerSettings: (enabled: boolean, preamp: number, gains: number[]): Promise<void> => {
    return eqScheduler.execute(() => {
      return tauriInvoke('set_equalizer_settings', { enabled, preamp, gains })
        .then(() => {
          lastSyncedParams = createEqualizerSignature(enabled, preamp, gains);
        });
    });
  },

  requestEqualizerSettings: (enabled: boolean, preamp: number, gains: number[]) => {
    const now = Date.now();
    nextRequestArgs = { enabled, preamp, gains };

    const executeRequest = () => {
      if (!nextRequestArgs) return;
      const { enabled, preamp, gains } = nextRequestArgs;
      nextRequestArgs = null;
      lastThrottleTime = Date.now();

      playbackApi.setEqualizerSettings(enabled, preamp, gains);
    };

    if (now - lastThrottleTime >= 50) {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      executeRequest();
    } else {
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          executeRequest();
        }, 50 - (now - lastThrottleTime));
      }
    }
  },

  flushEqualizerSettings: (enabled: boolean, preamp: number, gains: number[]): Promise<void> => {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    nextRequestArgs = null;

    return playbackApi.setEqualizerSettings(enabled, preamp, gains);
  }
};
