/**
 * 播放会话同步 composable
 *
 * 将播放状态（队列、当前歌曲、进度、模式、音量）同步到 Rust 后端，
 * 使 Rust 成为播放会话的单一事实源（single source of truth）。
 *
 * 主窗口：watch 状态变化 → 调用 sessionApi.savePlaybackSession（防抖）
 *         进度变化 → 调用 sessionApi.updatePlaybackPosition（节流）
 *         退出/定时 → 调用 sessionApi.flushPlaybackSession
 *
 * 副窗口：启动时调用 sessionApi.getPlaybackSession 获取初始状态
 *         监听 playback:session-changed 事件获取实时更新
 */

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

/** 判断当前窗口是否为主窗口（主窗口负责写入，副窗口只读） */
const isMainWindow = (): boolean => {
  try {
    return getCurrentWindow().label === 'main';
  } catch {
    return true;
  }
};

/** 收集队列/歌单中所有在线歌的完整 Song 元数据（用于重启后还原） */
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

/**
 * 初始化主窗口的播放会话同步
 *
 * 在 playerLifecycle 的 restore 完成后调用。
 * 设置 watchers 将播放状态变更同步到 Rust。
 */
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

  /** 收集当前播放会话数据 */
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

  /** 防抖保存完整会话状态到 Rust */
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

  /** 节流更新播放进度到 Rust（不写 SQLite，仅内存 + 防抖持久化） */
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

  /** 强制持久化（退出时调用） */
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

  /** 主窗口：设置 watchers 将状态变更同步到 Rust */
  const setupMainWindowSync = () => {
    // 队列/歌单/当前歌曲/模式/音量/音质变更 → 防抖保存完整会话
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

    // 进度变更 → 节流更新位置（不触发完整会话保存）
    watch(currentTime, () => {
      if (isPlaying.value) {
        schedulePositionUpdate();
      }
    });

    // 播放/暂停状态变更 → 立即更新位置（包含 isPlaying 状态）
    watch(isPlaying, () => {
      sessionApi
        .updatePlaybackPosition(currentTime.value, isPlaying.value)
        .catch(() => {});
    });

    // 退出时强制持久化
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

  /**
   * 副窗口：监听 playback:session-changed 事件
   *
   * 返回的 applySessionData 函数可用于将事件数据应用到本地 store。
   */
  const setupSecondaryWindowSync = async (
    onSessionChanged: (data: PlaybackSessionChangedPayload) => void,
  ) => {
    // 启动时从 Rust 获取当前状态
    try {
      const data = await sessionApi.getPlaybackSession();
      if (data) {
        onSessionChanged(data);
      }
    } catch (err) {
      console.warn('[SessionSync] getPlaybackSession failed:', err);
    }

    // 监听后续变更
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
    // 副窗口的同步由各自的 window bridge composable 调用 setupSecondaryWindowSync
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
