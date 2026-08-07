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

interface LibraryScanProgressPayload extends LibraryScanProgress {}

interface CreatePlayerLifecycleDeps {
  bootstrapLibrary: () => Promise<void>;
  togglePlay: () => void | Promise<void>;
  nextSong: () => void;
  prevSong: () => void;
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
  const { favoritePaths, playlists, playlistSortMode } = storeToRefs(collectionsStore);
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
    // 10 段 EQ 的唯一数据源是 soundEffectStore.eqBands（新音效面板）。
    // 不再读旧的 settings.audio.equalizer——其默认 enabled=false 会让 Rust Equalizer 整体
    // 直通，导致新面板 EQ 滑块拖动后听不到任何变化（「均衡器没效果」的根因）。
    // preamp 固定 0（新面板无 preamp 控件），enabled 由 bypassAll（AB 对比旁通）决定。
    const soundEffectStore = useSoundEffectStore();
    const eqFreqLabels = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'] as const;
    const gains = eqFreqLabels.map(label => soundEffectStore.eqBands[label] ?? 0);
    const enabled = !soundEffectStore.bypassAll;
    const preamp = 0;
    const eq = { enabled, preamp, gains };
    
    // 生成当前即将写入的规范化高精度参数签名
    const currentParamsSignature = createEqualizerSignature(eq.enabled, eq.preamp, eq.gains);
    
    // 从底层查询最后一次成功同步过的签名缓存
    const lastSynced = playbackApi.getLastSyncedParams();
    
    if (currentParamsSignature === lastSynced) {
      if (import.meta.env.DEV) {
        console.log(`[playerLifecycle] EQ params already synced (${currentParamsSignature}), skipping duplicate IPC.`);
      }
      return;
    }
    
    if (import.meta.env.DEV) {
      console.log(`[playerLifecycle] EQ params changed from store. Triggering IPC. Signature: ${currentParamsSignature}`);
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
      listen<LibraryScanBatchPayload>('library-scan-batch', event => {
        applyLibraryScanBatch(event.payload);
      }),
      listen<LibraryScanProgressPayload>('library-scan-progress', event => {
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
    watch(favoritePaths, scheduleStatePersistence, { deep: true });

    // 合并两个对 playlists 的 watch：持久化保存 + 在线歌曲注入 songPool。
    // 使用 deep 监听以捕获歌单内歌曲增删，但批量合并 setExtraSongs 以减少 songCatalogVersion 递增。
    let lastPlaylistSongsSignature = '';
    watch(playlists, (newPlaylists) => {
      // 1. 持久化保存
      scheduleStatePersistence();
      // 2. 将 playlist.songs 缓存中的在线歌曲注入 songPool，
      //    确保 songLookup 能找到这些歌曲（在线歌曲不在本地库中）
      // 用签名检测歌曲内容是否实际变化，避免重命名等无关变更触发 setExtraSongs
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
    watch(settings, scheduleStatePersistence, { deep: true });
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
    watch(artistCustomOrder, scheduleStatePersistence, { deep: true });
    watch(albumCustomOrder, scheduleStatePersistence, { deep: true });
    watch(folderCustomOrder, scheduleStatePersistence, { deep: true });
    watch(localCustomOrder, scheduleStatePersistence, { deep: true });

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

      // 取色在 Rust 侧完成，可直接传入原始封面值（本地路径 / http 直链 / data URI），
      // 无需再经 convertFileSrc 转成 webview 资源 URL。
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

    // 切歌时（currentSongPath 变化）在 path 数组上算一次 indexOf，缓存 index。
    // playQueuePaths 变化时（增删/重排）使缓存失效，下次切歌时重算。
    // 这样播放期间的 currentTime watcher 只需 O(1) 读取缓存 index，
    // 不再每帧读取 playQueue computed（会触发 600 首物化）+ findIndex(O(n))。
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

    // 仅 watch currentSong + currentTime，playQueue 在回调内直接读取。
    // 原先 watch 三源会在每次 currentTime 更新时创建 [song, time, queue] 数组，
    // 其中 queue 可能是包含数千首歌的大数组——移出 watch 源可避免每次 tick 的无谓读取和数组分配。
    watch([currentSong, currentTime], ([song, time]) => {
      if (!isPlaying.value || !song || song.duration <= 0 || time / song.duration < 0.6) {
        return;
      }

      // 预缓存只针对 remote:// (WebDAV) 歌曲。
      // 若当前歌不是 remote://，下一首也不需要预缓存，直接跳过队列扫描，
      // 避免 lx:// / plugin:// 歌曲播放时每帧白跑 findIndex(O(n))。
      if (!isRemoteSong(song)) {
        return;
      }

      const index = ensureQueueIndex(song.path);
      const nextPath = index >= 0 ? playQueuePaths.value[index + 1] : null;
      if (!nextPath || nextPath === lastPrecachedRemotePath) {
        return;
      }

      // 确认下一首是 remote:// 歌曲，才发起预缓存
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

    // 流光/桌面歌词封面取色共用主色，参数微调时 debounce 延迟重提取，避免拖动滑块时频繁触发层切换闪烁
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

    const playbackTimePersistTimer = setInterval(persistCurrentPlaybackTime, 2000);

    const beforeUnloadHandler = () => {
      flushPersistedState().catch(() => {});
      persistCurrentPlaybackTime();
      // 强制将播放会话状态持久化到 Rust/SQLite
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

      // 恢复在线收藏歌曲的元信息，并写入额外歌曲池，
      // 使收藏列表能反查出这些不在本地音乐库中的歌曲
      const favoriteSongMeta = playerStorage.readFavoriteSongMeta();
      collectionsStore.setFavoriteSongMetaMap(favoriteSongMeta);
      const extraSongs = Object.values(favoriteSongMeta);

      // 恢复在线最近播放歌曲的元信息，并写入额外歌曲池，
      // 使最近播放列表能反查出这些不在本地音乐库中的歌曲
      const recentSongMeta = playerStorage.readRecentSongMeta();
      collectionsStore.setRecentSongMetaMap(recentSongMeta);
      const recentExtraSongs = Object.values(recentSongMeta);

      // 恢复队列/歌单中在线歌曲的元信息（含非收藏），写入额外歌曲池，
      // 使 resolveSongsByPaths 能还原这些不在本地库的在线歌（含 duration），
      // 否则非收藏在线歌重启后会从播放队列中整首丢失
      const queueSongMeta = playerStorage.readQueueSongMeta();
      const queueExtraSongs = Object.values(queueSongMeta);

      // 从 Rust 加载播放会话（单一事实源），并注入其中的 queueSongMeta
      let rustSession: Awaited<ReturnType<typeof sessionApi.loadPlaybackSession>> | null = null;
      try {
        rustSession = await sessionApi.loadPlaybackSession();
      } catch (err) {
        console.warn('[restore] loadPlaybackSession failed, falling back to localStorage:', err);
      }

      // 合并 Rust 会话中的在线歌曲元数据（优先于 localStorage）
      const rustQueueExtraSongs = rustSession?.queueSongMeta
        ? Object.values(rustSession.queueSongMeta)
        : [];

      // 批量写入所有在线歌曲元信息，仅递增一次 songCatalogVersion，
      // 避免 songLookup/canonicalSongs/currentViewSongs 级联重算 3+ 次
      const extraSongGroups = [extraSongs, recentExtraSongs, queueExtraSongs, rustQueueExtraSongs].filter(g => g.length > 0);
      if (extraSongGroups.length > 0) {
        libraryStore.setExtraSongsBatch(extraSongGroups);
      }

      collectionsStore.setPlaylists(await playerStorage.readPlaylistsAsync());

      // 诊断：检查恢复的歌单是否包含 songs 缓存
      const restoredPls = collectionsStore.playlists;
      const withSongs = restoredPls.filter(p => p.songs && p.songs.length > 0);
      console.log(`[restore] playlists: ${restoredPls.length} total, ${withSongs.length} with songs cache`);
      for (const pl of restoredPls) {
        if (pl.songPaths.some(p => p.startsWith('plugin://') || p.startsWith('lx://'))) {
          console.log(`[restore] playlist "${pl.name}": songPaths=${pl.songPaths.length}, songs=${pl.songs?.length ?? 0}`);
        }
      }

      // 恢复歌单后，将 playlist.songs 缓存中的在线歌曲注入 songPool，
      // 确保 songLookup 能找到这些歌曲（在线歌曲不在本地库中，重启后会丢失）
      // 批量合并所有歌单的在线歌曲，仅递增一次 songCatalogVersion
      const playlistSongGroups = restoredPls
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

      // 恢复记忆播放的歌曲后，主动加载其歌词。否则重启后直接进入详情页会显示"无歌词"，
      // 因为恢复流程只还原了 currentSong/封面，没有像正常播放那样触发 loadLyrics。
      if (currentSong.value) {
        void loadLyrics();
      }

      // 恢复播放进度：优先使用 Rust 会话中的进度，回退到 localStorage
      if (rustSession?.currentPositionSecs && rustSession.currentPositionSecs > 0) {
        currentTime.value = rustSession.currentPositionSecs;
      } else {
        const storedLastTime = playerStorage.readNumber(playerStorageKeys.lastTime);
        if (storedLastTime !== null) {
          currentTime.value = storedLastTime;
        }
      }

      // 初始化播放会话同步（将后续状态变更同步到 Rust）
      disposeSessionSync = usePlaybackSessionSync().init();

      window.addEventListener('beforeunload', beforeUnloadHandler);
      window.setTimeout(() => void runRemoteAutoSync(), 30_000);
      remoteAutoSyncTimer = setInterval(() => void runRemoteAutoSync(), 60 * 60 * 1000);
    });

    onScopeDispose(() => {
      if (flowTweakTimer) {
        clearTimeout(flowTweakTimer);
      }
      if (remoteAutoSyncTimer) {
        clearInterval(remoteAutoSyncTimer);
      }
      persistCurrentPlaybackTime();
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
