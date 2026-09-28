import { emitTo, listen } from '@tauri-apps/api/event';
import { nextTick, reactive } from 'vue';

import type { Song } from '../../../types';
import {
  MINI_PLAYER_STATE_APPLIED_EVENT,
  MINI_PLAYER_STATE_EVENT,
  type MiniPlayerStatePayload,
} from '../../../features/miniPlayer/shared';
import {
  sessionApi,
  type PlaybackQueueMetaChangedPayload,
  type PlaybackSessionChangedPayload,
} from '../../../services/tauri/sessionApi';
import type { WindowMaterialMode } from '../../../composables/windowMaterial';

export interface MiniPlayerFeedOptions {
  isScrubbing: () => boolean;
  onSnapshotApplied?: () => void;
}

export function useMiniPlayerFeed(options: MiniPlayerFeedOptions) {
  const snapshot = reactive({
    track: null as Song | null,
    coverUrl: '',
    playing: false,
    dark: false,
    volume: 100,
    queue: [] as Song[],
    lyric: '',
    material: 'none' as WindowMaterialMode,
    blurTint: 50,
    position: 0,
    length: 0,
    favorite: false,
    loopMode: 0,
    lyricsOn: false,
  });

  let queueMetaCache: Record<string, Song> = {};
  const stopFns: Array<() => void> = [];

  const absorbSnapshot = (incoming: MiniPlayerStatePayload) => {
    snapshot.track = incoming.currentSong;
    snapshot.coverUrl = incoming.coverUrl;
    snapshot.playing = incoming.isPlaying;
    snapshot.dark = incoming.isDarkTheme;
    snapshot.volume = incoming.volume;
    snapshot.queue = incoming.queue;
    snapshot.lyric = incoming.lyricText;
    snapshot.material = incoming.windowMaterial;
    snapshot.blurTint = incoming.windowBlurTint;
    if (!options.isScrubbing()) {
      snapshot.position = incoming.currentTime;
    }
    snapshot.length = incoming.duration;
    snapshot.favorite = incoming.isFavorite;
    snapshot.loopMode = incoming.playMode;
    snapshot.lyricsOn = incoming.desktopLyricsEnabled;
  };

  const start = async () => {
    stopFns.push(await listen<MiniPlayerStatePayload>(MINI_PLAYER_STATE_EVENT, (event) => {
      absorbSnapshot(event.payload);
      void nextTick(() => emitTo('main', MINI_PLAYER_STATE_APPLIED_EVENT));
      options.onSnapshotApplied?.();
    }));
  };

  const prefill = async () => {
    try {
      const session = await sessionApi.getPlaybackSession();
      if (!session || !session.currentSongPath) return;

      snapshot.playing = session.isPlaying;
      snapshot.volume = session.volume;
      snapshot.loopMode = session.playMode;
      if (!options.isScrubbing()) {
        snapshot.position = session.currentPositionSecs;
      }

      const meta = session.queueSongMeta?.[session.currentSongPath];
      if (meta) {
        snapshot.track = meta;
        snapshot.length = meta.duration ?? 0;
      }
      queueMetaCache = session.queueSongMeta ?? {};
    } catch { /* 预填失败不影响后续状态推送 */ }
  };

  const startSessionSync = async () => {
    stopFns.push(await listen<PlaybackSessionChangedPayload>('playback:session-changed', (event) => {
      const data = event.payload;
      snapshot.playing = data.isPlaying;
      snapshot.volume = data.volume;
      snapshot.loopMode = data.playMode;
      if (!options.isScrubbing()) {
        snapshot.position = data.currentPositionSecs;
      }
      if (!snapshot.track && data.currentSongPath) {
        const meta = queueMetaCache[data.currentSongPath];
        if (meta) {
          snapshot.track = meta;
          snapshot.length = meta.duration ?? 0;
        }
      }
    }));

    stopFns.push(await listen<PlaybackQueueMetaChangedPayload>('playback:queue-meta-changed', (event) => {
      queueMetaCache = event.payload;
    }));
  };

  const stop = () => {
    stopFns.splice(0).forEach((off) => off());
  };

  return { snapshot, start, prefill, startSessionSync, stop };
}
