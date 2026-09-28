import { LogicalPosition } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ref, type Ref } from 'vue';

import {
  MINI_PLAYER_WINDOW_BASE_HEIGHT,
  MINI_PLAYER_WINDOW_WIDTH,
  VOLUME_POPOVER_ACTION_EVENT,
  VOLUME_POPOVER_STATE_EVENT,
  VOLUME_POPOVER_VISIBILITY_EVENT,
  VOLUME_POPOVER_WINDOW_HEIGHT,
  VOLUME_POPOVER_WINDOW_LABEL,
  VOLUME_POPOVER_WINDOW_WIDTH,
  type MiniPlayerAction,
  type VolumePopoverAction,
} from '../../../features/miniPlayer/shared';

export interface MiniVolumePopoverOptions {
  volume: Ref<number>;
  anchorElement: () => HTMLElement | null;
  emitAction: (action: MiniPlayerAction) => void;
  collapsePlaylist: () => void;
}

export function useMiniVolumePopover(options: MiniVolumePopoverOptions) {
  const appWindow = getCurrentWindow();
  const shown = ref(false);
  let instance: WebviewWindow | null = null;
  let spawnJob: Promise<WebviewWindow | null> | null = null;
  const stopFns: Array<() => void> = [];

  const findPopover = async () => WebviewWindow.getByLabel(VOLUME_POPOVER_WINDOW_LABEL);

  const spawn = async (): Promise<WebviewWindow | null> => {
    const existing = await findPopover();
    if (existing) return existing;

    if (spawnJob) return spawnJob;

    spawnJob = (async () => {
      try {
        const candidate = new WebviewWindow(VOLUME_POPOVER_WINDOW_LABEL, {
          url: '/',
          title: 'XianYu Music Volume',
          width: VOLUME_POPOVER_WINDOW_WIDTH, height: VOLUME_POPOVER_WINDOW_HEIGHT,
          minWidth: VOLUME_POPOVER_WINDOW_WIDTH, minHeight: VOLUME_POPOVER_WINDOW_HEIGHT,
          maxWidth: VOLUME_POPOVER_WINDOW_WIDTH, maxHeight: VOLUME_POPOVER_WINDOW_HEIGHT,
          visible: false, decorations: false, transparent: true, shadow: false,
          resizable: false, skipTaskbar: true, alwaysOnTop: true,
          focus: false, focusable: true, center: false,
        });

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const conclude = (failed: boolean, payload?: unknown) => {
            if (settled) return;
            settled = true;
            if (failed) reject(payload);
            else resolve();
          };

          void candidate.once('tauri://created', () => conclude(false));
          void candidate.once('tauri://error', (event) => conclude(true, event.payload));
        });

        instance = candidate;
        return candidate;
      } catch (error) {
        console.warn('Failed to create volume popover window:', error);
        return null;
      } finally {
        spawnJob = null;
      }
    })();

    return spawnJob;
  };

  const sync = async () => {
    const target = await findPopover();
    if (!target) return;
    await emitTo(VOLUME_POPOVER_WINDOW_LABEL, VOLUME_POPOVER_STATE_EVENT, { volume: options.volume.value });
  };

  const reveal = async () => {
    const target = await spawn();
    if (!target) return;

    const buttonRect = options.anchorElement()?.getBoundingClientRect();
    const scaleFactor = await appWindow.scaleFactor();
    const winPos = await appWindow.outerPosition();
    const originX = winPos.x / scaleFactor;
    const originY = winPos.y / scaleFactor;

    let popoverX: number;
    let popoverY: number;
    if (buttonRect) {
      popoverX = Math.round(originX + buttonRect.left + buttonRect.width / 2 - VOLUME_POPOVER_WINDOW_WIDTH / 2);
      popoverY = Math.round(originY + buttonRect.bottom + 6);
    } else {
      popoverX = Math.round(originX + MINI_PLAYER_WINDOW_WIDTH - VOLUME_POPOVER_WINDOW_WIDTH - 12);
      popoverY = Math.round(originY + MINI_PLAYER_WINDOW_BASE_HEIGHT + 6);
    }

    await target.setAlwaysOnTop(true);
    await target.setPosition(new LogicalPosition(popoverX, popoverY));
    await sync();
    await target.show();
    await target.setFocus();
    shown.value = true;
    await emitTo(VOLUME_POPOVER_WINDOW_LABEL, VOLUME_POPOVER_VISIBILITY_EVENT, { visible: true });
  };

  const dismiss = async () => {
    shown.value = false;
    await emitTo(VOLUME_POPOVER_WINDOW_LABEL, VOLUME_POPOVER_VISIBILITY_EVENT, { visible: false });
  };

  const flip = () => {
    if (shown.value) {
      void dismiss();
    } else {
      options.collapsePlaylist();
      void reveal();
    }
  };

  const start = async () => {
    stopFns.push(await listen<VolumePopoverAction>(VOLUME_POPOVER_ACTION_EVENT, (event) => {
      const action = event.payload;
      if (action.type === 'set-volume') {
        options.volume.value = action.volume;
        options.emitAction({ type: 'set-volume', volume: action.volume });
      } else if (action.type === 'toggle-mute') {
        options.emitAction({ type: 'toggle-mute' });
      } else if (action.type === 'close') {
        shown.value = false;
      }
    }));

    stopFns.push(await listen<{ visible: boolean }>(VOLUME_POPOVER_VISIBILITY_EVENT, (event) => {
      if (!event.payload.visible) {
        shown.value = false;
      }
    }));
  };

  const stop = () => {
    stopFns.splice(0).forEach((off) => off());
    instance?.close().catch(() => {});
  };

  return { shown, flip, dismiss, sync, start, stop };
}
