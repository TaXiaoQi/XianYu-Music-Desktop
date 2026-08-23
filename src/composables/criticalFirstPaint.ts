import { storeToRefs } from 'pinia';
import type { Router } from 'vue-router';
import { useUiStore } from '../shared/stores/ui';

/**
 * 每个页面首次进入时跳过 router-view 的 out-in 过渡（同步直换）。
 *
 * 崩溃背景：正式构建下页面 chunk 经 tauri.localhost 真实加载，首次挂载可能
 * 落在 page-fade 的 out-in 过渡窗口内；若该页面（如首页）挂载后立刻被异步
 * 数据（音乐库扫描 / 歌单加载）补丁其虚拟列表行，卸载行时读到 el.parentNode
 * 为 null 崩溃（dev 下 Vite 内存加载接近瞬时，恰好不触发——正是"正式崩、
 * dev 不崩"的原因）。让每个页面的首次进入走无过渡直换，后续列表补丁便
 * 全部在稳定 DOM 上进行，彻底消除该竞态。
 *
 * 复用全局 skipNextPageTransition：MainShell 的 router-view <transition>
 * 在其为真时关闭 name / css / mode，组件替换变为同步直换。
 */
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