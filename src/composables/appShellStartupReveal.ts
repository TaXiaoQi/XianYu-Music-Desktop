import type { Ref } from 'vue';
import type { Router } from 'vue-router';

import { runStartupRouteRepaint } from './startupRouteRepaint';
import {
  releaseStartupCompositionMask,
  waitForStartupRevealReadiness,
} from './startupCompositionMask';
import { clearStartupThemePaint } from './startupTheme';

export interface StartupRevealSequenceDeps {
  router: Router;
  hasWindowMaterial: Ref<boolean>;
  skipNextPageTransition: Ref<boolean>;
  maskVisible: Ref<boolean>;
  whenInitialThemeSynced: () => Promise<unknown>;
  rebuildStartupMaterialBeforeShow: () => Promise<unknown>;
  onboardingActive: () => boolean;
}

/**
 * 组装主窗口「启动透明合成」两段式时序：
 * beforeWindowShow 负责铺底（主题就绪 → 路线重绘 → 材质重建），
 * afterWindowShow 负责在窗口露出后按最短可见时长收回遮罩。
 */
export function createStartupRevealSequence(deps: StartupRevealSequenceDeps) {
  const {
    router,
    hasWindowMaterial,
    skipNextPageTransition,
    maskVisible,
    whenInitialThemeSynced,
    rebuildStartupMaterialBeforeShow,
    onboardingActive,
  } = deps;

  let maskShownAt = 0;

  const beforeWindowShow = async () => {
    await whenInitialThemeSynced();

    const wantsMask = hasWindowMaterial.value && !onboardingActive();
    maskVisible.value = wantsMask;
    maskShownAt = wantsMask ? performance.now() : 0;

    clearStartupThemePaint();

    if (!onboardingActive()) {
      await runStartupRouteRepaint({
        router,
        hasWindowMaterial,
        skipNextPageTransition,
      });
    }

    if (hasWindowMaterial.value) {
      await rebuildStartupMaterialBeforeShow();
      await waitForStartupRevealReadiness();
    }
  };

  const afterWindowShow = async () => {
    if (!maskVisible.value) {
      return;
    }

    void releaseStartupCompositionMask({
      startedAt: maskShownAt,
      hide: () => {
        maskVisible.value = false;
      },
    });
  };

  return {
    beforeWindowShow,
    afterWindowShow,
  };
}
