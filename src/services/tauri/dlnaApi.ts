// DLNA 双向投屏 Tauri 命令封装（对应 Rust dlna/commands.rs）。
import { tauriInvoke } from './invoke';
import type {
  DlnaCastMediaInfo,
  DlnaCastTransportState,
  DlnaDevicePayload,
  DlnaMediaPayload,
  DlnaRendererStatus,
} from './contracts';

export type {
  DlnaCastMediaInfo,
  DlnaCastTransportState,
  DlnaDevicePayload,
  DlnaMediaPayload,
  DlnaRendererStatus,
} from './contracts';

export const dlnaApi = {
  searchDevices: (timeoutMs = 2500): Promise<DlnaDevicePayload[]> =>
    tauriInvoke('dlna_search_devices', { timeoutMs }),
  castSetUri: (args: {
    device: DlnaDevicePayload;
    media: DlnaMediaPayload;
    cover: DlnaMediaPayload | null;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
  }): Promise<DlnaCastMediaInfo> => tauriInvoke('dlna_cast_set_uri', args),
  castPlay: (device: DlnaDevicePayload): Promise<void> =>
    tauriInvoke('dlna_cast_play', { device }),
  castPause: (device: DlnaDevicePayload): Promise<void> =>
    tauriInvoke('dlna_cast_pause', { device }),
  castStop: (device: DlnaDevicePayload): Promise<void> =>
    tauriInvoke('dlna_cast_stop', { device }),
  castSeek: (device: DlnaDevicePayload, secs: number): Promise<void> =>
    tauriInvoke('dlna_cast_seek', { device, secs }),
  castSetVolume: (device: DlnaDevicePayload, percent: number): Promise<void> =>
    tauriInvoke('dlna_cast_set_volume', { device, percent }),
  castGetState: (device: DlnaDevicePayload): Promise<DlnaCastTransportState> =>
    tauriInvoke('dlna_cast_get_state', { device }),
  updateMediaToken: (token: string, payload: DlnaMediaPayload): Promise<boolean> =>
    tauriInvoke('dlna_update_media_token', { token, payload }),
  enableRenderer: (friendlyName: string, udn: string): Promise<number> =>
    tauriInvoke('dlna_enable_renderer', { friendlyName, udn }),
  disableRenderer: (): Promise<void> => tauriInvoke('dlna_disable_renderer', undefined),
  rendererStatus: (): Promise<DlnaRendererStatus> =>
    tauriInvoke('dlna_renderer_status', undefined),
};

/** 判断路径是否为在线直链（http/https）。 */
export function isDlnaRemotePath(path: string): boolean {
  const idx = path.indexOf('http://') >= 0 ? path.indexOf('http://') : path.indexOf('https://');
  return idx === 0;
}
