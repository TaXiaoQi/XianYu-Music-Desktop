import type { Ref } from 'vue';

import { windowApi } from '../services/tauri/windowApi';

const RESUME_DELAY_MS = 500;
const MASK_FADE_OUT_DELAY_MS = 400;
const MASK_FADE_TRANSITION = 'opacity 0.3s ease-out';
const DARK_MASK_COLOR = '#262626';
const LIGHT_MASK_COLOR = '#fafafa';
const RESIZE_RELAY_DELAYS_MS = [0, 100] as const;

export interface RestoreMainWindowOptions {
  isMiniMode: Ref<boolean>;
  hideMiniPlayerWindow: () => Promise<void>;
  keepMiniPlayerVisible?: boolean;
  mainWindow: {
    unminimize: () => Promise<void>;
    show: () => Promise<void>;
    setFocus: () => Promise<void>;
  };
  isImmersiveFullscreen?: boolean;
}

function mountFadeMask(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;

  const prefersDark = document.documentElement.classList.contains('dark');
  const mask = document.createElement('div');
  const style = mask.style;
  style.position = 'fixed';
  style.inset = '0';
  style.zIndex = '99999';
  style.pointerEvents = 'none';
  style.backgroundColor = prefersDark ? DARK_MASK_COLOR : LIGHT_MASK_COLOR;
  style.opacity = '1';
  document.body.appendChild(mask);
  return mask;
}

function fadeOutMask(mask: HTMLDivElement): void {
  requestAnimationFrame(() => {
    mask.style.transition = MASK_FADE_TRANSITION;
    mask.style.opacity = '0';
  });
  window.setTimeout(() => mask.remove(), MASK_FADE_OUT_DELAY_MS);
}

function relayResizeEvents(): void {
  for (const delayMs of RESIZE_RELAY_DELAYS_MS) {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, delayMs);
  }
}

export async function restoreMainWindowFromMiniMode(options: RestoreMainWindowOptions): Promise<void> {
  const { isMiniMode, hideMiniPlayerWindow, mainWindow } = options;

  isMiniMode.value = false;
  if (!options.keepMiniPlayerVisible) {
    await hideMiniPlayerWindow();
  }
  // 留出迷你窗收起的动画时间，再唤醒主窗。
  await new Promise<void>((resolve) => setTimeout(resolve, RESUME_DELAY_MS));

  const mask = mountFadeMask();

  await mainWindow.unminimize();
  await mainWindow.show();
  await mainWindow.setFocus();

  if (mask !== null) {
    fadeOutMask(mask);
  }

  if (options.isImmersiveFullscreen) {
    try {
      await windowApi.refreshImmersiveFullscreen();
    } catch {
      /* 沉浸式全屏刷新失败不阻断恢复流程 */
    }
  }

  if (typeof window !== 'undefined') {
    relayResizeEvents();
  }
}
