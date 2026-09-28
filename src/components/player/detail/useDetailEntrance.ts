import type { Ref } from 'vue';

const ENTER_CURVE = 'cubic-bezier(0.22,1,0.36,1)';
const ENTER_DURATION_MS = 400;

/**
 * 详情页分段入场位移样式。
 * 按相位返回“透明度 + 位移 + 过渡”的内联样式：
 * 详情页已经展开（immediateOpen）时返回空对象，让位给 CSS 入场动画；
 * 反向收起过程则依据 settlePhase 决定各分段是否已经归位。
 */
export function useDetailEntrance(immediateOpen: Ref<boolean>, settlePhase: Ref<number>) {
  const enterShift = (phase: number, axis: 'x' | 'y' = 'y', span = 20) => {
    if (immediateOpen.value) {
      return {};
    }

    const settled = settlePhase.value >= phase;
    const offset = axis === 'x' ? `translateX(${span}px)` : `translateY(${span}px)`;
    const motion = `opacity ${ENTER_DURATION_MS}ms ${ENTER_CURVE} 0ms, transform ${ENTER_DURATION_MS}ms ${ENTER_CURVE} 0ms`;

    return {
      opacity: settled ? 1 : 0,
      transform: settled ? 'translate(0, 0)' : offset,
      transition: motion,
    };
  };

  return { enterShift };
}
