import type { Ref } from 'vue';

import type { AppSettings } from '../../types';

/** 承载桌面歌词可见性持久化值的最小设置切面 */
type VisibilityCarrier = Pick<AppSettings, 'showDesktopLyrics'>;

/** 把持久化偏好套到运行时可见性 ref 上；两者已一致时不做任何写入 */
export function applyDesktopLyricsVisibilityPreference(visible: Ref<boolean>, preferredVisible: boolean) {
  if (visible.value !== preferredVisible) visible.value = preferredVisible;
}

/** 运行时可见性变化后回写设置；值未变时跳过，避免产生无谓补丁 */
export function persistDesktopLyricsVisibilityPreference(
  settings: VisibilityCarrier,
  patchSettings: (patch: VisibilityCarrier) => void, visible: boolean,
) {
  if (settings.showDesktopLyrics !== visible) patchSettings({ showDesktopLyrics: visible });
}
