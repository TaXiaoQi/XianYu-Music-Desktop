import { open } from '@tauri-apps/plugin-dialog';
import { ref } from 'vue';

import { normalizeForegroundStyle } from '../features/settings/store';
import { tauriInvoke } from '../services/tauri/invoke';
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
        // 直接把用户目录的原始路径写入会在 asset 协议 scope（仅 $APPDATA/$APPCACHE）外，
        // 导致背景图破损且重启丢失。先复制到应用数据目录再使用返回的稳定路径。
        try {
          preview.value.imagePath = await tauriInvoke('import_skin_image', {
            sourcePath: selected,
          });
        } catch {
          preview.value.imagePath = selected;
        }
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
