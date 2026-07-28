import { ref } from 'vue';

const ONBOARDING_KEY = 'onboarding_completed';

// 模块级共享状态：TitleBar 触发，MainShell 监听
const showOnboarding = ref(localStorage.getItem(ONBOARDING_KEY) !== 'true');

export function useOnboarding() {
  const triggerOnboarding = () => {
    localStorage.removeItem(ONBOARDING_KEY);
    showOnboarding.value = true;
  };

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    showOnboarding.value = false;
  };

  return {
    showOnboarding,
    triggerOnboarding,
    completeOnboarding,
  };
}
