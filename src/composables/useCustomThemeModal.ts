import { type Ref, ref } from 'vue';
import { open as showMediaPicker } from '@tauri-apps/plugin-dialog';

import { createDefaultThemeSettings, normalizeForegroundStyle, type ThemeSettingsPatch } from '../features/settings/store';
import { tauriInvoke } from '../services/tauri/invoke';
import type { ThemeSettings } from '../types';
import { useThemeSettings } from './useThemeSettings';

/** 皮肤弹窗弹出那一刻的完整主题快照；用户取消时据此整体回滚 */
export const skinModalOriginalTheme = ref<ThemeSettings | null>(null);

/** 进入自定义皮肤时必须同步关掉动态背景与窗口材质，避免多层背景叠加渲染 */
const CUSTOM_MODE_BASE = { mode: 'custom', dynamicBgType: 'none', windowMaterial: 'none' } as const;

type SkinMediaType = 'image' | 'video';

interface MediaPickerFilter {
  label: string;
  extensions: string[];
}

const IMAGE_FILTER: MediaPickerFilter = { label: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] };
const VIDEO_FILTER: MediaPickerFilter = { label: 'Video', extensions: ['mp4', 'webm', 'mov'] };

/** 打开系统文件选择框；用户取消或对话框异常时统一按 null 处理 */
async function browseLocalMedia(filter: MediaPickerFilter): Promise<string | null> {
  const dialog = await showMediaPicker({
    multiple: false,
    filters: [{ name: filter.label, extensions: [...filter.extensions] }],
  }).catch(() => null);

  return typeof dialog === 'string' ? dialog : null;
}

/** 把选中的媒体拷入皮肤缓存目录；跨界复制失败时退回原始路径直接预览 */
function importMediaIntoSkinCache(absolutePath: string): Promise<string> {
  return tauriInvoke('import_skin_image', { sourcePath: absolutePath }).catch(() => absolutePath);
}

/** 以当前主题为底稿生成预览草稿，前景样式先做归一化再落入草稿 */
function snapshotThemePreview(source: ThemeSettings): ThemeSettings['customBackground'] {
  const background = source.customBackground;
  return {
    ...background,
    foregroundStyle: normalizeForegroundStyle(background.foregroundStyle),
  };
}

function toCustomModePatch(draft: ThemeSettings['customBackground']): ThemeSettingsPatch {
  return { ...CUSTOM_MODE_BASE, customBackground: draft };
}

export const useCustomThemeModal = () => {
  const { theme, patchTheme, replaceTheme } = useThemeSettings();
  const previewDraft: Ref<ThemeSettings['customBackground']> = ref(snapshotThemePreview(theme.value));

  const hasPickedMedia = () => Boolean(previewDraft.value.imagePath);

  const pickMedia = async (kind: SkinMediaType) => {
    const chosenPath = await browseLocalMedia(kind === 'image' ? IMAGE_FILTER : VIDEO_FILTER);
    if (chosenPath !== null) {
      previewDraft.value.imagePath = await importMediaIntoSkinCache(chosenPath);
      previewDraft.value.mediaType = kind;
    }
  };

  const handleSelectImage = () => pickMedia('image');
  const handleSelectVideo = () => pickMedia('video');

  /** 恢复默认：调整参数回到出厂值；保留已选背景媒体，避免误清用户刚挑的图 */
  const resetToDefaults = () => {
    const defaults = createDefaultThemeSettings().customBackground;
    previewDraft.value = {
      ...defaults,
      imagePath: previewDraft.value.imagePath,
      mediaType: previewDraft.value.mediaType,
    };
  };

  const commitDraft = () => {
    if (!hasPickedMedia()) return;
    patchTheme(toCustomModePatch({ ...previewDraft.value }));
    skinModalOriginalTheme.value = null;
  };

  const restoreSavedTheme = () => {
    const savedTheme = skinModalOriginalTheme.value;
    if (savedTheme) {
      replaceTheme(savedTheme);
      skinModalOriginalTheme.value = null;
    }
  };

  return {
    preview: previewDraft,
    handleSelectImage,
    handleSelectVideo,
    resetToDefaults,
    handleCancel: restoreSavedTheme,
    handleSave: commitDraft,
  };
};
