import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  dlnaApi,
  isDlnaRemotePath,
  type DlnaDevicePayload,
  type DlnaMediaPayload,
} from '../../services/tauri/dlnaApi';
import { usePlaybackStore } from './store';
import { useSettingsStore } from '../settings/store';
import { useToast } from '../../composables/toast';

export interface DmrCommandPayload {
  type: 'loadUri' | 'play' | 'pause' | 'stop' | 'seek' | 'setVolume' | 'setMute';
  uri?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration_ms?: number;
  secs?: number;
  percent?: number;
  on?: boolean;
}

const TTL_REFRESH_MS = 8.5 * 60 * 1000;
const POLL_INTERVAL_MS = 1000;

interface CastMediaInfo {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  isRemote: boolean;
  url: string;
  headers: Record<string, string>;
  resolvedAtMs: number;
  token: string;
}

export const useDlnaCastStore = defineStore('dlnaCast', () => {
  const playbackStore = usePlaybackStore();
  const { showToast } = useToast();

  // ---------------- 发送端（DMC）状态 ----------------
  const phase = ref<'idle' | 'scanning' | 'connecting' | 'casting'>('idle');
  const devices = ref<DlnaDevicePayload[]>([]);
  const device = ref<DlnaDevicePayload | null>(null);
  const lastError = ref('');
  const tvPosition = ref(0);
  const tvDuration = ref(0);
  const tvState = ref('STOPPED');

  // ---------------- 接收端（DMR）状态 ----------------
  const rendererRunning = ref(false);
  const rendererName = ref('');
  const rendererPort = ref(0);

  const isCasting = computed(() => phase.value === 'casting' && device.value !== null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastPollAt = 0;
  let consecutiveErrors = 0;
  let currentCast: CastMediaInfo | null = null;
  let dmrUnlisten: UnlistenFn | null = null;
  let initialized = false;

  // ---------------- 设备发现 ----------------

  async function scanDevices(timeoutMs = 2500): Promise<DlnaDevicePayload[]> {
    const prevPhase = phase.value;
    if (prevPhase === 'idle') phase.value = 'scanning';
    try {
      const list = await dlnaApi.searchDevices(timeoutMs);
      devices.value = list;
      return list;
    } finally {
      if (phase.value === 'scanning') phase.value = prevPhase;
    }
  }

  // ---------------- 媒体载荷 ----------------

  function buildMediaPayload(cast: CastMediaInfo): DlnaMediaPayload {
    if (cast.isRemote) {
      return {
        kind: 'remote',
        url: cast.url,
        headers: cast.headers,
        resolved_at_ms: cast.resolvedAtMs,
      };
    }
    return { kind: 'local', path: cast.url };
  }

  function buildCoverPayload(cover: string): DlnaMediaPayload | null {
    const trimmed = (cover || '').trim();
    if (!trimmed || !isDlnaRemotePath(trimmed)) return null;
    return { kind: 'cover', url: trimmed };
  }

  // ---------------- 连接 / 断开 ----------------

  async function castFromPlayAudio(options: {
    path: string;
    title: string;
    artist: string;
    album: string;
    cover: string;
    duration: number;
    headers?: Record<string, string> | null;
    startOffsetMs?: number;
  }): Promise<void> {
    const dev = device.value;
    if (!dev) throw new Error('未连接投屏设备');
    if (!isCasting.value) phase.value = 'casting';

    const isRemote = isDlnaRemotePath(options.path);
    const info: CastMediaInfo = {
      title: options.title,
      artist: options.artist,
      album: options.album,
      durationMs: Math.max(0, Math.round((options.duration || 0) * 1000)),
      isRemote,
      url: options.path,
      headers: options.headers ?? {},
      resolvedAtMs: Date.now(),
      token: '',
    };

    const result = await dlnaApi.castSetUri({
      device: dev,
      media: buildMediaPayload(info),
      cover: buildCoverPayload(options.cover),
      title: info.title,
      artist: info.artist,
      album: info.album,
      durationMs: info.durationMs,
    });
    info.token = result.media_token;
    currentCast = info;
    await dlnaApi.castPlay(dev);
    const startSec = Math.max(0, (options.startOffsetMs ?? 0) / 1000);
    if (startSec > 0.5) {
      await dlnaApi.castSeek(dev, startSec).catch(() => {});
    }
    tvPosition.value = startSec;
    tvDuration.value = info.durationMs / 1000;
    tvState.value = 'PLAYING';
    startPolling();
  }

  async function connect(dev: DlnaDevicePayload): Promise<void> {
    phase.value = 'connecting';
    device.value = dev;
    try {
      const { playbackApi } = await import('../../services/tauri/playbackApi');
      if (playbackStore.isPlaying) {
        await playbackApi.pauseAudio().catch(() => {});
      }
      phase.value = 'casting';
      tvPosition.value = 0;
      tvDuration.value = 0;
      tvState.value = 'NO_MEDIA_PRESENT';
      lastError.value = '';
      startPolling();
    } catch (e) {
      phase.value = 'idle';
      device.value = null;
      throw e;
    }
  }

  async function disconnect(stopTv = true): Promise<void> {
    stopPolling();
    const dev = device.value;
    device.value = null;
    currentCast = null;
    phase.value = 'idle';
    tvState.value = 'STOPPED';
    if (dev && stopTv) {
      await dlnaApi.castStop(dev).catch(() => {});
    }
  }

  // ---------------- 遥控 ----------------

  async function castPlay(): Promise<void> {
    if (device.value) await dlnaApi.castPlay(device.value).catch(() => {});
  }
  async function castPause(): Promise<void> {
    if (device.value) await dlnaApi.castPause(device.value).catch(() => {});
  }
  async function castStop(): Promise<void> {
    await disconnect(true);
  }
  async function castSeek(secs: number): Promise<void> {
    if (!device.value) return;
    await dlnaApi.castSeek(device.value, Math.max(0, secs));
    lastPollAt = 0;
    await pollOnce();
  }
  async function castSetVolume(percent: number): Promise<void> {
    if (device.value) await dlnaApi.castSetVolume(device.value, Math.round(percent));
  }

  // ---------------- 状态轮询（驱动进度条 + TTL 续投） ----------------

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => { void pollOnce(); }, POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function interpolatedPosition(): number {
    const playing = tvState.value === 'PLAYING';
    const elapsed = playing && lastPollAt > 0 ? (Date.now() - lastPollAt) / 1000 : 0;
    return tvPosition.value + elapsed;
  }

  async function pollOnce(): Promise<void> {
    if (!device.value) {
      stopPolling();
      return;
    }
    try {
      const st = await dlnaApi.castGetState(device.value);
      consecutiveErrors = 0;
      tvPosition.value = Math.max(0, st.position_secs);
      tvDuration.value = Math.max(0, st.duration_secs);
      tvState.value = st.state;
      lastPollAt = Date.now();

      const cast = currentCast;
      if (
        cast?.isRemote
        && cast.token
        && Date.now() - cast.resolvedAtMs > TTL_REFRESH_MS
      ) {
        const refreshed = await dlnaApi
          .updateMediaToken(cast.token, {
            kind: 'remote',
            url: cast.url,
            headers: cast.headers,
            resolved_at_ms: Date.now(),
          })
          .catch(() => false);
        if (refreshed) cast.resolvedAtMs = Date.now();
      }
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 6) {
        stopPolling();
        phase.value = 'idle';
        device.value = null;
        currentCast = null;
        tvState.value = 'STOPPED';
        showToast('投屏设备连接已断开', 'error');
      }
    }
  }

  // ---------------- 接收端（DMR） ----------------

  async function setRendererEnabled(enabled: boolean, friendlyName: string, udn: string): Promise<void> {
    if (enabled) {
      const port = await dlnaApi.enableRenderer(friendlyName, udn);
      rendererRunning.value = true;
      rendererName.value = friendlyName;
      rendererPort.value = port;
    } else {
      await dlnaApi.disableRenderer();
      rendererRunning.value = false;
      rendererPort.value = 0;
    }
  }

  const RENDERER_UDN_KEY = 'dlna.renderer.udn';
  function getRendererUdn(): string {
    try {
      let udn = localStorage.getItem(RENDERER_UDN_KEY);
      if (!udn) {
        udn = `uuid:${crypto.randomUUID()}`;
        localStorage.setItem(RENDERER_UDN_KEY, udn);
      }
      return udn;
    } catch {
      return `uuid:${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  async function applyRendererSetting(): Promise<void> {
    const settingsStore = useSettingsStore();
    const enabled = settingsStore.settings.dlnaRendererEnabled;
    const name = settingsStore.settings.dlnaRendererName.trim();
    try {
      await setRendererEnabled(enabled, name, getRendererUdn());
    } catch (e) {
      console.warn('[dlna] 渲染器启停失败:', e);
      rendererRunning.value = false;
      rendererPort.value = 0;
    }
  }

  async function refreshRendererStatus(): Promise<void> {
    try {
      const st = await dlnaApi.rendererStatus();
      rendererRunning.value = st.running;
      rendererName.value = st.friendly_name;
      rendererPort.value = st.port;
    } catch {
      /* 渲染器未初始化时忽略 */
    }
  }

  // ---------------- DMR 指令分发 ----------------

  async function handleDmrCommand(cmd: DmrCommandPayload): Promise<void> {
    const { playbackApi } = await import('../../services/tauri/playbackApi');
    switch (cmd.type) {
      case 'loadUri': {
        const uri = (cmd.uri ?? '').trim();
        if (!isDlnaRemotePath(uri)) return;
        if (isCasting.value) await disconnect(false);
        await playbackApi.playAudio({
          path: uri,
          title: cmd.title || 'DLNA 投放',
          artist: cmd.artist || 'Unknown Artist',
          album: cmd.album || 'Unknown Album',
          cover: '',
          duration: Math.round((cmd.duration_ms ?? 0) / 1000),
          outputMode: 'shared',
        });
        break;
      }
      case 'play':
        await playbackApi.resumeAudio();
        break;
      case 'pause':
        await playbackApi.pauseAudio();
        break;
      case 'stop':
        await playbackApi.stopAudio();
        break;
      case 'seek':
        if (typeof cmd.secs === 'number') {
          await playbackApi.seekAudio({
            time: cmd.secs,
            isPlaying: playbackStore.isPlaying,
            requestId: Date.now(),
          });
        }
        break;
      case 'setVolume':
        if (typeof cmd.percent === 'number') {
          await playbackApi.setVolume(Math.max(0, Math.min(100, cmd.percent)) / 100);
          playbackStore.volume = Math.max(0, Math.min(100, cmd.percent));
        }
        break;
      case 'setMute':
        await playbackApi.setVolume(cmd.on ? 0 : 1);
        break;
    }
  }

  // ---------------- 初始化 ----------------

  async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;
    try {
      dmrUnlisten = await listen<DmrCommandPayload>('dlna:dmr-command', (event) => {
        void handleDmrCommand(event.payload).catch((e) => {
          console.warn('[dlna] DMR 指令执行失败:', e);
        });
      });
    } catch (e) {
      console.warn('[dlna] 注册 DMR 指令监听失败:', e);
    }
    await applyRendererSetting();
  }

  function dispose(): void {
    stopPolling();
    dmrUnlisten?.();
    dmrUnlisten = null;
    initialized = false;
  }

  return {
    phase,
    devices,
    device,
    lastError,
    tvPosition,
    tvDuration,
    tvState,
    rendererRunning,
    rendererName,
    rendererPort,
    isCasting,
    scanDevices,
    connect,
    disconnect,
    castFromPlayAudio,
    castPlay,
    castPause,
    castStop,
    castSeek,
    castSetVolume,
    interpolatedPosition,
    setRendererEnabled,
    applyRendererSetting,
    refreshRendererStatus,
    init,
    dispose,
  };
});
