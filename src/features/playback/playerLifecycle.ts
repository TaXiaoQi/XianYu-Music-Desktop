import { listen } from '@tauri-apps/api/event';
import { onMounted, onScopeDispose, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { clearPaletteCache, extractDominantColors } from '../../composables/colorExtraction';
import type { LibraryScanProgress, LibrarySong, Song } from '../../types';
import {
  playerStorage,
  playerStorageKeys,
  type AlbumSortMode,
  type AlbumDetailSortMode,
  type ArtistSortMode,
  type FolderSortMode,
  type LocalSortMode,
  type PlaylistSortMode,
} from '../../services/storage/playerStorage';
import { playbackApi, createEqualizerSignature } from '../../services/tauri/playbackApi';
import { sessionApi } from '../../services/tauri/sessionApi';
import { remoteLibraryApi } from '../../services/tauri/remoteLibraryApi';
import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from '../library/store';
import { usePlaybackStore } from './store';
import { usePlaybackSessionSync } from './usePlaybackSessionSync';
import { useSoundEffectStore } from './soundEffectStore';
import { useSettingsStore } from '../settings/store';
import { defaultDominantColors, useUiStore } from '../../shared/stores/ui';
import { isRemoteSong } from '../../utils/remoteSong';

interface SeekCompletedPayload {
  request_id: number;
  time: number;
}

type RemoteLyricsCacheReadyPayload = string | {
  uri: string;
  song?: Song | null;
};

interface LibraryScanBatchPayload {
  songs: Song[];
  deleted_paths: string[];
  folder_path: string;
  folder_index: number;
  folder_total: number;
}

interface CreatePlayerLifecycleDeps {
  bootstrapLibrary: () => Promise<void>;
  togglePlay: () => void | Promise<void>;
  nextSong: () => void;
  prevSong: () => void;
  seekTo: (time: number) => void | Promise<void>;
  stopPlayback: () => void | Promise<void>;
  applyLibraryScanBatch: (payload: LibraryScanBatchPayload) => void;
  flushBufferedLibraryScanBatch: () => void;
  handleSeekCompleted: (payload: SeekCompletedPayload) => void;
  schedulePersistedState: () => void;
  flushPersistedState: () => Promise<void>;
  restorePathBackedState: (rustSession?: import('../../services/tauri/sessionApi').PlaybackSessionData | null) => Promise<void>;
  restoreRecentHistory: () => Promise<void>;
  refreshStateSongReferences: () => void;
  loadLyrics: () => void | Promise<void>;
  disposePlayerPlayback: () => void;
  disposeLibraryRuntime: () => void;
  disposePlayerPersistence: () => void;
  disposeLibraryBatch: () => void;
  lastSongPathKey: string;
  legacyLastSongKey: string;
}

let dominantColorTaskId = 0;
let dominantColorSignature = '';

interface SortSettingsRefs {
  artistSortMode: Ref<ArtistSortMode>;
  albumSortMode: Ref<AlbumSortMode>;
  albumDetailSortMode: Ref<AlbumDetailSortMode>;
  artistCustomOrder: Ref<string[]>;
  albumCustomOrder: Ref<string[]>;
  folderSortMode: Ref<FolderSortMode>;
  folderCustomOrder: Ref<Record<string, string[]>>;
  localSortMode: Ref<LocalSortMode>;
  localCustomOrder: Ref<string[]>;
  playlistSortMode: Ref<PlaylistSortMode>;
}

const restoreOutputDevice = async () => {
  const storedOutputDevice = playerStorage.getString(playerStorageKeys.outputDevice);
  const storedOutputMode = playerStorage.getString(playerStorageKeys.outputDeviceMode);

  if ((storedOutputMode === 'manual' || (!storedOutputMode && storedOutputDevice)) && storedOutputDevice) {
    await playbackApi.setOutputDevice(storedOutputDevice).catch(error => {
      console.warn('Failed to restore output device:', error);
    });
    return;
  }

  await playbackApi.setOutputDevice(null).catch(error => {
    console.warn('Failed to restore default output device mode:', error);
  });
};

const restoreSortSettings = ({
  artistSortMode,
  albumSortMode,
  albumDetailSortMode,
  artistCustomOrder,
  albumCustomOrder,
  folderSortMode,
  folderCustomOrder,
  localSortMode,
  localCustomOrder,
  playlistSortMode,
}: SortSettingsRefs) => {
  const storedArtistSort = playerStorage.getString(playerStorageKeys.artistSortMode);
  if (storedArtistSort) {
    artistSortMode.value = storedArtistSort as ArtistSortMode;
  }

  const storedAlbumSort = playerStorage.getString(playerStorageKeys.albumSortMode);
  if (storedAlbumSort && ['count', 'name', 'artist', 'custom'].includes(storedAlbumSort)) {
    albumSortMode.value = storedAlbumSort as AlbumSortMode;
  }

  const storedAlbumDetailSort = playerStorage.getString(playerStorageKeys.albumDetailSortMode);
  if (storedAlbumDetailSort && ['track_number', 'track_number_desc', 'title', 'artist', 'added_at', 'added_at_asc', 'file_modified_at', 'file_modified_at_asc'].includes(storedAlbumDetailSort)) {
    albumDetailSortMode.value = storedAlbumDetailSort as AlbumDetailSortMode;
  }

  const storedArtistOrder = playerStorage.readStringArray(playerStorageKeys.artistCustomOrder);
  if (storedArtistOrder) {
    artistCustomOrder.value = storedArtistOrder;
  }

  const storedAlbumOrder = playerStorage.readStringArray(playerStorageKeys.albumCustomOrder);
  if (storedAlbumOrder) {
    albumCustomOrder.value = storedAlbumOrder;
  }

  const storedFolderSort = playerStorage.getString(playerStorageKeys.folderSortMode);
  if (storedFolderSort && ['title', 'name', 'artist', 'track_number', 'added_at', 'added_at_asc', 'custom'].includes(storedFolderSort)) {
    folderSortMode.value = storedFolderSort as FolderSortMode;
  }

  const storedLocalSort = playerStorage.getString(playerStorageKeys.localSortMode);
  if (storedLocalSort && ['title', 'artist', 'added_at', 'added_at_asc', 'file_modified_at', 'file_modified_at_asc', 'custom'].includes(storedLocalSort)) {
    localSortMode.value = storedLocalSort as LocalSortMode;
  } else if (storedLocalSort === 'name') {
    localSortMode.value = 'title';
  } else if (storedLocalSort === 'default') {
    localSortMode.value = 'title';
  }

  const storedPlaylistSort = playerStorage.getString(playerStorageKeys.playlistSortMode);
  if (storedPlaylistSort && ['title', 'name', 'artist', 'added_at', 'custom'].includes(storedPlaylistSort)) {
    playlistSortMode.value = storedPlaylistSort as PlaylistSortMode;
  }

  const storedFolderOrder = playerStorage.readObject<Record<string, string[]>>(playerStorageKeys.folderCustomOrder);
  if (storedFolderOrder) {
    folderCustomOrder.value = storedFolderOrder;
  }

  const storedLocalOrder = playerStorage.readStringArray(playerStorageKeys.localCustomOrder);
  if (storedLocalOrder) {
    localCustomOrder.value = storedLocalOrder;
  }
};

export const createPlayerLifecycle = ({
  bootstrapLibrary,
  togglePlay,
  nextSong,
  prevSong,
  seekTo,
  stopPlayback,
  applyLibraryScanBatch,
  flushBufferedLibraryScanBatch,
  handleSeekCompleted,
  schedulePersistedState,
  flushPersistedState,
  restorePathBackedState,
  restoreRecentHistory,
  refreshStateSongReferences,
  loadLyrics,
  disposePlayerPlayback,
  disposeLibraryRuntime,
  disposePlayerPersistence,
  disposeLibraryBatch,
  lastSongPathKey,
  legacyLastSongKey,
}: CreatePlayerLifecycleDeps) => {
  let lifecycleInitDone = false;
  let disposeSessionSync: (() => void) | null = null;
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();
  const { settings } = storeToRefs(settingsStore);
  const {
    sourceSongPaths,
    watchedFolders,
    artistSortMode,
    albumSortMode,
    albumDetailSortMode,
    artistCustomOrder,
    albumCustomOrder,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    localCustomOrder,
  } = storeToRefs(libraryStore);
  const { favoritePaths, favoriteCollections, playlists, playlistSortMode } = storeToRefs(collectionsStore);
  const {
    currentCover,
    currentSong,
    currentSongPath,
    currentTime,
    isPlaying,
    playMode,
    playQueuePaths,
    volume,
  } = storeToRefs(playbackStore);
  const { dominantColors } = storeToRefs(uiStore);
  const scheduleStatePersistence = () => {
    schedulePersistedState();
  };
  const syncLoudnessSettings = async () => {
    const volumeBalance = settings.value.audio.volumeBalance;
    const song = currentSong.value;
    await playbackApi.updateLoudnessSettings({
      enabled: volumeBalance.enabled,
      songId: song?.id ?? null,
      songPath: song ? (song.cue_source_path || song.path) : null,
      gainOffsetDb: volumeBalance.gainOffsetDb,
      preventClipping: volumeBalance.preventClipping,
    }).catch(err => {
      console.warn('Failed to update loudness settings:', err);
    });
  };

  const syncEqualizerSettings = async () => {
    const soundEffectStore = useSoundEffectStore();
    const eqFreqLabels = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'] as const;
    const gains = eqFreqLabels.map(label => soundEffectStore.eqBands[label] ?? 0);
    const enabled = !soundEffectStore.bypassAll;
    const preamp = 0;
    const eq = { enabled, preamp, gains };
    
    const currentParamsSignature = createEqualizerSignature(eq.enabled, eq.preamp, eq.gains);
    
    const lastSynced = playbackApi.getLastSyncedParams();
    
    if (currentParamsSignature === lastSynced) {
      return;
    }

    await playbackApi.setEqualizerSettings(
      eq.enabled,
      eq.preamp,
      eq.gains
    ).catch(err => {
      console.warn('Failed to update equalizer settings:', err);
    });
  };

  onMounted(async () => {
    await bootstrapLibrary();
  });

  const init = () => {
    if (lifecycleInitDone) {
      return;
    }
    lifecycleInitDone = true;

    const listenerRegistrations = [
      listen('player:play', () => {
        if (!isPlaying.value) {
          void togglePlay();
        }
      }),
      listen('player:pause', () => {
        if (isPlaying.value) {
          void togglePlay();
        }
      }),
      listen('player:next', () => {
        nextSong();
      }),
      listen('player:prev', () => {
        prevSong();
      }),
      listen<number>('player:seek-to', event => {
        const time = Number(event.payload);
        if (Number.isFinite(time) && time >= 0) {
          void seekTo(time);
        }
      }),
      listen('player:stop', () => {
        void stopPlayback();
      }),
      listen<LibraryScanBatchPayload>('library-scan-batch', event => {
        applyLibraryScanBatch(event.payload);
      }),
      listen<LibraryScanProgress>('library-scan-progress', event => {
        libraryStore.setLibraryScanProgress({
          ...event.payload,
          message: event.payload.message ?? null,
        });

        if (event.payload.failed) {
          libraryStore.setLastLibraryScanError(event.payload.message ?? 'Library scan failed');
        }

        if (event.payload.done) {
          flushBufferedLibraryScanBatch();
        }
      }),
      listen<SeekCompletedPayload>('seek_completed', event => {
        handleSeekCompleted(event.payload);
      }),
      listen<RemoteLyricsCacheReadyPayload>('remote-lyrics-cache-ready', event => {
        const payload = event.payload;
        const uri = typeof payload === 'string' ? payload : payload.uri;
        const song = typeof payload === 'string' ? null : payload.song;
        if (song?.path) {
          libraryStore.setSongRecord(song);
        }
        if (currentSong.value?.path === uri) {
          void loadLyrics();
        }
      }),
    ];

    watch(volume, value => {
      playerStorage.writeNumber(playerStorageKeys.volume, value);
    });

    watch(playMode, value => {
      playerStorage.writeNumber(playerStorageKeys.playMode, value);
    });

    watch(sourceSongPaths, scheduleStatePersistence);
    watch(playQueuePaths, scheduleStatePersistence);
    watch(watchedFolders, scheduleStatePersistence);
    watch(favoritePaths, scheduleStatePersistence);
    watch(favoriteCollections, scheduleStatePersistence, { deep: true });

    let lastPlaylistSongsSignature = '';
    watch(playlists, (newPlaylists) => {
      scheduleStatePersistence();
      const songGroups: LibrarySong[][] = [];
      let currentSignature = '';
      for (const pl of newPlaylists) {
        if (pl.songs && pl.songs.length > 0) {
          songGroups.push(pl.songs);
          currentSignature += `${pl.id}:${pl.songs.length};`;
        }
      }
      if (currentSignature !== lastPlaylistSongsSignature && songGroups.length > 0) {
        lastPlaylistSongsSignature = currentSignature;
        libraryStore.setExtraSongsBatch(songGroups);
      }
    }, { deep: true, immediate: true });
    watch(() => JSON.stringify(settings.value), scheduleStatePersistence);
    watch(
      () => settings.value.audio.volumeBalance,
      () => {
        void syncLoudnessSettings();
      },
      { deep: true }
    );
    watch(
      () => settings.value.audio.equalizer,
      () => {
        void syncEqualizerSettings();
      },
      { deep: true }
    );
    watch(artistCustomOrder, scheduleStatePersistence);
    watch(albumCustomOrder, scheduleStatePersistence);
    watch(() => JSON.stringify(folderCustomOrder.value), scheduleStatePersistence);
    watch(localCustomOrder, scheduleStatePersistence);

    watch(artistSortMode, value => {
      playerStorage.setString(playerStorageKeys.artistSortMode, value);
    });
    watch(albumSortMode, value => {
      playerStorage.setString(playerStorageKeys.albumSortMode, value);
    });
    watch(albumDetailSortMode, value => {
      playerStorage.setString(playerStorageKeys.albumDetailSortMode, value);
    });
    watch(folderSortMode, value => {
      playerStorage.setString(playerStorageKeys.folderSortMode, value);
    });
    watch(localSortMode, value => {
      playerStorage.setString(playerStorageKeys.localSortMode, value);
    });
    watch(playlistSortMode, value => {
      playerStorage.setString(playerStorageKeys.playlistSortMode, value);
    });

    watch(currentSongPath, path => {
      if (path) {
        playerStorage.setString(lastSongPathKey, path);
        playerStorage.remove(legacyLastSongKey);
        return;
      }

      playerStorage.remove(lastSongPathKey);
      playerStorage.remove(legacyLastSongKey);
    });

    const updateDominantColors = async (cover: string) => {
      const needsCoverPalette = settings.value.theme.dynamicBgType === 'flow'
        || settings.value.desktopLyrics.colorScheme === 'auto';

      if (!needsCoverPalette || !cover) {
        dominantColorTaskId += 1;
        dominantColorSignature = '';
        dominantColors.value = [...defaultDominantColors];
        return;
      }

      const signature = JSON.stringify({
        cover,
        colorBoost: settings.value.theme.flowColorBoost,
        depth: settings.value.theme.flowDepth,
      });

      if (signature === dominantColorSignature) {
        return;
      }

      const taskId = ++dominantColorTaskId;
      const colors = await extractDominantColors(cover, 4, {
        colorBoost: settings.value.theme.flowColorBoost,
        depth: settings.value.theme.flowDepth,
      });
      if (taskId !== dominantColorTaskId) return;
      dominantColorSignature = signature;
      dominantColors.value = colors;
    };

    watch(currentCover, (nextCover) => {
      void updateDominantColors(nextCover);
    }, { immediate: true });

    let lastPrecachedRemotePath = '';
    let cachedQueueIndex = -1;
    let cachedQueueVersion = -1;

    const ensureQueueIndex = (path: string) => {
      const version = playQueuePaths.value.length;
      if (cachedQueueVersion === version && cachedQueueIndex >= 0) {
        return cachedQueueIndex;
      }
      cachedQueueVersion = version;
      cachedQueueIndex = playQueuePaths.value.indexOf(path);
      return cachedQueueIndex;
    };

    watch(currentSongPath, () => {
      cachedQueueIndex = -1;
      cachedQueueVersion = -1;
    });

    watch([currentSong, currentTime], ([song, time]) => {
      if (!isPlaying.value || !song || song.duration <= 0 || time / song.duration < 0.6) {
        return;
      }

      if (!isRemoteSong(song)) {
        return;
      }

      const index = ensureQueueIndex(song.path);
      const nextPath = index >= 0 ? playQueuePaths.value[index + 1] : null;
      if (!nextPath || nextPath === lastPrecachedRemotePath) {
        return;
      }

      if (!nextPath.startsWith('remote://')) {
        return;
      }

      lastPrecachedRemotePath = nextPath;
      remoteLibraryApi.precacheRemoteSong(nextPath).catch(error => {
        console.warn('Failed to precache remote song:', error);
      });
    });

    const remoteAutoSyncKey = 'xianyu_remote_auto_sync_at';
    const remoteAutoSyncIntervalMs = 24 * 60 * 60 * 1000;
    let remoteAutoSyncTimer: ReturnType<typeof setInterval> | null = null;
    let remoteAutoSyncStartupTimer: number | null = null;
    let remoteAutoSyncRunning = false;
    const runRemoteAutoSync = async () => {
      if (remoteAutoSyncRunning) return;
      remoteAutoSyncRunning = true;
      try {
        const sources = await remoteLibraryApi.getRemoteSources();
        for (const source of sources) {
          if (!source.enabled) continue;
          const key = `${remoteAutoSyncKey}:${source.id}`;
          const lastSyncAt = Number(localStorage.getItem(key) || '0');
          if (Date.now() - lastSyncAt < remoteAutoSyncIntervalMs) continue;
          await remoteLibraryApi.syncRemoteSource(source.id);
          localStorage.setItem(key, String(Date.now()));
        }
      } catch (error) {
        console.warn('Failed to auto sync remote library:', error);
      } finally {
        remoteAutoSyncRunning = false;
      }
    };

    let flowTweakTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPersistedPlaybackTime = Number.NaN;

    const persistCurrentPlaybackTime = () => {
      if (!currentSong.value) return;
      const nextTime = Math.max(0, currentTime.value);
      if (Math.abs(nextTime - lastPersistedPlaybackTime) < 0.5) return;
      lastPersistedPlaybackTime = nextTime;
      playerStorage.writeNumber(playerStorageKeys.lastTime, nextTime);
    };

    watch([
      () => settings.value.theme.flowColorBoost,
      () => settings.value.theme.flowDepth,
    ], () => {
      if (flowTweakTimer) clearTimeout(flowTweakTimer);
      flowTweakTimer = setTimeout(async () => {
        void updateDominantColors(currentCover.value);
      }, 500);
    });

    watch(
      () => settings.value.theme.dynamicBgType,
      (dynamicBgType) => {
        if (dynamicBgType !== 'flow') {
          clearPaletteCache();
          void updateDominantColors(currentCover.value);
          return;
        }

        void updateDominantColors(currentCover.value);
      },
    );

    watch(
      () => settings.value.desktopLyrics.colorScheme,
      () => {
        void updateDominantColors(currentCover.value);
      },
    );

    watch(isPlaying, playing => {
      if (!playing) {
        persistCurrentPlaybackTime();
      }
    });

    watch(
      [isPlaying, () => settings.value.preventSleepWhilePlaying],
      ([playing, preventSleepWhilePlaying]) => {
        playbackApi.setPreventSleep(playing && preventSleepWhilePlaying).catch(error => {
          console.warn('Failed to update system sleep prevention:', error);
        });
      },
      { immediate: true },
    );

    const playbackTimePersistTimer = setInterval(persistCurrentPlaybackTime, 2000);

    const beforeUnloadHandler = () => {
      flushPersistedState().catch(() => {});
      persistCurrentPlaybackTime();
      sessionApi.flushPlaybackSession().catch(() => {});
    };

    onMounted(async () => {
      const storedVolume = playerStorage.readNumber(playerStorageKeys.volume);
      if (storedVolume !== null) {
        volume.value = storedVolume;
        await playbackApi.setVolume(volume.value / 100);
      }

      const storedPlayMode = playerStorage.readNumber(playerStorageKeys.playMode);
      if (storedPlayMode !== null && [0, 1, 2].includes(storedPlayMode)) {
        playMode.value = storedPlayMode;
      }

      await restoreOutputDevice();

      libraryStore.setWatchedFolders(
        playerStorage.readStringArray(playerStorageKeys.watchedFolders) ?? [],
      );

      collectionsStore.setFavoritePaths(
        playerStorage.readStringArray(playerStorageKeys.favorites) ?? [],
      );

      collectionsStore.setFavoriteCollections(playerStorage.readFavoriteCollections());

      const favoriteSongMeta = playerStorage.readFavoriteSongMeta();
      collectionsStore.setFavoriteSongMetaMap(favoriteSongMeta);
      const extraSongs = Object.values(favoriteSongMeta);

      const recentSongMeta = playerStorage.readRecentSongMeta();
      collectionsStore.setRecentSongMetaMap(recentSongMeta);
      const recentExtraSongs = Object.values(recentSongMeta);

      const queueSongMeta = playerStorage.readQueueSongMeta();
      const queueExtraSongs = Object.values(queueSongMeta);

      let rustSession: Awaited<ReturnType<typeof sessionApi.loadPlaybackSession>> | null = null;
      try {
        rustSession = await sessionApi.loadPlaybackSession();
      } catch (err) {
        console.warn('[restore] loadPlaybackSession failed, falling back to localStorage:', err);
      }

      const rustQueueExtraSongs = rustSession?.queueSongMeta
        ? Object.values(rustSession.queueSongMeta)
        : [];

      const extraSongGroups = [extraSongs, recentExtraSongs, queueExtraSongs, rustQueueExtraSongs].filter(g => g.length > 0);
      if (extraSongGroups.length > 0) {
        libraryStore.setExtraSongsBatch(extraSongGroups);
      }

      collectionsStore.setPlaylists(await playerStorage.readPlaylistsAsync());

      const playlistSongGroups = collectionsStore.playlists
        .filter(pl => pl.songs && pl.songs.length > 0)
        .map(pl => pl.songs!);
      if (playlistSongGroups.length > 0) {
        libraryStore.setExtraSongsBatch(playlistSongGroups);
      }

      restoreSortSettings({
        artistSortMode,
        albumSortMode,
        albumDetailSortMode,
        artistCustomOrder,
        albumCustomOrder,
        folderSortMode,
        folderCustomOrder,
        localSortMode,
        localCustomOrder,
        playlistSortMode,
      });
      await playbackApi.setAudioOutputMode(settings.value.audio.outputMode).catch(error => {
        console.warn('Failed to restore audio output mode:', error);
      });
      const vb = settings.value.audio.volumeBalance;
      if (vb) {
        await syncLoudnessSettings();
      }
      await syncEqualizerSettings();

      await restorePathBackedState(rustSession);
      await restoreRecentHistory();
      refreshStateSongReferences();

      if (currentSong.value) {
        void loadLyrics();
      }

      if (rustSession?.currentPositionSecs && rustSession.currentPositionSecs > 0) {
        currentTime.value = rustSession.currentPositionSecs;
      } else {
        const storedLastTime = playerStorage.readNumber(playerStorageKeys.lastTime);
        if (storedLastTime !== null) {
          currentTime.value = storedLastTime;
        }
      }

      disposeSessionSync = usePlaybackSessionSync().init();

      window.addEventListener('beforeunload', beforeUnloadHandler);
      remoteAutoSyncStartupTimer = window.setTimeout(() => {
        remoteAutoSyncStartupTimer = null;
        void runRemoteAutoSync();
      }, 30_000);
      remoteAutoSyncTimer = setInterval(() => void runRemoteAutoSync(), 60 * 60 * 1000);
    });

    onScopeDispose(() => {
      if (flowTweakTimer) {
        clearTimeout(flowTweakTimer);
      }
      if (remoteAutoSyncTimer) {
        clearInterval(remoteAutoSyncTimer);
        remoteAutoSyncTimer = null;
      }
      if (remoteAutoSyncStartupTimer) {
        clearTimeout(remoteAutoSyncStartupTimer);
        remoteAutoSyncStartupTimer = null;
      }
      persistCurrentPlaybackTime();
      void playbackApi.setPreventSleep(false).catch(() => {});
      clearInterval(playbackTimePersistTimer);
      dominantColorTaskId += 1;
      dominantColorSignature = '';
      disposeSessionSync?.();
      void Promise.all(listenerRegistrations).then(unlisteners => {
        unlisteners.forEach(unlisten => unlisten());
      });
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      disposePlayerPlayback();
      disposeLibraryRuntime();
      disposePlayerPersistence();
      disposeLibraryBatch();
    });
  };

  return {
    init,
  };
};
