import { computed, type Ref } from 'vue';

import { useThemeSettings } from './useThemeSettings';

interface UseAppShellThemeOptions {
  showPlayerDetail: Ref<boolean>;
  hasWindowMaterial: Ref<boolean>;
  isMicaWindowMaterial: Ref<boolean>;
}

export function useAppShellTheme({
  showPlayerDetail,
  hasWindowMaterial,
  isMicaWindowMaterial,
}: UseAppShellThemeOptions) {
  const { theme } = useThemeSettings();

  const mainBlurStyle = computed(() => {
    if (showPlayerDetail.value) {
      return 'none';
    }

    const { dynamicBgType, mode, customBackground } = theme.value;

    if (isMicaWindowMaterial.value) {
      if (dynamicBgType === 'flow') {
        return 'none';
      }

      if (dynamicBgType === 'blur') {
        return 'blur(6px)';
      }

      if (mode === 'custom') {
        return customBackground.blur <= 0 ? 'none' : `blur(${Math.min(customBackground.blur, 8)}px)`;
      }
    }

    if (dynamicBgType === 'flow' || dynamicBgType === 'blur') {
      return hasWindowMaterial.value ? 'blur(20px)' : 'blur(40px)';
    }

    if (mode === 'custom') {
      const blur = hasWindowMaterial.value ? Math.min(customBackground.blur, 16) : customBackground.blur;
      return blur <= 0 ? 'none' : `blur(${blur}px)`;
    }

    return 'none';
  });

  const mainContainerClass = computed(() => (
    theme.value.mode === 'custom' || hasWindowMaterial.value
      ? 'bg-transparent'
      : 'bg-white/30 dark:bg-black/60'
  ));

  const footerBlurStyle = computed(() => mainBlurStyle.value);
  const footerContainerClass = computed(() => (
    showPlayerDetail.value ? 'bg-transparent' : mainContainerClass.value
  ));

  return {
    theme,
    mainBlurStyle,
    mainContainerClass,
    footerBlurStyle,
    footerContainerClass,
  };
}
