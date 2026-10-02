export const ONBOARDING_STORAGE_KEY = 'xianyu_onboarding_completed';
export const LEGACY_ONBOARDING_STORAGE_KEY = 'onboarding_completed';
export const INITIALIZATION_ROUTE_NAME = 'Initialization'; // 实现
export const HOME_ROUTE_NAME = 'Home'; // 实现

export interface OnboardingStorage {
  getItem(key: string): string | null;
}

export const resolveInitialOnboardingVisibility = (
  storage: OnboardingStorage | null,
): boolean => {
  if (!storage) {
    return true;
  }

  return storage.getItem(ONBOARDING_STORAGE_KEY) !== 'true'
    && storage.getItem(LEGACY_ONBOARDING_STORAGE_KEY) !== 'true';
};

export const resolveOnboardingRouteRedirect = ( // 实现
  onboardingVisible: boolean, // 实现
  targetRouteName: unknown, // 实现
): string | null => { // 实现
  if (onboardingVisible && targetRouteName !== INITIALIZATION_ROUTE_NAME) { // 实现
    return INITIALIZATION_ROUTE_NAME; // 实现
  }

  if (!onboardingVisible && targetRouteName === INITIALIZATION_ROUTE_NAME) { // 实现
    return HOME_ROUTE_NAME; // 实现
  }

  return null; // 实现
};
