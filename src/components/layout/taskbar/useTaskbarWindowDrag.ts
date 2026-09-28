// 任务栏播控条窗口拖拽编排：指针捕获、任务栏几何约束、
// rAF 合帧定位与落点记忆。拖拽状态经由跨窗口事件广播给主窗口。
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { emitTo } from '@tauri-apps/api/event';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { onScopeDispose, ref } from 'vue';

import {
  TASKBAR_PLAYER_DRAG_EVENT,
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  TASKBAR_PLAYER_WINDOW_WIDTH,
} from '../../../features/taskbarPlayer/shared';
import { writeSavedPositionX } from '../../../composables/useTaskbarPlayerBridge';
import { windowApi } from '../../../services/tauri/windowApi';
import { clamp } from '../../../utils/math';

interface DragBounds {
  minX: number;
  maxX: number;
  y: number;
}

export function useTaskbarWindowDrag(shellWindow: TauriWindow) {
  const isDragging = ref(false);

  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let detachPointerListeners: (() => void) | null = null;
  let moveFrame = 0;
  let queuedPosition: LogicalPosition | null = null;

  /** 合帧提交窗口位移，避免高频 pointermove 拖垮渲染 */
  const flushQueuedPosition = () => {
    moveFrame = window.requestAnimationFrame(() => {
      moveFrame = 0;
      const next = queuedPosition;
      queuedPosition = null;
      if (next) void shellWindow.setPosition(next);
    });
  };

  const queuePosition = (position: LogicalPosition) => {
    queuedPosition = position;
    if (moveFrame === 0) flushQueuedPosition();
  };

  const settleDrag = async () => {
    if (!isDragging.value) return;
    isDragging.value = false;
    if (safetyTimer) clearTimeout(safetyTimer);
    detachPointerListeners?.();
    detachPointerListeners = null;
    void emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: false });
    const factor = await shellWindow.scaleFactor();
    const position = (await shellWindow.outerPosition()).toLogical(factor);
    writeSavedPositionX(position.x);
  };

  /** 以任务栏横向矩形为活动范围推导可停靠区间 */
  const resolveDragBounds = async (): Promise<DragBounds | null> => {
    const geometry = await windowApi.getTaskbarTrayGeometry().catch((error) => {
      console.warn('Failed to get taskbar drag bounds:', error);
      return null;
    });
    if (!geometry) return null;

    const factor = await shellWindow.scaleFactor();
    const physical = geometry.taskbar_rect_physical;
    const rect = {
      left: physical.left / factor,
      top: physical.top / factor,
      right: physical.right / factor,
      bottom: physical.bottom / factor,
    };
    const laneWidth = rect.right - rect.left;
    const laneHeight = rect.bottom - rect.top;
    if (laneWidth <= laneHeight) return null;

    return {
      minX: rect.left,
      maxX: Math.max(rect.left, rect.right - TASKBAR_PLAYER_WINDOW_WIDTH),
      y: Math.round(rect.top + (laneHeight - TASKBAR_PLAYER_WINDOW_HEIGHT) / 2),
    };
  };

  const beginDrag = async (event: PointerEvent) => {
    if (event.button !== 0) return;

    isDragging.value = true;
    void emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: true });

    detachPointerListeners?.();
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyTimer = setTimeout(() => {
      if (isDragging.value) void settleDrag();
    }, 30000);

    const factor = await shellWindow.scaleFactor();
    const origin = (await shellWindow.outerPosition()).toLogical(factor);
    const bounds = await resolveDragBounds();
    const originScreenX = event.screenX;

    const trackPointer = (moveEvent: PointerEvent) => {
      if (!isDragging.value || !bounds) return;
      const nextX = clamp(
        origin.x + moveEvent.screenX - originScreenX,
        bounds.minX,
        bounds.maxX,
      );
      queuePosition(new LogicalPosition(Math.round(nextX), bounds.y));
    };

    const endTrack = () => {
      void settleDrag();
    };

    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', trackPointer, true);
    window.addEventListener('pointerup', endTrack, true);
    window.addEventListener('pointercancel', endTrack, true);
    window.addEventListener('blur', endTrack, true);
    detachPointerListeners = () => {
      window.removeEventListener('pointermove', trackPointer, true);
      window.removeEventListener('pointerup', endTrack, true);
      window.removeEventListener('pointercancel', endTrack, true);
      window.removeEventListener('blur', endTrack, true);
    };
  };

  onScopeDispose(() => {
    if (safetyTimer) clearTimeout(safetyTimer);
    detachPointerListeners?.();
    if (moveFrame !== 0) {
      window.cancelAnimationFrame(moveFrame);
      moveFrame = 0;
    }
  });

  return { isDragging, beginDrag };
}
