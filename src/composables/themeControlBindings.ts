// 主题控件绑定工厂：把「读取 theme 快照字段 + 提交单键补丁」的样板逻辑
// 收敛到一处数据驱动实现，供 useSettingsThemeControls 批量装配字段绑定。
import { computed, type WritableComputedRef } from 'vue';

import type { ThemeSettingsPatch } from '../features/settings/store';
import type { ThemeSettings } from '../types';

/** 读取当前主题快照（由调用方注入 getter，保持响应式追踪） */
export type ThemeSnapshotReader = () => ThemeSettings;
/** 向设置存储提交主题补丁 */
export type ThemePatchSink = (patch: ThemeSettingsPatch) => void;

/** 允许通过单键补丁直写的主题字段；customBackground 需独立编辑器，不在其列 */
type DirectPatchableThemeKey = Exclude<keyof ThemeSettings, 'customBackground'>;

interface ThemeFieldBindingOptions<K extends DirectPatchableThemeKey> {
  /** 待绑定的 theme 字段名 */
  key: K;
  /** 旧存档缺字段时的读取兜底（如 useGlassSwitch 缺省为 false） */
  absentValue?: ThemeSettings[K];
}

/**
 * 构造 theme 字段的双向绑定：读取走快照字段（可带缺省兜底），
 * 写入提交单键补丁，由设置存储完成合并与持久化。
 */
export function createThemeFieldBinding<K extends DirectPatchableThemeKey>(
  readSnapshot: ThemeSnapshotReader,
  submitPatch: ThemePatchSink,
  options: ThemeFieldBindingOptions<K>,
): WritableComputedRef<ThemeSettings[K]> {
  const { key, absentValue } = options;

  return computed<ThemeSettings[K]>({
    get: () => (readSnapshot()[key] ?? absentValue) as ThemeSettings[K],
    set: (incoming: ThemeSettings[K]) => {
      submitPatch({ [key]: incoming } as unknown as ThemeSettingsPatch);
    },
  });
}

/** 统一按 0-100 整数滑杆语义写入的数值字段集合 */
export type PercentThemeFieldKey =
  | 'flowColorBoost'
  | 'flowDepth'
  | 'flowSpeed'
  | 'flowTexture'
  | 'windowBlurTint';

/**
 * 把越界输入收拢为 0-100 整数后写入对应数值字段；
 * 流光四项调节与遮罩浓度共用同一取值域。
 */
export function submitPercentThemeField(
  submitPatch: ThemePatchSink,
  key: PercentThemeFieldKey,
  rawValue: number,
): void {
  const percent = Math.round(Math.min(100, Math.max(0, rawValue)));
  const envelopes: Record<PercentThemeFieldKey, ThemeSettingsPatch> = {
    flowColorBoost: { flowColorBoost: percent },
    flowDepth: { flowDepth: percent },
    flowSpeed: { flowSpeed: percent },
    flowTexture: { flowTexture: percent },
    windowBlurTint: { windowBlurTint: percent },
  };

  submitPatch(envelopes[key]);
}
