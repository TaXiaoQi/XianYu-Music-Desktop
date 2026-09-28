import { describe, expect, it, vi } from 'vitest';
import { ref, type Ref } from 'vue';

import { runStartupRouteRepaint } from './startupRouteRepaint';

/** 构造带 replace 调用记录的路由器桩 */
const buildRouterStub = (path = '/', fullPath = path) => {
  const routeSnapshot = ref({ path, fullPath });
  return {
    currentRoute: routeSnapshot,
    replace: vi.fn(async (target: string) => {
      routeSnapshot.value = { fullPath: target, path: target.split('?')[0] };
    }),
  };
};

/** 以指定材质开关执行启动重绘 */
const repaintWith = (routerStub: unknown, materialOn: boolean, transition?: Ref<boolean>) =>
  runStartupRouteRepaint({
    router: routerStub as never,
    hasWindowMaterial: ref(materialOn),
    skipNextPageTransition: transition ?? ref(false),
  });

describe('startup route repaint 启动路由重绘', () => {
  it('flashes the settings route once and then restores the original path for material repaint', async () => {
    const router = buildRouterStub('/albums', '/albums?artist=a');
    const transitionGate = ref(false);

    await repaintWith(router, true, transitionGate);

    expect(router.replace).toHaveBeenNthCalledWith(1, '/settings');
    expect(router.replace).toHaveBeenNthCalledWith(2, '/albums?artist=a');
    expect(transitionGate.value).toBe(false);
  });

  it('skips the repaint pulse entirely without window material', async () => {
    const router = buildRouterStub('/albums');

    await repaintWith(router, false);

    expect(router.replace).not.toHaveBeenCalled();
  });

  it('skips the repaint pulse when already on the settings route', async () => {
    const router = buildRouterStub('/settings');

    await repaintWith(router, true);

    expect(router.replace).not.toHaveBeenCalled();
  });
});
