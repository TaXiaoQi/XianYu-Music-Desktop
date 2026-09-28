import { computed } from 'vue';
import { defineStore } from 'pinia';

import type { AppSettings, DesktopLyricsSettings, LyricsSettings } from '../../types';
import { useSettingsStore, type AppSettingsPatch } from '../settings/store';

export type LyricsSettingsPatch = Partial<LyricsSettings>;

export type DesktopLyricsSettingsPatch = Partial<DesktopLyricsSettings>;

/** 全局设置中归属歌词域的两个切片键 */
type LyricsOwnedSliceKey = 'lyrics' | 'desktopLyrics';

/**
 * 歌词与桌面歌词设置本质上是全局设置中的两个切片：
 * 读取侧做响应式镜像，写入侧原样转发给 settings store 的补丁入口。
 */
function adaptSettingsSlice<K extends LyricsOwnedSliceKey>(
  upstream: ReturnType<typeof useSettingsStore>,
  slice: K,
) {
  const read = computed(() => upstream.settings[slice]);
  const write = (value: Partial<AppSettings[K]>) => {
    upstream.patchSettings({ [slice]: value } as unknown as AppSettingsPatch);
  };
  return { read, write };
}

export const useLyricsSettingsStore = defineStore('lyrics-settings', () => {
  const settingsStore = useSettingsStore();
  const lyricsSlice = adaptSettingsSlice(settingsStore, 'lyrics');
  const desktopSlice = adaptSettingsSlice(settingsStore, 'desktopLyrics');

  return {
    lyricsSettings: lyricsSlice.read,
    desktopLyricsSettings: desktopSlice.read,
    patchLyricsSettings: (patch: LyricsSettingsPatch) => lyricsSlice.write(patch),
    patchDesktopLyricsSettings: (patch: DesktopLyricsSettingsPatch) => desktopSlice.write(patch),
    replaceLyricsSettings: (next: LyricsSettings) => lyricsSlice.write(next),
    replaceDesktopLyricsSettings: (next: DesktopLyricsSettings) => desktopSlice.write(next),
  };
});
