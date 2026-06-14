import { describe, expect, it } from 'vitest';

import {
  buildAudioOutputDeviceOptions,
  getSelectedOutputDeviceLabel,
} from './audioOutputDeviceLabels';
import type { AudioOutputStatus } from '../../services/tauri/contracts';

const systemDefaultStatus: AudioOutputStatus = {
  selected_device_id: null,
  active_device_name: '扬声器 (CX31993 HIFI Audio)',
  follows_system_default: true,
  requested_output_mode: 'shared',
  active_output_mode: 'shared',
  fallback_reason: null,
};

describe('audio output device labels', () => {
  it('keeps system default as the selected policy', () => {
    const options = buildAudioOutputDeviceOptions([
      { id: '扬声器 (CX31993 HIFI Audio)', name: '扬声器 (CX31993 HIFI Audio)' },
    ]);

    expect(getSelectedOutputDeviceLabel(options, '', systemDefaultStatus)).toBe('系统默认');
  });
});
