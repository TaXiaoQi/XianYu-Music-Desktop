import type { AudioDevice, AudioOutputStatus } from '../../services/tauri/contracts';

export interface AudioOutputDeviceOption {
  id: string;
  name: string;
}

export const buildAudioOutputDeviceOptions = (devices: AudioDevice[]): AudioOutputDeviceOption[] => [
  { id: '', name: '系统默认' },
  ...devices.map(device => ({
    id: device.id,
    name: device.name,
  })),
];

export const getSelectedOutputDeviceLabel = (
  options: AudioOutputDeviceOption[],
  selectedDeviceId: string,
  _status: AudioOutputStatus | null,
) => {
  return options.find(device => device.id === selectedDeviceId)?.name ?? '系统默认';
};
