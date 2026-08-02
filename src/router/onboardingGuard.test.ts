import { defineComponent, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';

import {
  HOME_ROUTE_NAME,
  INITIALIZATION_ROUTE_NAME,
} from '../composables/onboardingState';
import { installOnboardingRouteGate } from './onboardingRouteGate';

const EmptyView = defineComponent({
  name: 'EmptyView',
  render: () => null,
});

describe('onboarding navigation guard', () => {
  it('does not resolve the lazy home page until initialization completes', async () => {
    const onboardingVisible = ref(true);
    const loadHome = vi.fn(async () => EmptyView);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/initialization', name: INITIALIZATION_ROUTE_NAME, component: EmptyView },
        { path: '/', name: HOME_ROUTE_NAME, component: loadHome },
      ],
    });

    installOnboardingRouteGate(router, onboardingVisible);

    await router.push('/');

    expect(router.currentRoute.value.name).toBe(INITIALIZATION_ROUTE_NAME);
    expect(loadHome).not.toHaveBeenCalled();

    onboardingVisible.value = false;
    await router.replace('/');

    expect(router.currentRoute.value.name).toBe(HOME_ROUTE_NAME);
    expect(loadHome).toHaveBeenCalledOnce();
  });

  it('unloads the current page whenever the initialization animation is replayed', async () => {
    const onboardingVisible = ref(false);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/initialization', name: INITIALIZATION_ROUTE_NAME, component: EmptyView },
        { path: '/', name: HOME_ROUTE_NAME, component: EmptyView },
        { path: '/settings', name: 'Settings', component: EmptyView },
      ],
    });
    installOnboardingRouteGate(router, onboardingVisible);

    await router.push('/settings?tab=debug');
    onboardingVisible.value = true;

    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe(INITIALIZATION_ROUTE_NAME);
    });

    onboardingVisible.value = false;

    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/settings?tab=debug');
    });
  });
});
