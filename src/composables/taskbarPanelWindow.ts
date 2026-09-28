// 任务栏播控窗口的生命周期与布局引擎。
// 包含：窗口查寻与创建（含就绪闸门）、状态回执闸门、
// 固定尺寸/置顶强化、基于任务栏几何的定位求解与并发收敛、DPI 变化后的布局重试调度。
// 事件名 / 尺寸常量 / 存储键均取自 src/features/taskbarPlayer/shared.ts，值不可改动。

import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, primaryMonitor } from '@tauri-apps/api/window';

import { windowApi } from '../services/tauri/windowApi';
import { solvePanelAnchor, toLogicalBox } from './taskbarGeometry';
import {
  TASKBAR_PLAYER_POSITION_X_KEY,
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  TASKBAR_PLAYER_WINDOW_LABEL,
  TASKBAR_PLAYER_WINDOW_WIDTH,
} from '../features/taskbarPlayer/shared';

let panelCreation: Promise<WebviewWindow> | null = null;
let panelGateOpen = false;
let panelGatePending: Promise<void> | null = null;
let openPanelGate: (() => void) | null = null;
let appliedGateRelease: (() => void) | null = null;
let dragInProgress = false;
let placementBusy = false;
let placementQueued = false;

/** 记录播控窗口是否处于用户拖拽中（拖拽期间暂停自动定位） */
export const setPanelDragging = (dragging: boolean) => {
  dragInProgress = dragging;
};

export const isPanelDragging = () => dragInProgress;

/** 读取用户拖拽记忆的横向位置（localStorage 不可用或无记录时返回 null） */
const readStoredPositionX = (): number | null => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(TASKBAR_PLAYER_POSITION_X_KEY);
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export const findPanelWindow = async () => WebviewWindow.getByLabel(TASKBAR_PLAYER_WINDOW_LABEL);

/** 仅清除窗口创建缓存（窗口被销毁后调用） */
export const forgetPanelWindow = () => {
  panelCreation = null;
};

// —— 就绪闸门：播控窗口前端挂载完成后由 READY 事件打开，超时自动放行 ——

export const releasePanelGate = () => {
  panelGateOpen = true;
  openPanelGate?.();
  openPanelGate = null;
  panelGatePending = null;
};

export const untilPanelGateOpen = (limitMs = 1500) => {
  if (panelGateOpen) return Promise.resolve();
  if (!panelGatePending) {
    panelGatePending = new Promise<void>((finish) => {
      openPanelGate = finish;
      window.setTimeout(finish, limitMs);
    });
  }
  return panelGatePending;
};

// —— 状态回执闸门：每次推送前布防，收到 state-applied 事件后放行 ——

export const armStateAppliedGate = (limitMs = 500) =>
  new Promise<void>((finish) => {
    appliedGateRelease = finish;
    window.setTimeout(finish, limitMs);
  });

export const signalStateApplied = () => {
  appliedGateRelease?.();
  appliedGateRelease = null;
};

// —— 布局引擎 ——

/** 计算并把窗口摆到目标位置；拖拽中与并发场景下按登记/收敛策略处理 */
async function placePanel() {
  if (dragInProgress) return;

  const panel = await findPanelWindow();
  if (!panel) return;

  // 上一次定位尚未结束时只登记一次待办，由本次循环尾部消化
  if (placementBusy) {
    placementQueued = true;
    return;
  }

  placementBusy = true;
  try {
    for (;;) {
      placementQueued = false;

      // 主显示器：优先 primaryMonitor，失败时回退到第一块可用显示器
      let screen = await primaryMonitor().catch(() => null);
      if (!screen) {
        const candidates = await availableMonitors().catch(() => []);
        screen = candidates[0] ?? null;
      }
      const dpi = screen?.scaleFactor ?? 1;

      const geometry = await windowApi.getTaskbarTrayGeometry().catch((err) => {
        console.warn('taskbar tray geometry query failed:', err);
        return null;
      });
      if (!geometry) break;

      // Rust 层按进程 DPI awareness 返回物理像素，这里一次性换算为逻辑像素
      const bar = toLogicalBox(geometry.taskbar_rect_physical, dpi);
      const tray = geometry.tray_rect_physical ? toLogicalBox(geometry.tray_rect_physical, dpi) : null;
      const areaOrigin = screen ? screen.workArea.position.toLogical(dpi) : { x: 0, y: 0 };
      const areaExtent = screen ? screen.workArea.size.toLogical(dpi) : { width: 1920, height: 1040 };

      const anchor = solvePanelAnchor({
        bar,
        tray,
        trayAnchored: geometry.source === 'tray',
        area: { x: areaOrigin.x, y: areaOrigin.y, width: areaExtent.width, height: areaExtent.height },
        winW: TASKBAR_PLAYER_WINDOW_WIDTH,
        winH: TASKBAR_PLAYER_WINDOW_HEIGHT,
        rememberedX: readStoredPositionX(),
      });

      await panel.setPosition(new LogicalPosition(Math.round(anchor.x), Math.round(anchor.y)))
        .catch((err) => console.warn('taskbar player position apply failed:', err));

      if (!placementQueued) break;
    }
  } finally {
    placementBusy = false;
  }
}

const applyFixedSize = async (panel: WebviewWindow) => {
  await panel.setSize(new LogicalSize(TASKBAR_PLAYER_WINDOW_WIDTH, TASKBAR_PLAYER_WINDOW_HEIGHT))
    .catch((err) => console.warn('taskbar player size normalize failed:', err));
};

const reinforceTopmost = async (panel: WebviewWindow) => {
  await panel.setAlwaysOnTop(true);
  await windowApi.refreshTaskbarWindowTopmost().catch((err) => {
    console.warn('taskbar player topmost refresh failed:', err);
  });
};

/** 尺寸 → 定位 → 置顶 的一次完整布局对齐 */
export const syncPanelLayout = async (panel: WebviewWindow) => {
  await applyFixedSize(panel);
  await placePanel();
  await reinforceTopmost(panel);
};

/** DPI 变化后的多级延迟重试，等待系统完成任务栏/显示器参数刷新 */
const RETRY_DELAYS_MS = [120, 350, 900, 1600];

export const queueLayoutRetries = (panel: WebviewWindow) => {
  void syncPanelLayout(panel);
  for (const delay of RETRY_DELAYS_MS) {
    window.setTimeout(() => void syncPanelLayout(panel), delay);
  }
};

// —— 窗口创建 ——

export const ensurePanelWindow = async () => {
  const existing = await findPanelWindow();
  if (existing) return existing;
  if (panelCreation) return panelCreation;

  // 新一轮创建前复位就绪闸门
  panelGateOpen = false;
  panelGatePending = null;
  openPanelGate = null;

  panelCreation = (async () => {
    const panel = new WebviewWindow(TASKBAR_PLAYER_WINDOW_LABEL, {
      url: '/',
      title: 'XianYu Music Taskbar Player',
      width: TASKBAR_PLAYER_WINDOW_WIDTH, height: TASKBAR_PLAYER_WINDOW_HEIGHT,
      minWidth: TASKBAR_PLAYER_WINDOW_WIDTH, minHeight: TASKBAR_PLAYER_WINDOW_HEIGHT,
      maxWidth: TASKBAR_PLAYER_WINDOW_WIDTH, maxHeight: TASKBAR_PLAYER_WINDOW_HEIGHT,
      visible: false, decorations: false,
      transparent: true, shadow: false,
      resizable: false, skipTaskbar: true, alwaysOnTop: true,
      // Vue 端交互依赖可聚焦；点击抢占焦点的问题由 Rust 层 WS_EX_NOACTIVATE 扩展样式处理
      focusable: true,
      center: false, x: 100, y: 100,
    });

    return new Promise<WebviewWindow>((done, fail) => {
      let finalized = false;

      void panel.once('tauri://created', () => {
        if (finalized) return;
        // Rust 侧应用 WS_EX_NOACTIVATE 扩展样式并绑定主任务栏 Owner
        windowApi.setupTaskbarWindow().then(
          () => { finalized = true; panelCreation = null; done(panel); },
          (error) => { finalized = true; panelCreation = null; fail(error); },
        );
      });

      void panel.once('tauri://error', (event) => {
        if (finalized) return;
        finalized = true;
        panelCreation = null;
        fail(event.payload);
      });
    });
  })();

  return panelCreation;
};
