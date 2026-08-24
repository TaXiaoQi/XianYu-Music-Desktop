import { open } from '@tauri-apps/plugin-dialog';
import { ref } from 'vue';

import { normalizeForegroundStyle } from '../features/settings/store';
import type { ThemeSettings } from '../types';
import { useThemeSettings } from './useThemeSettings';

// 顶栏皮肤快捷键打开弹窗前保存的原始主题；取消时恢复配色方案与窗口材质
export const skinModalOriginalTheme = ref<ThemeSettings | null>(null);

export function useCustomThemeModal() {
  const { theme, patchTheme, replaceTheme } = useThemeSettings();
  const preview = ref({
    ...theme.value.customBackground,
    foregroundStyle: normalizeForegroundStyle(theme.value.customBackground.foregroundStyle),
  });

  const handleSelectImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });

      if (selected && typeof selected === 'string') {
        preview.value.imagePath = selected;
      }
    } catch {
      // Ignore dialog cancellation.
    }
  };

  const handleSave = () => {
    if (!preview.value.imagePath) {
      return;
    }

    patchTheme({
      mode: 'custom',
      dynamicBgType: 'none',
      windowMaterial: 'none',
      customBackground: { ...preview.value },
    });
    skinModalOriginalTheme.value = null;
  };

  const handleCancel = () => {
    if (skinModalOriginalTheme.value) {
      replaceTheme(skinModalOriginalTheme.value);
      skinModalOriginalTheme.value = null;
    }
  };

  return {
    preview,
    handleSelectImage,
    handleCancel,
    handleSave,
  };
}
