// 引导流程步骤状态机：步骤顺序、进度指示与启动画面计时。
// 自 OnboardingModal.vue 纯搬移，行为保持不变。
import { computed, ref } from 'vue';

export type Step = 'splash' | 'theme' | 'material' | 'shortcuts' | 'plugins' | 'account';

const onboardingSteps: { key: Step; label: string }[] = [
  { key: 'theme', label: '主题' },
  { key: 'material', label: '材质' },
  { key: 'shortcuts', label: '快捷按键' },
  { key: 'plugins', label: '插件' },
  { key: 'account', label: '账号' },
];

const SPLASH_HINT_DELAY = 800;
const SPLASH_AUTO_ADVANCE_DELAY = 5000;

export function useOnboardingState(options: {
  /** 步骤走到最后（account）再前进时的完成回调，对应主组件的 handleComplete */
  onComplete: () => void;
}) {
  const step = ref<Step>('splash');
  const splashVisible = ref(true);
  const splashHintVisible = ref(false);
  let splashHintTimer: ReturnType<typeof setTimeout> | null = null;
  let splashAutoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

  const steps = onboardingSteps;

  const currentStepIndex = computed(() =>
    step.value === 'splash' ? 0 : steps.findIndex(s => s.key === step.value) + 1,
  );

  const totalSteps = steps.length;

  // --- 步骤切换 ---
  const goToStep = (next: Step) => {
    if (next === step.value) return;
    step.value = next;
  };

  const nextStep = () => {
    const order: Step[] = ['splash', 'theme', 'material', 'shortcuts', 'plugins', 'account'];
    const idx = order.indexOf(step.value);
    if (idx < order.length - 1) {
      goToStep(order[idx + 1]);
    } else {
      options.onComplete();
    }
  };

  const prevStep = () => {
    const order: Step[] = ['theme', 'material', 'shortcuts', 'plugins', 'account'];
    const idx = order.indexOf(step.value);
    if (idx > 0) goToStep(order[idx - 1]);
  };

  const clearSplashTimers = () => {
    if (splashHintTimer) {
      clearTimeout(splashHintTimer);
      splashHintTimer = null;
    }
    if (splashAutoAdvanceTimer) {
      clearTimeout(splashAutoAdvanceTimer);
      splashAutoAdvanceTimer = null;
    }
  };

  const continueFromSplash = () => {
    if (step.value !== 'splash') return;
    clearSplashTimers();
    nextStep();
  };

  // --- 启动画面计时 ---
  const startSplashTimers = () => {
    clearSplashTimers();
    splashHintTimer = setTimeout(() => {
      splashHintVisible.value = true;
    }, SPLASH_HINT_DELAY);
    splashAutoAdvanceTimer = setTimeout(continueFromSplash, SPLASH_AUTO_ADVANCE_DELAY);
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
