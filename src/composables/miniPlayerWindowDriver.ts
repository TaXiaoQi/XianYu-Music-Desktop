import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

import {
  MINI_PLAYER_WINDOW_BASE_HEIGHT,
  MINI_PLAYER_WINDOW_LABEL,
  MINI_PLAYER_WINDOW_WIDTH,
} from '../features/miniPlayer/shared';
import {
  fitAnchorIntoViewport,
  loadPersistedAnchor,
  type MiniWindowAnchor,
} from './miniPlayerBoundsMemory';

const READY_WAIT_TIMEOUT_MS = 1000;
const STATE_APPLIED_WAIT_TIMEOUT_MS = 500;

interface ReadyGate {
  confirmed: boolean;
  waiter: Promise<void> | null;
  release: (() => void) | null;
}

let windowTask: Promise<WebviewWindow> | null = null;
let stateAppliedRelease: (() => void) | null = null;
const readyGate: ReadyGate = { confirmed: false, waiter: null, release: null };

function resetReadyGate() {
  readyGate.confirmed = false;
  readyGate.waiter = null;
  readyGate.release = null;
}

export function lookupMiniWindow(): Promise<WebviewWindow | null> {
  return WebviewWindow.getByLabel(MINI_PLAYER_WINDOW_LABEL);
}

function placeAtAnchor(instance: WebviewWindow, anchor: MiniWindowAnchor): Promise<void> {
  return instance.setPosition(new LogicalPosition(anchor.x, anchor.y));
}

async function realignExistingWindow(
  existing: WebviewWindow,
  anchor: MiniWindowAnchor | null,
): Promise<WebviewWindow> {
  if (anchor) {
    await placeAtAnchor(existing, anchor);
  }
  // 复用已有窗体时把最小/最大/当前尺寸统一钉回基准尺寸，避免残留展开态。
  const baseFrame = new LogicalSize(MINI_PLAYER_WINDOW_WIDTH, MINI_PLAYER_WINDOW_BASE_HEIGHT);
  await existing.setMinSize(baseFrame);
  await existing.setMaxSize(baseFrame);
  await existing.setSize(baseFrame);
  return existing;
}

function awaitInstanceCreated(
  instance: WebviewWindow,
  anchor: MiniWindowAnchor | null,
): Promise<WebviewWindow> {
  return new Promise<WebviewWindow>((resolve, reject) => {
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      settle();
    };

    void instance.once('tauri://created', () => {
      if (!anchor) {
        finish(() => resolve(instance));
        return;
      }
      placeAtAnchor(instance, anchor).then(
        () => finish(() => resolve(instance)),
        (error: unknown) => finish(() => reject(error)),
      );
    });

    void instance.once('tauri://error', (event) => {
      finish(() => reject(event.payload));
    });
  });
}

function spawnMiniInstance(anchor: MiniWindowAnchor | null): Promise<WebviewWindow> {
  const instance = new WebviewWindow(MINI_PLAYER_WINDOW_LABEL, {
    url: '/',
    title: 'XianYu Music Mini Player',
    width: MINI_PLAYER_WINDOW_WIDTH,
    height: MINI_PLAYER_WINDOW_BASE_HEIGHT,
    minWidth: MINI_PLAYER_WINDOW_WIDTH,
    minHeight: MINI_PLAYER_WINDOW_BASE_HEIGHT,
    maxWidth: MINI_PLAYER_WINDOW_WIDTH,
    maxHeight: MINI_PLAYER_WINDOW_BASE_HEIGHT,
    visible: false,
    decorations: false,
    transparent: true,
    shadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    center: !anchor,
  });

  return awaitInstanceCreated(instance, anchor);
}

export async function acquireMiniWindow(): Promise<WebviewWindow> {
  const anchor = await fitAnchorIntoViewport(await loadPersistedAnchor());
  const existing = await lookupMiniWindow();

  if (existing) {
    return realignExistingWindow(existing, anchor);
  }

  if (windowTask === null) {
    resetReadyGate();
    const spawning = spawnMiniInstance(anchor);
    windowTask = spawning.finally(() => {
      windowTask = null;
    });
  }

  return windowTask;
}

export function confirmMiniWindowReady(): void {
  readyGate.confirmed = true;
  readyGate.release?.();
  readyGate.release = null;
  readyGate.waiter = null;
}

export function awaitMiniWindowReady(timeoutMs: number = READY_WAIT_TIMEOUT_MS): Promise<void> {
  if (readyGate.confirmed) {
    return Promise.resolve();
  }

  if (readyGate.waiter === null) {
    readyGate.waiter = new Promise<void>((resolve) => {
      readyGate.release = resolve;
      window.setTimeout(resolve, timeoutMs);
    });
  }

  return readyGate.waiter;
}

export function awaitMiniStateApplied(
  timeoutMs: number = STATE_APPLIED_WAIT_TIMEOUT_MS,
): Promise<void> {
  return new Promise<void>((resolve) => {
    stateAppliedRelease = resolve;
    window.setTimeout(resolve, timeoutMs);
  });
}

export function confirmMiniStateApplied(): void {
  stateAppliedRelease?.();
  stateAppliedRelease = null;
}

export function detachMiniWindowRuntime(): void {
  windowTask = null;
  resetReadyGate();
  stateAppliedRelease = null;
}
