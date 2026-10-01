import type {Song} from '../../types';
import {getFailedOnlineSource, findAlternativeOnlineSource, findSiblingPluginCandidate} from './onlineFailoverFacade';
import type {PlaySong, PlaySongOptions} from './playerPlaybackTypes';

const ONLINE_FAILURE_LOOP_GUARD_MS = 30_000;
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface OnlinePlaybackFailureDeps {
  playbackApi: {
    stopAudio: () => Promise<unknown>;
    setVolume: (volume: number) => Promise<unknown>;
  };
  playbackStore: {
    volume: number;
    tempQueue: Song[];
    playQueue: Song[];
  };
  settingsStore: {settings: any};
  getCurrentSong: () => Song | null;
  setIsPlaying: (playing: boolean) => void;
  setIsSongLoaded: (loaded: boolean) => void;
  stopPlaybackRuntime: () => void;
  showToast: (message: string, type?: string) => void;
  handleAutoNext: () => void;
  playSong: PlaySong;
  getPlayRequestId: () => number;
  isShareLinkPlaybackActive: () => boolean;
}

export interface OnlinePlaybackFailureController {
  preflightKnownFailedPlugin: (song: Song) => boolean | Promise<boolean>;
  handleFailure: (song: Song, options: PlaySongOptions, requestId: number, shouldFade: boolean | null) => Promise<void>;
  reset: () => void;
}

export function createOnlinePlaybackFailureController(
  deps: OnlinePlaybackFailureDeps,
): OnlinePlaybackFailureController {
  let lastHandledFailure: {path: string; requestId: number; handledAt: number} | null = null;
  const recentFailurePaths = new Map<string, number>();
  const knownFailedPluginPrefixes = new Set<string>();

  const pruneRecentFailurePaths = (now = Date.now()) => {
    for (const [path, failedAt] of recentFailurePaths) {
      if (now - failedAt > ONLINE_FAILURE_LOOP_GUARD_MS) recentFailurePaths.delete(path);
    }
  };

  const isLikelyPlayable = (item: Song) => {
    if (recentFailurePaths.has(item.path)) return false;
    if (item.path.startsWith('plugin://')) {
      for (const prefix of knownFailedPluginPrefixes) {
        if (item.path.startsWith(prefix)) return false;
      }
    }
    return true;
  };

  const preflightKnownFailedPlugin = (song: Song): boolean | Promise<boolean> => {
    if (!song.path.startsWith('plugin://')) return false;
    const withoutScheme = song.path.slice('plugin://'.length);
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex < 0) return false;
    const prefix = `plugin://${withoutScheme.slice(0, slashIndex + 1)}`;
    if (!knownFailedPluginPrefixes.has(prefix)) return false;

    const alreadyFailedRecently = recentFailurePaths.has(song.path);
    recentFailurePaths.set(song.path, Date.now());
    const queueSongs = [...deps.playbackStore.tempQueue, ...deps.playbackStore.playQueue];
    const hasPlayable = queueSongs.some(item => isLikelyPlayable(item));
    if (!hasPlayable) {
      deps.showToast('同步的在线歌曲在此设备上无法播放，请通过插件重新搜索添加', 'error');
      console.warn('[Audio] 队列中无可播放歌曲（所有 plugin:// 均属于已知失败来源），停止');
      return deps.playbackApi.stopAudio().catch(() => {}).then(() => {
        deps.setIsPlaying(false);
        deps.setIsSongLoaded(false);
        deps.stopPlaybackRuntime();
        return true;
      });
    }
    if (alreadyFailedRecently) return true;
    deps.handleAutoNext();
    return true;
  };

  const trySiblingPluginPlayback = async (song: Song, options: PlaySongOptions, requestId: number) => {
    const searchResult = song.rawData as {pluginId?: string} | undefined;
    if (!searchResult?.pluginId) return false;
    const tried = options._siblingTriedPluginIds ?? new Set<string>();
    const sibling = findSiblingPluginCandidate(song, tried);
    if (!sibling) return false;
    if (requestId !== deps.getPlayRequestId() || deps.getCurrentSong()?.path !== song.path) return false;

    console.info(`[Audio] 自动换源 · 同平台插件重试: ${sibling.pluginName} (${sibling.pluginId.slice(0, 8)}…)`);
    searchResult.pluginId = sibling.pluginId;
    song.plugin_id = sibling.pluginId;
    try {
      await deps.playSong(song, {
        preserveQueue: true,
        _sourceSwitchCtx: options._sourceSwitchCtx,
        _siblingTriedPluginIds: tried,
      });
      return true;
    } catch (error) {
      console.warn(`[Audio] 同平台插件重试异常: ${getErrorMessage(error)}`);
      return false;
    }
  };

  const handleFailure = async (
    song: Song,
    options: PlaySongOptions,
    requestId: number,
    shouldFade: boolean | null,
  ) => {
    const now = Date.now();
    const duplicate = !!(
      lastHandledFailure
      && lastHandledFailure.path === song.path
      && (lastHandledFailure.requestId === requestId || now - lastHandledFailure.handledAt < 3000)
    );
    if (duplicate) {
      console.warn('[Audio] 已忽略重复的在线播放失败处理:', {path: song.path, requestId});
    } else {
      lastHandledFailure = {path: song.path, requestId, handledAt: now};
      recentFailurePaths.set(song.path, now);
      pruneRecentFailurePaths(now);
    }

    try { await deps.playbackApi.stopAudio(); } catch {}
    if (shouldFade) {
      void deps.playbackApi.setVolume(deps.playbackStore.volume / 100).catch(() => {});
    }
    deps.setIsPlaying(false);
    deps.setIsSongLoaded(false);
    deps.stopPlaybackRuntime();
    console.error('[Audio] 在线音频播放失败');
    if (duplicate) return;

    const isSharePlayback = deps.isShareLinkPlaybackActive();
    const shareFailureBehavior = deps.settingsStore.settings.sharePlaybackFailureBehavior ?? 'pause';
    if (isSharePlayback && song.path.startsWith('lx://') && shareFailureBehavior === 'pause') {
      deps.showToast('分享歌曲播放失败，已暂停', 'error');
      return;
    }

    const failureBehavior = deps.settingsStore.settings.audio.onlineFailureBehavior ?? 'skip';
    const isPluginSong = song.path.startsWith('plugin://');
    const autoSwitchEnabled = failureBehavior === 'autoswitch';
    const allowAutoSwitch = (song.path.startsWith('lx://') || isPluginSong)
      && (autoSwitchEnabled || (isSharePlayback && shareFailureBehavior === 'replace'));
    if (allowAutoSwitch) {
      if (isPluginSong) {
        const switched = await trySiblingPluginPlayback(song, options, requestId);
        if (switched) return;
        if (requestId !== deps.getPlayRequestId() || deps.getCurrentSong()?.path !== song.path) return;
      }

      const switchContext = options._sourceSwitchCtx ?? {
        originKey: `${song.name}|${song.artist}`,
        failedSources: new Set<string>(),
      };
      switchContext.failedSources.add(getFailedOnlineSource(song));
      const alternativeSource = await findAlternativeOnlineSource(song, switchContext.failedSources);
      if (requestId !== deps.getPlayRequestId() || deps.getCurrentSong()?.path !== song.path) return;
      if (alternativeSource) {
        const {song: alternativeSong, source, displayName} = alternativeSource;
        if (!alternativeSong.cover_thumb_path && song.cover_thumb_path) alternativeSong.cover_thumb_path = song.cover_thumb_path;
        deps.showToast(`已自动切换到 ${displayName} 音源`, 'info');
        console.info(`[Audio] 自动换源成功: ${source}`);
        await deps.playSong(alternativeSong, {
          preserveQueue: true,
          _sourceSwitchCtx: switchContext,
          _siblingTriedPluginIds: options._siblingTriedPluginIds,
        });
        return;
      }
    }

    if (isSharePlayback) {
      deps.showToast('分享歌曲播放失败，未找到可替换音源', 'error');
      return;
    }
    if (allowAutoSwitch) {
      deps.showToast('已自动换源无果，请重试或更换音源', 'error');
      return;
    }
    if (failureBehavior !== 'skip') return;

    if (isPluginSong) {
      const withoutScheme = song.path.slice('plugin://'.length);
      const slashIndex = withoutScheme.indexOf('/');
      if (slashIndex >= 0) knownFailedPluginPrefixes.add(`plugin://${withoutScheme.slice(0, slashIndex + 1)}`);
    }

    const queueSongs = [...deps.playbackStore.tempQueue, ...deps.playbackStore.playQueue];
    const hasAlternativeQueueSong = queueSongs.some(item => item.path !== song.path && isLikelyPlayable(item));
    if (!hasAlternativeQueueSong) {
      if (knownFailedPluginPrefixes.size > 0 && queueSongs.every(item => !isLikelyPlayable(item) || item.path === song.path)) {
        deps.showToast('同步的在线歌曲在此设备上无法播放，请通过插件重新搜索添加', 'error');
      }
      console.warn('[Audio] 在线音频播放失败，但队列中没有其它未失败歌曲，停止而不是循环请求');
      return;
    }

    if (knownFailedPluginPrefixes.size > 0) {
      const failureTime = Date.now();
      for (const item of queueSongs) {
        if (item.path === song.path || !item.path.startsWith('plugin://')) continue;
        for (const prefix of knownFailedPluginPrefixes) {
          if (item.path.startsWith(prefix)) {
            recentFailurePaths.set(item.path, failureTime);
            break;
          }
        }
      }
    }
    setTimeout(() => {
      if (deps.getCurrentSong()?.path === song.path) deps.handleAutoNext();
    }, 400);
  };

  const reset = () => {
    lastHandledFailure = null;
    recentFailurePaths.clear();
    knownFailedPluginPrefixes.clear();
  };

  return {preflightKnownFailedPlugin, handleFailure, reset};
}
