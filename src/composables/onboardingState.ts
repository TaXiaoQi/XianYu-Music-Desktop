export const ONBOARDING_STORAGE_KEY = 'xianyu_onboarding_completed';
export const LEGACY_ONBOARDING_STORAGE_KEY = 'onboarding_completed';
export const INITIALIZATION_ROUTE_NAME = 'Initialization';
export const HOME_ROUTE_NAME = 'Home';

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

export const resolveOnboardingRouteRedirect = (
  onboardingVisible: boolean,
  targetRouteName: unknown,
): string | null => {
  if (onboardingVisible && targetRouteName !== INITIALIZATION_ROUTE_NAME) {
    return INITIALIZATION_ROUTE_NAME;
  }

  if (!onboardingVisible && targetRouteName === INITIALIZATION_ROUTE_NAME) {
    return HOME_ROUTE_NAME;
  }

  return null;
};
