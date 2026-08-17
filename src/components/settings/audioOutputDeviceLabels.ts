import type { AudioDevice, AudioOutputStatus } from '../../services/tauri/contracts';

export interface AudioOutputDeviceOption {
  id: string;
  name: string;
}

export const buildAudioOutputDeviceOptions = (
  devices: AudioDevice[],
  defaultDeviceName = '系统默认',
): AudioOutputDeviceOption[] => [
  { id: '', name: defaultDeviceName },
  ...devices.map(device => ({
    id: device.id,
    name: device.name,
  })),
];

export const getSelectedOutputDeviceLabel = (
  options: AudioOutputDeviceOption[],
  selectedDeviceId: string,
  _status: AudioOutputStatus | null,
  defaultDeviceName = '系统默认',
) => {
  return options.find(device => device.id === selectedDeviceId)?.name ?? defaultDeviceName;
};
