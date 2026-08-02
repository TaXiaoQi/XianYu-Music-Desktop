import { describe, expect, it } from 'vitest';

import {
  LEGACY_ONBOARDING_STORAGE_KEY,
  HOME_ROUTE_NAME,
  INITIALIZATION_ROUTE_NAME,
  ONBOARDING_STORAGE_KEY,
  resolveInitialOnboardingVisibility,
  resolveOnboardingRouteRedirect,
  type OnboardingStorage,
} from './onboardingState';

const createStorage = (values: Record<string, string> = {}): OnboardingStorage => ({
  getItem: key => values[key] ?? null,
});

describe('onboarding route gate', () => {
  it('redirects the initial home navigation before the home component is loaded', () => {
    expect(resolveOnboardingRouteRedirect(true, HOME_ROUTE_NAME)).toBe(INITIALIZATION_ROUTE_NAME);
  });

  it('keeps the initialization route active while onboarding is visible', () => {
    expect(resolveOnboardingRouteRedirect(true, INITIALIZATION_ROUTE_NAME)).toBeNull();
  });

  it('enters the home route only after onboarding has completed', () => {
    expect(resolveOnboardingRouteRedirect(false, INITIALIZATION_ROUTE_NAME)).toBe(HOME_ROUTE_NAME);
  });
});

describe('onboarding state', () => {
  it('shows onboarding when storage is unavailable or has no completion marker', () => {
    expect(resolveInitialOnboardingVisibility(null)).toBe(true);
    expect(resolveInitialOnboardingVisibility(createStorage())).toBe(true);
  });

  it('hides onboarding after the current completion marker is set', () => {
    expect(resolveInitialOnboardingVisibility(createStorage({
      [ONBOARDING_STORAGE_KEY]: 'true',
    }))).toBe(false);
  });

  it('honors the legacy completion marker', () => {
    expect(resolveInitialOnboardingVisibility(createStorage({
      [LEGACY_ONBOARDING_STORAGE_KEY]: 'true',
    }))).toBe(false);
  });

  it('does not treat arbitrary values as completion', () => {
    expect(resolveInitialOnboardingVisibility(createStorage({
      [ONBOARDING_STORAGE_KEY]: 'false',
      [LEGACY_ONBOARDING_STORAGE_KEY]: '1',
    }))).toBe(true);
  });
});
