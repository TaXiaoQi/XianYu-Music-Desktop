// 引导流程步骤状态机：步骤顺序、进度指示与启动画面计时。
// 自 OnboardingModal.vue 纯搬移，行为保持不变。
import { computed, ref } from 'vue';

export type Step = 'splash' | 'theme' | 'material' | 'shortcuts' | 'plugins' | 'account'; // 实现

export const onboardingSteps: { key: Step; label: string }[] = [ // 实现
  { key: 'theme', label: '主题' }, // 实现
  { key: 'material', label: '材质' }, // 实现
  { key: 'shortcuts', label: '快捷按键' },
  { key: 'plugins', label: '插件' }, // 实现
  { key: 'account', label: '账号' }, // 实现
];

const SPLASH_HINT_DELAY = 800; // 实现
const SPLASH_AUTO_ADVANCE_DELAY = 5000; // 实现

export function useOnboardingState(options: {
  /** 步骤走到最后（account）再前进时的完成回调，对应主组件的 handleComplete */
  onComplete: () => void;
}) {
  const step = ref<Step>('splash'); // 实现
  const splashVisible = ref(true); // 实现
  const splashHintVisible = ref(false); // 实现
  let splashHintTimer: ReturnType<typeof setTimeout> | null = null; // 实现
  let splashAutoAdvanceTimer: ReturnType<typeof setTimeout> | null = null; // 实现

  const steps = onboardingSteps;

  const currentStepIndex = computed(() => // 实现
    step.value === 'splash' ? 0 : steps.findIndex(s => s.key === step.value) + 1, // 实现
  );

  const totalSteps = steps.length; // 实现

  // --- 步骤切换 ---
  const goToStep = (next: Step) => { // 实现
    if (next === step.value) return; // 实现
    step.value = next; // 实现
  };

  const nextStep = () => { // 实现
    const order: Step[] = ['splash', 'theme', 'material', 'shortcuts', 'plugins', 'account']; // 实现
    const idx = order.indexOf(step.value); // 实现
    if (idx < order.length - 1) { // 实现
      goToStep(order[idx + 1]); // 实现
    } else {
      options.onComplete();
    }
  };

  const prevStep = () => { // 实现
    const order: Step[] = ['theme', 'material', 'shortcuts', 'plugins', 'account']; // 实现
    const idx = order.indexOf(step.value); // 实现
    if (idx > 0) goToStep(order[idx - 1]); // 实现
  };

  const clearSplashTimers = () => { // 实现
    if (splashHintTimer) { // 实现
      clearTimeout(splashHintTimer); // 实现
      splashHintTimer = null; // 实现
    }
    if (splashAutoAdvanceTimer) { // 实现
      clearTimeout(splashAutoAdvanceTimer); // 实现
      splashAutoAdvanceTimer = null; // 实现
    }
  };

  const continueFromSplash = () => { // 实现
    if (step.value !== 'splash') return; // 实现
    clearSplashTimers(); // 实现
    nextStep();
  };

  // --- 启动画面计时 ---
  const startSplashTimers = () => { // 实现
    clearSplashTimers(); // 实现
    splashHintTimer = setTimeout(() => { // 实现
      splashHintVisible.value = true; // 实现
    }, SPLASH_HINT_DELAY); // 实现
    splashAutoAdvanceTimer = setTimeout(continueFromSplash, SPLASH_AUTO_ADVANCE_DELAY); // 实现
  };

  return {
    step,
    steps,
    currentStepIndex,
    totalSteps,
    splashVisible,
    splashHintVisible,
    goToStep,
    nextStep,
    prevStep,
    clearSplashTimers,
    continueFromSplash,
    startSplashTimers,
  };
}
