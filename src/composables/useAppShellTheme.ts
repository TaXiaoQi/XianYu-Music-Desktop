// 外壳表面（主区域与底栏）的背景/模糊决策：
// - 播放器详情展开或低性能模式时，主区域一律关闭模糊；
// - mica 材质下动态背景与自定义背景有独立的模糊档位；
// - 常规情况下，动态背景按「有无原生材质」取档，自定义背景则按用户
//   滑杆值取档（有材质时压到安全上限，避免与原生特效叠加过曝）。
import { computed, type Ref } from 'vue';

import { useThemeSettings } from './useThemeSettings';

/** 低性能模式下的降级表面：改为半透明纯色底，放弃模糊滤镜 */
const LOW_POWER_SURFACE_CLASS = 'bg-white/75 dark:bg-[#262626]/85';
/** 有原生材质或自定义背景时，外壳表面完全透明，交给背景层绘制 */
const TRANSPARENT_SURFACE_CLASS = 'bg-transparent';
/** 无原生材质时的常规半透明表面 */
const DEFAULT_SURFACE_CLASS = 'bg-white/30 dark:bg-[#262626]/60';

/** 模糊关闭的统一取值 */
const BLUR_DISABLED_STYLE = 'none';
/** mica 材质下动态背景的固定档位 */
const MICA_DYNAMIC_BACKDROP_BLUR = 'blur(6px)';
/** 有原生材质时动态背景的主区域档位 */
const DYNAMIC_BACKDROP_BLUR_OVER_MATERIAL = 'blur(20px)';
/** 无原生材质时动态背景的主区域档位 */
const DYNAMIC_BACKDROP_BLUR_WITHOUT_MATERIAL = 'blur(40px)';
/** mica 材质下自定义背景模糊上限（px） */
const MICA_CUSTOM_BACKDROP_BLUR_CEILING = 8;
/** 有原生材质时自定义背景模糊上限（px） */
const CUSTOM_BACKDROP_BLUR_CEILING_OVER_MATERIAL = 16;

/** 外壳主题装配所需的响应式入参 */
interface ShellBackdropOptionRefs {
  showPlayerDetail: Ref<boolean>;
  hasWindowMaterial: Ref<boolean>;
  isMicaWindowMaterial: Ref<boolean>;
  lowPerformance: Ref<boolean>;
}

const blurPixelStyle = (radius: number) => `blur(${radius}px)`;

export function useAppShellTheme(shellRefs: ShellBackdropOptionRefs) {
  const { showPlayerDetail, hasWindowMaterial, isMicaWindowMaterial, lowPerformance } = shellRefs;
  const theme = useThemeSettings().theme;

  const mainSurfaceBlurStyle = computed(() => {
    if (showPlayerDetail.value || lowPerformance?.value) return BLUR_DISABLED_STYLE;

    const currentTheme = theme.value;
    const { dynamicBgType, mode, customBackground } = currentTheme;
    const isDynamicBackdrop = dynamicBgType === 'flow' || dynamicBgType === 'blur';

    if (isMicaWindowMaterial.value) {
      if (isDynamicBackdrop) {
        return dynamicBgType === 'flow' ? BLUR_DISABLED_STYLE : MICA_DYNAMIC_BACKDROP_BLUR;
      }
      if (mode === 'custom') {
        const clampedRadius = Math.min(customBackground.blur, MICA_CUSTOM_BACKDROP_BLUR_CEILING);
        return customBackground.blur <= 0 ? BLUR_DISABLED_STYLE : blurPixelStyle(clampedRadius);
      }
    }

    if (isDynamicBackdrop) {
      return hasWindowMaterial.value
        ? DYNAMIC_BACKDROP_BLUR_OVER_MATERIAL
        : DYNAMIC_BACKDROP_BLUR_WITHOUT_MATERIAL;
    }

    if (mode === 'custom') {
      const blurRadius = hasWindowMaterial.value
        ? Math.min(customBackground.blur, CUSTOM_BACKDROP_BLUR_CEILING_OVER_MATERIAL)
        : customBackground.blur;
      return blurRadius <= 0 ? BLUR_DISABLED_STYLE : blurPixelStyle(blurRadius);
    }

    return BLUR_DISABLED_STYLE;
  });

  const mainSurfaceClass = computed(() => {
    if (lowPerformance?.value && !hasWindowMaterial.value) {
      return LOW_POWER_SURFACE_CLASS;
    }
    if (theme.value.mode === 'custom' || hasWindowMaterial.value) {
      return TRANSPARENT_SURFACE_CLASS;
    }
    return DEFAULT_SURFACE_CLASS;
  });

  const footerSurfaceClass = computed(() => (
    showPlayerDetail.value ? TRANSPARENT_SURFACE_CLASS : mainSurfaceClass.value
  ));

  return { theme, mainBlurStyle: mainSurfaceBlurStyle, mainContainerClass: mainSurfaceClass, footerBlurStyle: mainSurfaceBlurStyle, footerContainerClass: footerSurfaceClass };
}
