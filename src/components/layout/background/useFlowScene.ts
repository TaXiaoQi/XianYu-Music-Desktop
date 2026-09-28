// 流光场景组合层：读取主题偏好、取色结果与窗口材质，产出当前帧的场景快照与切换签名。
// 签名只在"结构态"（外壳色调 / 动效冻结）变化时翻转，用于驱动换层；
// 其余外观字段（配色、透明度等）允许在场层原地热更新。
import { computed, type ComputedRef, type Ref } from 'vue';
import type { ThemeSettings } from '../../../types';
import {
  composeBasePaint,
  composeMotionVars,
  stabilizePalette,
  type FlowLayerSnapshot,
} from './flowSceneMath';

interface FlowSceneDeps {
  /** 当前是否处于流光背景模式 */
  flowEngaged: ComputedRef<boolean>;
  themeSettings: Ref<ThemeSettings>;
  /** 从封面提取出的主色序列 */
  coverPalette: Ref<string[]>;
  /** 解析后的窗口材质（none/mica/acrylic/blur） */
  windowMaterial: Ref<string>;
  /** 详情页展开、低功耗省电或低性能模式下冻结动效 */
  motionFrozen: ComputedRef<boolean>;
  shellTone: ComputedRef<string>;
  overlayTone: ComputedRef<string>;
}

export function useFlowScene(deps: FlowSceneDeps) {
  const onMica = computed(() => deps.windowMaterial.value === 'mica');
  const boostRatio = computed(() => deps.themeSettings.value.flowColorBoost / 100);
  const depthRatio = computed(() => deps.themeSettings.value.flowDepth / 100);
  const speedRatio = computed(() => deps.themeSettings.value.flowSpeed / 100);
  const textureRatio = computed(() => deps.themeSettings.value.flowTexture / 100);

  const palette = computed(() => stabilizePalette(deps.coverPalette.value));

  const baseOpacity = computed(() => {
    const raw = 0.36 + boostRatio.value * 0.15 - depthRatio.value * 0.05;
    return onMica.value ? Math.max(0.14, raw * 0.36) : Math.max(0.34, raw);
  });

  const blobOpacity = computed(() => {
    const raw = 0.45 + boostRatio.value * 0.18;
    return onMica.value ? Math.max(0.18, raw * 0.34) : Math.min(0.86, raw);
  });

  const noiseOpacity = computed(() => {
    const raw = 0.004 + textureRatio.value * 0.022;
    return onMica.value ? raw * 0.55 : raw;
  });

  const overlayOpacity = computed(() => {
    const raw = 0.91 + depthRatio.value * 0.26 - boostRatio.value * 0.08;
    return Math.min(1.1, Math.max(0.8, raw));
  });

  const scene = computed<Omit<FlowLayerSnapshot, 'layerKey' | 'phase'> | null>(() => {
    if (!deps.flowEngaged.value) return null;
    return {
      shellTone: deps.shellTone.value,
      palette: [...palette.value],
      basePaint: composeBasePaint(palette.value, baseOpacity.value, depthRatio.value),
      blobOpacity: blobOpacity.value,
      noiseOpacity: noiseOpacity.value,
      overlayTone: deps.overlayTone.value,
      overlayOpacity: overlayOpacity.value,
      motionVars: composeMotionVars(speedRatio.value),
      motionFrozen: deps.motionFrozen.value,
    };
  });

  /** 结构态签名：变化即触发换层序列 */
  const sceneSignature = computed(() => {
    if (!deps.flowEngaged.value) return null;
    return [deps.shellTone.value, deps.motionFrozen.value ? 'held' : 'live'].join('|');
  });

  return { scene, sceneSignature };
}
