import { computed, type Ref } from 'vue';

import { useThemeSettings } from './useThemeSettings';

interface UseAppShellThemeOptions {
  showPlayerDetail: Ref<boolean>;
  hasWindowMaterial: Ref<boolean>;
  isMicaWindowMaterial: Ref<boolean>;
  lowPerformance: Ref<boolean>;
}

export function useAppShellTheme({
  showPlayerDetail,
  hasWindowMaterial,
  isMicaWindowMaterial,
  lowPerformance,
}: UseAppShellThemeOptions) {
  const { theme } = useThemeSettings();

  const mainBlurStyle = computed(() => {
    if (showPlayerDetail.value) {
      return 'none';
    }

    // 性能降级：关闭 CSS 常驻 backdrop 模糊，避免滚动/转场掉帧；可读性由底色补偿。
    if (lowPerformance?.value) {
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
  // 性能降级且无原生窗口材质：用更高不透明度底色补偿被关闭的 backdrop 模糊，保证内容可读。
  theme.value.mode === 'custom' || hasWindowMaterial.value
    ? (lowPerformance?.value && !hasWindowMaterial.value
        ? 'bg-white/75 dark:bg-[#262626]/85'
        : 'bg-transparent')
    : (lowPerformance?.value && !hasWindowMaterial.value
        ? 'bg-white/75 dark:bg-[#262626]/85'
        : 'bg-white/30 dark:bg-[#262626]/60')
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
