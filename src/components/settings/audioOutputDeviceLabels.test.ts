import { it, describe, expect } from 'vitest';

import type { AudioOutputStatus as OutputStatusContract } from '../../services/tauri/contracts';
import { getSelectedOutputDeviceLabel as getSelectedLabel, buildAudioOutputDeviceOptions as buildDeviceOptions } from './audioOutputDeviceLabels';

// 行为规格（逐字冻结）：系统默认状态的快照输入。
const systemDefaultStatus: OutputStatusContract = {
  selected_device_id: null,
  active_device_name: '扬声器 (CX31993 HIFI Audio)',
  follows_system_default: true,
  requested_output_mode: 'shared',
  active_output_mode: 'shared',
  fallback_reason: null,
};

describe('音频输出设备标签', () => {
  it('跟随系统默认策略时，选中项标签落回内置的系统默认设备', () => {
    const options = buildDeviceOptions([
      { id: '扬声器 (CX31993 HIFI Audio)', name: '扬声器 (CX31993 HIFI Audio)' },
    ]);

    expect(getSelectedLabel(options, '', systemDefaultStatus)).toBe('系统默认');
  });
});
