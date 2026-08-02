import { watch, type Ref } from 'vue';
import type { RouteLocationRaw, Router } from 'vue-router';

import {
  HOME_ROUTE_NAME,
  INITIALIZATION_ROUTE_NAME,
  resolveOnboardingRouteRedirect,
} from '../composables/onboardingState';

export function installOnboardingRouteGate(
  router: Router,
  onboardingVisible: Ref<boolean>,
) {
  let returnRoute: RouteLocationRaw = { name: HOME_ROUTE_NAME };

  router.beforeEach((to) => {
    const redirectName = resolveOnboardingRouteRedirect(onboardingVisible.value, to.name);
    return redirectName ? { name: redirectName, replace: true } : true;
  });

  return watch(
    onboardingVisible,
    (visible) => {
      const currentRoute = router.currentRoute.value;

      if (visible && currentRoute.name !== INITIALIZATION_ROUTE_NAME) {
        returnRoute = currentRoute.fullPath || { name: HOME_ROUTE_NAME };
        void router.replace({ name: INITIALIZATION_ROUTE_NAME });
        return;
      }

      if (!visible && currentRoute.name === INITIALIZATION_ROUTE_NAME) {
        const targetRoute = returnRoute;
        returnRoute = { name: HOME_ROUTE_NAME };
        void router.replace(targetRoute);
      }
    },
    { flush: 'sync' },
  );
}
