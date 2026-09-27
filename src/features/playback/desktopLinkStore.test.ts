import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import { useDesktopLinkStore } from './desktopLinkStore';
import { usePlaybackStore } from './store';

// ---------------- tauri 事件桩 ----------------

type ListenHandler = (event: { payload: unknown }) => void;

const eventListeners = new Map<string, ListenHandler>();
const emitSpy = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: ListenHandler) => {
    eventListeners.set(name, handler);
    return () => eventListeners.delete(name);
  }),
  emit: (...args: unknown[]) => emitSpy(...args),
}));

// ---------------- tauri invoke 桩（desktopLinkApi / playbackApi） ----------------

const pushStateSpy = vi.fn();
const pushNowPlayingSpy = vi.fn();
const pushPositionSpy = vi.fn();

vi.mock('../../services/tauri/desktopLinkApi', () => ({
  desktopLinkApi: {
    pushState: (...args: unknown[]) => {
      pushStateSpy(...args);
      return Promise.resolve();
    },
    pushNowPlaying: (...args: unknown[]) => {
      pushNowPlayingSpy(...args);
      return Promise.resolve();
    },
    pushPosition: (...args: unknown[]) => {
      pushPositionSpy(...args);
      return Promise.resolve();
    },
  },
}));

const pauseAudioSpy = vi.fn();
const resumeAudioSpy = vi.fn();
const seekAudioSpy = vi.fn();
const setVolumeSpy = vi.fn();

vi.mock('../../services/tauri/playbackApi', () => ({
  playbackApi: {
    pauseAudio: () => {
      pauseAudioSpy();
      return Promise.resolve();
    },
    resumeAudio: () => {
      resumeAudioSpy();
      return Promise.resolve();
    },
    seekAudio: (options: unknown) => {
      seekAudioSpy(options);
      return Promise.resolve();
    },
    setVolume: (v: number) => {
      setVolumeSpy(v);
      return Promise.resolve();
    },
  },
}));

const demoSong = {
  path: '/music/demo.flac',
  name: 'demo.flac',
  title: 'Demo',
  artist: 'Artist A / Artist B',
  artist_names: ['Artist A', 'Artist B'],
  effective_artist_names: ['Artist A', 'Artist B'],
  album: 'Album',
  album_artist: 'Artist A',
  album_key: 'Album::Artist A',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 200,
};

function fireClientEvent(payload: {
  connected: boolean;
  id: number;
  name: string;
}): void {
  const handler = eventListeners.get('desktop-control-client');
  if (handler) handler({ payload });
}

async function fireCmd(action: string, arg?: unknown): Promise<void> {
  const handler = eventListeners.get('desktop-control-cmd');
  if (!handler) throw new Error('desktop-control-cmd 未注册监听');
  handler({ payload: { id: 1, action, arg: arg ?? null } });
  await Promise.resolve();
  await Promise.resolve();
}

describe('desktopLinkStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventListeners.clear();
    setActivePinia(createPinia());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  it('handles toggle/next/prev/seek/volume commands', async () => {
    const store = useDesktopLinkStore();
    await store.init();
    expect(eventListeners.has('desktop-control-cmd')).toBe(true);

    const playback = usePlaybackStore();

    // toggle：未播放 → resume
    await fireCmd('toggle');
    expect(resumeAudioSpy).toHaveBeenCalledTimes(1);

    // toggle：播放中 → pause
    playback.isPlaying = true;
    await fireCmd('toggle');
    expect(pauseAudioSpy).toHaveBeenCalledTimes(1);

    // next/prev → player:* 事件（复用 taskbar/SMTC 通道）
    await fireCmd('next');
    await fireCmd('prev');
    expect(emitSpy).toHaveBeenNthCalledWith(1, 'player:next');
    expect(emitSpy).toHaveBeenNthCalledWith(2, 'player:prev');

    // seek
    await fireCmd('seek', { pos: 42.5 });
    expect(seekAudioSpy).toHaveBeenCalledWith(
      expect.objectContaining({ time: 42.5 }),
    );

    // volume：0..1 → 0..100
    await fireCmd('volume', { v: 0.35 });
    expect(setVolumeSpy).toHaveBeenCalledWith(0.35);
    expect(playback.volume).toBe(35);

    // 非法 action 静默忽略
    await fireCmd('fx', { v: 1 });
    await fireCmd('like');
    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('tracks client connect/disconnect and pushes snapshot on connect', async () => {
    const store = useDesktopLinkStore();
    await store.init();

    fireClientEvent({ connected: true, id: 7, name: '我的手机' });
    expect(store.connectedClients).toEqual([{ id: 7, name: '我的手机' }]);
    // 快照延迟回灌
    expect(pushStateSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(pushStateSpy).toHaveBeenCalled();

    // 重复 connect 同 id 去重
    fireClientEvent({ connected: true, id: 7, name: '我的手机' });
    expect(store.connectedClients).toHaveLength(1);

    fireClientEvent({ connected: false, id: 7, name: '我的手机' });
    expect(store.connectedClients).toEqual([]);
  });

  it('only pushes state watchers when clients are online', async () => {
    const store = useDesktopLinkStore();
    await store.init();
    const playback = usePlaybackStore();

    // 无客户端在线：状态变化不推送
    playback.isPlaying = true;
    await nextTick();
    expect(pushStateSpy).not.toHaveBeenCalled();

    fireClientEvent({ connected: true, id: 3, name: '腕表' });
    vi.advanceTimersByTime(400);
    const snapshotCalls = pushStateSpy.mock.calls.length;
    expect(snapshotCalls).toBeGreaterThan(0);

    // 在线时 isPlaying/volume 变化 → pushState(isPlaying, volume0..1)
    playback.volume = 50;
    await nextTick();
    expect(pushStateSpy).toHaveBeenLastCalledWith(true, 0.5);
    expect(pushStateSpy.mock.calls.length).toBe(snapshotCalls + 1);
  });

  it('pushes now playing on song change', async () => {
    const store = useDesktopLinkStore();
    await store.init();
    const playback = usePlaybackStore();

    fireClientEvent({ connected: true, id: 3, name: '腕表' });
    vi.advanceTimersByTime(400);

    playback.currentSong = demoSong as never;
    await nextTick();
    expect(pushNowPlayingSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: demoSong.path,
        title: 'Demo',
        artist: 'Artist A / Artist B',
        album: 'Album',
        duration: 200,
      }),
    );
  });

  it('throttles position pushes', async () => {
    const store = useDesktopLinkStore();
    await store.init();
    const playback = usePlaybackStore();

    fireClientEvent({ connected: true, id: 3, name: '腕表' });
    vi.advanceTimersByTime(400);
    pushPositionSpy.mockClear();

    playback.currentTime = 1;
    await nextTick();
    expect(pushPositionSpy).toHaveBeenCalledTimes(1);
    expect(pushPositionSpy).toHaveBeenLastCalledWith(1, 0);

    // 节流窗口内的连续变化只推一次
    await vi.advanceTimersByTimeAsync(100);
    playback.currentTime = 2;
    await nextTick();
    await vi.advanceTimersByTimeAsync(100);
    playback.currentTime = 3;
    await nextTick();
    expect(pushPositionSpy).toHaveBeenCalledTimes(1);

    // 窗口过后恢复推送
    await vi.advanceTimersByTimeAsync(1000);
    playback.currentTime = 4;
    await nextTick();
    expect(pushPositionSpy).toHaveBeenCalledTimes(2);
    expect(pushPositionSpy).toHaveBeenLastCalledWith(4, 0);
  });
});
