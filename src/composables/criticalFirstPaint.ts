import { storeToRefs } from 'pinia';
import type { Router } from 'vue-router';
import { useUiStore } from '../shared/stores/ui';

let installed = false;
export function installCriticalFirstPaintSync(router: Router): void {
  if (installed) return;
  installed = true;

  const { skipNextPageTransition } = storeToRefs(useUiStore());
  const stablePages = new Set<string>();

  router.beforeEach((to) => {
    const name = to.name == null ? '' : String(to.name);
    if (!stablePages.has(name)) {
      skipNextPageTransition.value = true;
    }
  });

  router.afterEach((to) => {
    stablePages.add(to.name == null ? '' : String(to.name));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      skipNextPageTransition.value = false;
    }));
  });
}