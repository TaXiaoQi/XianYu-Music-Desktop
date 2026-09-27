import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

import { desktopLinkApi } from '../../services/tauri/desktopLinkApi';
import { playbackApi } from '../../services/tauri/playbackApi';
import { usePlaybackStore } from './store';

export interface DesktopControlCmdPayload {
  id: number;
  action: string;
  arg?: { pos?: number; v?: number } | null;
}

export interface DesktopControlClientPayload {
  connected: boolean;
  id: number;
  name: string;
}

/// 进度推送节流（移动端进度条 1s 粒度足够）。
const POSITION_PUSH_MIN_INTERVAL_MS = 900;
/// 新客户端握手完成后回灌快照的延迟（等其状态监听就绪）。
const SNAPSHOT_DELAY_MS = 300;

/**
 * 桌面 TCP 控制通道语义层：
 * - 指令下行：Rust 发 `desktop-control-cmd` → 这里映射为播放动作
 *   （toggle 直接走 playbackApi；next/prev 复用 taskbar/SMTC 的 player:* 事件）。
 * - 状态上行：watch 播放状态经 desktopLinkApi.push* 广播给所有在线遥控端。
 */
export const useDesktopLinkStore = defineStore('desktopLink', () => {
  const playbackStore = usePlaybackStore();

  /** 当前在线的遥控端（由 desktop-control-client 事件维护）。 */
  const connectedClients = ref<{ id: number; name: string }[]>([]);

  const hasConnectedClients = computed(() => connectedClients.value.length > 0);

  let unlistenFns: UnlistenFn[] = [];
  let stopWatchers: (() => void) | null = null;
  let initialized = false;
  let lastPositionPushAt = 0;

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  function pushState(): void {
    if (!hasConnectedClients.value) return;
    void desktopLinkApi
      .pushState(playbackStore.isPlaying, clamp01(playbackStore.volume / 100))
      .catch(() => {});
  }

  function pushNowPlaying(): void {
    if (!hasConnectedClients.value) return;
    const song = playbackStore.currentSong;
    if (!song) return;
    void desktopLinkApi
      .pushNowPlaying({
        id: song.id != null ? String(song.id) : song.path,
        title: song.title || song.name || '未知曲目',
        artist: song.effective_artist_names?.length
          ? song.effective_artist_names.join(' / ')
          : song.artist || '未知歌手',
        album: song.album || '未知专辑',
        duration: Math.max(0, Math.floor(song.duration || 0)),
      })
      .catch(() => {});
  }

  function pushPosition(force = false): void {
    if (!hasConnectedClients.value) return;
    if (!force) {
      const now = Date.now();
      if (now - lastPositionPushAt < POSITION_PUSH_MIN_INTERVAL_MS) return;
      lastPositionPushAt = now;
    }
    const song = playbackStore.currentSong;
    void desktopLinkApi
      .pushPosition(
        Math.max(0, playbackStore.currentTime || 0),
        Math.max(0, Math.floor(song?.duration || 0)),
      )
      .catch(() => {});
  }

  /** 完整状态快照（新客户端接入时回灌）。 */
  function pushSnapshot(): void {
    pushState();
    pushNowPlaying();
    pushPosition(true);
  }

  async function handleCmd(cmd: DesktopControlCmdPayload): Promise<void> {
    switch (cmd.action) {
      case 'toggle':
        if (playbackStore.isPlaying) {
          await playbackApi.pauseAudio();
        } else {
          await playbackApi.resumeAudio();
        }
        break;
      case 'next':
        void emit('player:next');
        break;
      case 'prev':
        void emit('player:prev');
        break;
      case 'seek': {
        const pos = cmd.arg?.pos;
        if (typeof pos === 'number' && Number.isFinite(pos) && pos >= 0) {
          await playbackApi.seekAudio({
            time: pos,
            isPlaying: playbackStore.isPlaying,
            requestId: Date.now(),
          });
        }
        break;
      }
      case 'volume': {
        const v = cmd.arg?.v;
        if (typeof v === 'number' && Number.isFinite(v)) {
          const percent = Math.round(clamp01(v) * 100);
          await playbackApi.setVolume(percent / 100);
          playbackStore.volume = percent;
        }
        break;
      }
      default:
        // like/dislike/mode/fx 桌面端暂不支持，静默忽略
        break;
    }
  }

  /** 连接/断开事件入账；新接入时回灌快照。 */
  function applyClientEvent(payload: DesktopControlClientPayload): void {
    const rest = connectedClients.value.filter((c) => c.id !== payload.id);
    connectedClients.value = payload.connected
      ? [...rest, { id: payload.id, name: payload.name }]
      : rest;
    if (payload.connected) {
      setTimeout(pushSnapshot, SNAPSHOT_DELAY_MS);
    }
  }

  async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;
    try {
      unlistenFns.push(
        await listen<DesktopControlClientPayload>('desktop-control-client', (event) => {
          applyClientEvent(event.payload);
        }),
      );
      unlistenFns.push(
        await listen<DesktopControlCmdPayload>('desktop-control-cmd', (event) => {
          void handleCmd(event.payload).catch((e) => {
            console.warn('[desktop-link] 遥控指令执行失败:', e);
          });
        }),
      );
    } catch (e) {
      console.warn('[desktop-link] 注册事件监听失败:', e);
    }

    const stopIsPlaying = watch(() => playbackStore.isPlaying, () => pushState());
    const stopVolume = watch(() => playbackStore.volume, () => pushState());
    const stopSong = watch(() => playbackStore.currentSong, () => {
      pushNowPlaying();
      pushPosition(true);
    });
    const stopTime = watch(() => playbackStore.currentTime, () => pushPosition());
    stopWatchers = () => {
      stopIsPlaying();
      stopVolume();
      stopSong();
      stopTime();
    };
  }

  function dispose(): void {
    for (const unlisten of unlistenFns) unlisten();
    unlistenFns = [];
    stopWatchers?.();
    stopWatchers = null;
    initialized = false;
    connectedClients.value = [];
  }

  return {
    connectedClients,
    hasConnectedClients,
    init,
    dispose,
    handleCmd,
    applyClientEvent,
    pushSnapshot,
  };
});
