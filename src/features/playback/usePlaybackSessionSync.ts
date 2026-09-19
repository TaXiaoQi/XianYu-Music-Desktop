
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { watch, type WatchSource } from 'vue';
import { storeToRefs } from 'pinia';
import type { Song } from '../../types';
import { isRemoteSong } from '../../utils/remoteSong';
import { sessionApi, buildSessionData, type PlaybackSessionData, type PlaybackSessionChangedPayload } from '../../services/tauri/sessionApi';
import { usePlaybackStore } from './store';
import { useLibraryStore } from '../library/store';
import { useCollectionsStore } from '../collections/store';

const isMainWindow = (): boolean => {
  try {
    return getCurrentWindow().label === 'main';
  } catch {
    return true;
  }
};

const collectQueueSongMeta = (
  playQueuePaths: string[],
  sourceSongPaths: string[],
  getSongByPath: (path: string) => Song | undefined,
): Record<string, Song> => {
  const meta: Record<string, Song> = {};
  const paths = new Set<string>([...playQueuePaths, ...sourceSongPaths]);
  paths.forEach((path) => {
    if (!path) return;
    const song = getSongByPath(path);
    if (song && isRemoteSong(song)) {
      meta[path] = song;
    }
  });
  return meta;
};

export function usePlaybackSessionSync() {
  const playbackStore = usePlaybackStore();
  const libraryStore = useLibraryStore();
  const collectionsStore = useCollectionsStore();

  const {
    currentSongPath,
    playQueuePaths,
    playMode,
    volume,
    currentTime,
    isPlaying,
    sessionQualityOverride,
  } = storeToRefs(playbackStore);
  const { sourceSongPaths } = storeToRefs(libraryStore);

  let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let positionUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let unlistenSessionChanged: (() => void) | null = null;

  const collectSessionData = (): PlaybackSessionData => {
    return buildSessionData({
      currentSongPath: currentSongPath.value,
      playQueuePaths: playQueuePaths.value,
      sourceSongPaths: sourceSongPaths.value,
      playMode: playMode.value,
      volume: volume.value,
      currentPositionSecs: currentTime.value,
      isPlaying: isPlaying.value,
      sessionQualityOverride: sessionQualityOverride.value,
      queueSongMeta: collectQueueSongMeta(
        playQueuePaths.value,
        sourceSongPaths.value,
        (path: string) => libraryStore.getSongByPath(path)
          ?? collectionsStore.favoriteSongMeta[path]
          ?? collectionsStore.recentSongMeta[path],
      ),
    });
  };

  const scheduleSessionSave = () => {
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer);
    }
    sessionSaveTimer = setTimeout(() => {
      sessionSaveTimer = null;
      const data = collectSessionData();
      sessionApi.savePlaybackSession(data).catch(err => {
        console.warn('[SessionSync] savePlaybackSession failed:', err);
      });
    }, 300);
  };

  const schedulePositionUpdate = () => {
    if (positionUpdateTimer) return;
    positionUpdateTimer = setTimeout(() => {
      positionUpdateTimer = null;
      sessionApi
        .updatePlaybackPosition(currentTime.value, isPlaying.value)
        .catch(err => {
          console.warn('[SessionSync] updatePlaybackPosition failed:', err);
        });
    }, 2000);
  };

  const flushSession = (): Promise<void> => {
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer);
      sessionSaveTimer = null;
    }
    if (positionUpdateTimer) {
      clearTimeout(positionUpdateTimer);
      positionUpdateTimer = null;
    }
    return sessionApi.flushPlaybackSession().catch(err => {
      console.warn('[SessionSync] flushPlaybackSession failed:', err);
    });
  };

  const setupMainWindowSync = () => {
    const sessionWatchSources: WatchSource[] = [
      currentSongPath,
      playQueuePaths,
      sourceSongPaths,
      playMode,
      volume,
      sessionQualityOverride,
    ];
    watch(sessionWatchSources, () => {
      scheduleSessionSave();
    });

    watch(currentTime, () => {
      if (isPlaying.value) {
        schedulePositionUpdate();
      }
    });

    watch(isPlaying, () => {
      sessionApi
        .updatePlaybackPosition(currentTime.value, isPlaying.value)
        .catch(() => {});
    });

    const beforeUnload = () => {
      void flushSession();
    };
    window.addEventListener('beforeunload', beforeUnload);

    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
      if (positionUpdateTimer) clearTimeout(positionUpdateTimer);
    };
  };

  const setupSecondaryWindowSync = async (
    onSessionChanged: (data: PlaybackSessionChangedPayload) => void,
  ) => {
    try {
      const data = await sessionApi.getPlaybackSession();
      if (data) {
        onSessionChanged(data);
      }
    } catch (err) {
      console.warn('[SessionSync] getPlaybackSession failed:', err);
    }

    unlistenSessionChanged = await listen<PlaybackSessionChangedPayload>(
      'playback:session-changed',
      (event) => {
        onSessionChanged(event.payload);
      },
    );
  };

  const init = () => {
    if (isMainWindow()) {
      return setupMainWindowSync();
    }
    return () => {
      unlistenSessionChanged?.();
    };
  };

  return {
    init,
    scheduleSessionSave,
    flushSession,
    setupSecondaryWindowSync,
    collectSessionData,
  };
}
