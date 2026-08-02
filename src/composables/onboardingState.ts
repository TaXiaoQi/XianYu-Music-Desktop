export const ONBOARDING_STORAGE_KEY = 'lycia_onboarding_completed';
export const LEGACY_ONBOARDING_STORAGE_KEY = 'onboarding_completed';
export const INITIALIZATION_ROUTE_NAME = 'Initialization';
export const HOME_ROUTE_NAME = 'Home';

export interface OnboardingStorage {
  getItem(key: string): string | null;
}

/**
 * 首次启动时显示引导；当前键或旧版键明确记录为 true 时视为已完成。
 * storage 不可用（SSR、测试或隐私环境）时按首次启动处理。
 */
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
