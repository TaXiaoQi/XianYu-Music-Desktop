import type {
    AudioDevice,
    AudioOutputStatus,
} from "../../services/tauri/contracts";

export interface AudioOutputDeviceOption {
    id: string;
    name: string;
}

/** Label shown for the implicit "follow the OS default" pseudo-device. */
const BUILTIN_DEVICE_NAME = "系统默认";

export function buildAudioOutputDeviceOptions(
    devices: AudioDevice[],
    builtinName: string = BUILTIN_DEVICE_NAME,
): AudioOutputDeviceOption[] {
    const builtinEntry: AudioOutputDeviceOption = { id: "", name: builtinName };
    const hardwareEntries = devices.map((item) => ({
        id: item.id,
        name: item.name,
    }));
    return [builtinEntry, ...hardwareEntries];
}

export function getSelectedOutputDeviceLabel(
    options: AudioOutputDeviceOption[],
    selectedDeviceId: string,
    _status: AudioOutputStatus | null,
    builtinName: string = BUILTIN_DEVICE_NAME,
): string {
    const hit = options.find((entry) => entry.id === selectedDeviceId);
    return hit ? hit.name : builtinName;
}
