// 流光层栈编排：维护 entering/current/previous 三态层序列。
// 换层流程：签名翻转 → 旧层降级为 previous、新层以 entering 进栈 →
// 下一帧渲染后新层晋升 current → 交接计时结束后清退 previous 层。
// 签名未变但外观参数变化时，仅对 current 层做原地热更新。
import { nextTick, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue';
import { SCENE_HANDOFF_MS, type FlowLayerSnapshot } from './flowSceneMath';

type SceneSnapshot = Omit<FlowLayerSnapshot, 'layerKey' | 'phase'>;

export function useFlowLayerStack(
  scene: Ref<SceneSnapshot | null>,
  sceneSignature: ComputedRef<string | null>,
) {
  const layers = ref<FlowLayerSnapshot[]>([]);

  let layerSeed = 0;
  let handoffTimer: ReturnType<typeof setTimeout> | null = null;
  let promoteFrame: number | null = null;

  const dropHandoffTimer = () => {
    if (handoffTimer) {
      clearTimeout(handoffTimer);
      handoffTimer = null;
    }
  };

  const dropPromoteFrame = () => {
    if (promoteFrame !== null) {
      cancelAnimationFrame(promoteFrame);
      promoteFrame = null;
    }
  };

  const spawnLayer = (snapshot: SceneSnapshot): FlowLayerSnapshot => ({
    layerKey: ++layerSeed,
    phase: 'entering',
    ...snapshot,
  });

  /** 等首帧绘制完成后再晋升，保证进场过渡被浏览器捕捉 */
  const promoteWhenPainted = (targetKey: number) => {
    void nextTick(() => {
      dropPromoteFrame();
      promoteFrame = requestAnimationFrame(() => {
        layers.value = layers.value.map((layer) => (
          layer.layerKey === targetKey
            ? { ...layer, phase: 'current' }
            : layer
        ));
        promoteFrame = null;
      });
    });
  };

  watch(sceneSignature, (signature) => {
    if (!signature) {
      dropHandoffTimer();
      dropPromoteFrame();
      layers.value = [];
      return;
    }

    const snapshot = scene.value;
    if (!snapshot) return;

    const incumbent = layers.value.find((layer) => layer.phase === 'current');
    if (!incumbent) {
      const seed = spawnLayer(snapshot);
      layers.value = [seed];
      promoteWhenPainted(seed.layerKey);
      return;
    }

    const incoming = spawnLayer(snapshot);
    layers.value = [{ ...incumbent, phase: 'previous' }, incoming];
    promoteWhenPainted(incoming.layerKey);

    dropHandoffTimer();
    handoffTimer = setTimeout(() => {
      layers.value = layers.value.filter((layer) => layer.phase === 'current');
      handoffTimer = null;
    }, SCENE_HANDOFF_MS);
  }, { immediate: true });

  watch(scene, (snapshot) => {
    if (!snapshot) return;
    layers.value = layers.value.map((layer) => (
      layer.phase === 'current'
        ? { ...layer, ...snapshot, layerKey: layer.layerKey, phase: layer.phase }
        : layer
    ));
  });

  onBeforeUnmount(() => {
    dropHandoffTimer();
    dropPromoteFrame();
  });

  return { layers };
}
