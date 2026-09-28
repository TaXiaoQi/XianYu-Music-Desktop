import { computed, ref } from 'vue';

import {
  normalizeLyricsSyncOffsetMs,
} from '../../../features/settings/lyricsSyncOffset';
import { useSettings } from '../../../features/settings/useSettings';

/**
 * 歌词同步偏移面板的状态与读写：
 * 毫秒值以 5ms 步进归一后落到 settings.lyricsSyncOffset（秒）。
 */
export function useLyricsSyncOffset() {
  const { settings } = useSettings();

  const panelOpen = ref(false);

  const offsetMs = computed({
    get: () => normalizeLyricsSyncOffsetMs(settings.value.lyricsSyncOffset * 1000),
    set: (incoming: number | string) => {
      const numeric = typeof incoming === 'string' ? Number(incoming) : incoming;
      settings.value.lyricsSyncOffset = normalizeLyricsSyncOffsetMs(numeric) / 1000;
    },
  });

  const offsetText = computed(() => {
    const value = offsetMs.value;
    if (value === 0) return '0 ms';
    return `${value > 0 ? '+' : ''}${value} ms`;
  });

  function adjust(delta: number) {
    offsetMs.value = offsetMs.value + delta;
  }

  function reset() {
    offsetMs.value = 0;
  }

  function onFieldChange(event: Event) {
    const field = event.target as HTMLInputElement;
    const numeric = normalizeLyricsSyncOffsetMs(Number(field.value));
    field.value = String(numeric);
    offsetMs.value = numeric;
  }

  return { panelOpen, offsetMs, offsetText, adjust, reset, onFieldChange };
}
