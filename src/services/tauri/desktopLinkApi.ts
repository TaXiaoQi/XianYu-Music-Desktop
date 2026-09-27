import { tauriInvoke } from './invoke';
import type {
  ControlChannelStatus,
  ControlPairingCodeInfo,
} from './contracts';

export type {
  ControlChannelClientEntry,
  ControlChannelDeviceEntry,
  ControlChannelStatus,
  ControlPairingCodeInfo,
} from './contracts';

export interface DesktopNowPlayingPayload {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export const desktopLinkApi = {
  status: (): Promise<ControlChannelStatus> =>
    tauriInvoke('control_channel_status', undefined),
  setEnabled: (enabled: boolean): Promise<void> =>
    tauriInvoke('control_channel_set_enabled', { enabled }),
  refreshPairingCode: (): Promise<ControlPairingCodeInfo> =>
    tauriInvoke('control_channel_refresh_pairing_code', undefined),
  forgetDevice: (token: string): Promise<boolean> =>
    tauriInvoke('control_channel_forget_device', { token }),
  pushState: (isPlaying: boolean, volume: number): Promise<void> =>
    tauriInvoke('control_channel_push_state', { isPlaying, volume }),
  pushNowPlaying: (media: DesktopNowPlayingPayload): Promise<void> =>
    tauriInvoke('control_channel_push_now_playing', media),
  pushPosition: (pos: number, duration: number): Promise<void> =>
    tauriInvoke('control_channel_push_position', { pos, duration }),
};
