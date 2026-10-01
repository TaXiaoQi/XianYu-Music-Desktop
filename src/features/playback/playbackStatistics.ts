import {watch, type Ref} from 'vue';
import {listen as tauriListen} from '@tauri-apps/api/event';
import type {AudioOutputStatus} from '../../services/tauri/contracts';
import type {Song} from '../../types';

export interface PlaybackStatisticsDeps {
  volume: Ref<number>;
  isPlaying: Ref<boolean>;
  getCurrentSong: () => Song | null;
  getUser: () => { ciyuanxi_id?: string | number | null; id?: string | number | null } | null | undefined;
  setActiveOutputMode: (mode: AudioOutputStatus['active_output_mode']) => void;
  reportBehavior: (payload: Record<string, unknown>) => void;
  recordPlay: (payload: {
    songPath: string;
    listenedMs: number;
    durationMs: number;
    title: string;
    artist: string;
    album: string;
    trackNumber?: string;
    countAsPlay: boolean;
  }) => Promise<unknown>;
  getTitle: (song: Song) => string;
  getCurrentTime?: () => number;
  listen?: typeof tauriListen;
  getOutputDevice?: () => Promise<AudioOutputStatus>;
}

export interface PlaybackStatisticsController {
  syncValidity: () => void;
  startSession: () => void;
  accumulateForSeek: () => void;
  pauseSession: () => void;
  flush: () => void;
  reset: () => void;
  dispose: () => void;
}

export function createPlaybackStatistics(deps: PlaybackStatisticsDeps): PlaybackStatisticsController {
  const listen = deps.listen ?? tauriListen;
  const getOutputDevice = deps.getOutputDevice;
  let hasAudioOutputDevice = true;
  let lastOutputValid = true;
  let sessionStartTime: number | null = null;
  let accumulatedTime = 0;
  let currentPlayCountRecorded = false;
  let outputUnlisten: (() => void) | null = null;
  const stopVolumeWatch = watch(deps.volume, () => syncValidity());

  function syncValidity() {
    const valid = deps.volume.value >= 1 && hasAudioOutputDevice;
    if (valid === lastOutputValid) return;
    lastOutputValid = valid;
    if (valid) {
      if (deps.isPlaying.value) sessionStartTime = Date.now();
    } else if (deps.isPlaying.value && sessionStartTime) {
      accumulatedTime += (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = null;
    }
  }

  function startSession() {
    sessionStartTime = deps.volume.value >= 1 && hasAudioOutputDevice ? Date.now() : null;
  }

  function accumulateForSeek() {
    if (deps.isPlaying.value && sessionStartTime) {
      accumulatedTime += (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = Date.now();
    }
  }

  function pauseSession() {
    if (deps.isPlaying.value && sessionStartTime) {
      accumulatedTime += (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = null;
    }
  }

  function flush() {
    const song = deps.getCurrentSong();
    if (!song) return;
    if (deps.volume.value < 1 || !hasAudioOutputDevice) {
      sessionStartTime = null;
      return;
    }

    let currentSession = 0;
    if (deps.isPlaying.value && sessionStartTime) {
      currentSession = (Date.now() - sessionStartTime) / 1000;
    }
    const totalDuration = accumulatedTime + currentSession;
    const shouldPersist = totalDuration >= 10 || (currentPlayCountRecorded && totalDuration > 0);
    const user = deps.getUser();
    let source = 'local';
    if (song.path.startsWith('lx://')) source = song.path.slice('lx://'.length).split('/')[0] || 'lx';
    else if (/^https?:\/\//.test(song.path)) source = 'online';
    else if (song.path.startsWith('plugin://')) source = song.path.slice('plugin://'.length).split('/')[0] || 'plugin';

    deps.reportBehavior({
      song_id: song.id != null ? String(song.id) : song.path,
      song_name: song.name,
      singer: song.artist || '',
      song_hash: song.path,
      source,
      action: totalDuration >= 10 ? (currentPlayCountRecorded ? 'switch' : 'play') : 'switch',
      listen_duration: Math.floor(totalDuration),
      play_count: totalDuration >= 10 && !currentPlayCountRecorded ? 1 : 0,
      ciyuanxi_id: user?.ciyuanxi_id,
      user_id: user?.id ? Number(user.id) : undefined,
    });

    if (shouldPersist) {
      const countAsPlay = !currentPlayCountRecorded;
      if (countAsPlay) currentPlayCountRecorded = true;
      deps.recordPlay({
        songPath: song.path,
        listenedMs: Math.floor(totalDuration * 1000),
        durationMs: Math.floor(song.duration * 1000),
        title: deps.getTitle(song),
        artist: song.artist || '',
        album: song.album || '',
        trackNumber: song.track_number,
        countAsPlay,
      }).catch(error => console.warn('record_play failed:', error));
    }

    accumulatedTime = shouldPersist ? 0 : totalDuration;
    sessionStartTime = null;
  }

  listen<AudioOutputStatus>('audio-output-device-changed', (event) => {
    hasAudioOutputDevice = event.payload.active_device_name != null;
    deps.setActiveOutputMode(event.payload.active_output_mode);
    syncValidity();
  }).then(unlisten => { outputUnlisten = unlisten; }).catch(() => {});

  getOutputDevice?.().then(status => {
    hasAudioOutputDevice = status.active_device_name != null;
    deps.setActiveOutputMode(status.active_output_mode);
    syncValidity();
  }).catch(() => {});

  function reset() {
    accumulatedTime = 0;
    sessionStartTime = null;
    currentPlayCountRecorded = false;
  }

  function dispose() {
    stopVolumeWatch();
    outputUnlisten?.();
    outputUnlisten = null;
    reset();
  }

  return {syncValidity, startSession, accumulateForSeek, pauseSession, flush, reset, dispose};
}
