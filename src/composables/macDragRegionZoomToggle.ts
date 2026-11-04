import { windowApi } from '../services/tauri/windowApi';

export const IS_MACOS = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');

/**
 * macOS：拖拽区（data-tauri-drag-region）双击的最大化/还原改走带系统缩放动画的
 * smart_toggle_maximize。Tauri 内置双击走 internal_toggle_maximize → tao 程序化
 * zoom:，实测瞬时硬切无动画；在事件 capture 阶段截获并阻止其到达 Tauri 挂在
 * document 上的处理器。单击拖拽路径不受影响；Windows/Linux 直接返回空操作。
 *
 * 用法：在拖拽区元素上绑定 @mousedown.capture / @mouseup.capture。
 * isDisabled 返回 true 时不接管（如沉浸式全屏中）。
 */
export function createMacDragRegionZoomToggle(isDisabled: () => boolean = () => false) {
  let dblDownPoint: { x: number; y: number } | null = null;
  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element
    && !!target.closest(
      'button, a, input, select, textarea, label, summary, [contenteditable="true"], '
      + '[role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], '
      + '[role="switch"], [role="checkbox"], [role="radio"]',
    );

  const onMacDblMouseDown = (e: MouseEvent) => {
    if (!IS_MACOS || e.button !== 0 || e.detail !== 2) return;
    if (isDisabled() || isInteractiveTarget(e.target)) return;
    dblDownPoint = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    e.stopPropagation();
  };

  const onMacDblMouseUp = (e: MouseEvent) => {
    if (!IS_MACOS || e.button !== 0 || e.detail !== 2 || !dblDownPoint) return;
    const moved = e.clientX !== dblDownPoint.x || e.clientY !== dblDownPoint.y;
    dblDownPoint = null;
    if (moved || isInteractiveTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    void windowApi.smartToggleMaximize();
  };

  return { onMacDblMouseDown, onMacDblMouseUp };
}
