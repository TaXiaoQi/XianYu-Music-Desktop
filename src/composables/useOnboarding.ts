import { ref } from 'vue';
import {
  LEGACY_ONBOARDING_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  resolveInitialOnboardingVisibility,
} from './onboardingState';

const getStorage = () => (typeof localStorage === 'undefined' ? null : localStorage);

const showOnboarding = ref(resolveInitialOnboardingVisibility(getStorage()));

export function useOnboarding() {
  const triggerOnboarding = () => {
    const storage = getStorage();
    storage?.removeItem(ONBOARDING_STORAGE_KEY);
    storage?.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
    showOnboarding.value = true;
  };

  const completeOnboarding = () => {
    const storage = getStorage();
    storage?.setItem(ONBOARDING_STORAGE_KEY, 'true');
    storage?.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
    showOnboarding.value = false;
  };

  return {
    showOnboarding,
    triggerOnboarding,
    completeOnboarding,
  };
}
