import { availableMonitors } from '@tauri-apps/api/window';

import {
  MINI_PLAYER_WINDOW_BASE_HEIGHT,
  MINI_PLAYER_WINDOW_EXPANDED_HEIGHT,
  MINI_PLAYER_WINDOW_WIDTH,
} from '../features/miniPlayer/shared';
import { stateApi } from '../services/tauri/stateApi';

export interface MiniWindowAnchor {
  x: number;
  y: number;
}

// state store 与 localStorage 共用的落盘键，改动会导致窗口位置记忆失效。
const ANCHOR_STORAGE_KEY = 'mini_player_window_bounds';

interface WorkAreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function parseAnchorBlob(blob: string): MiniWindowAnchor | null {
  try {
    const raw = JSON.parse(blob) as { x?: unknown; y?: unknown };
    if (typeof raw?.x !== 'number' || !Number.isFinite(raw.x)) return null;
    if (typeof raw?.y !== 'number' || !Number.isFinite(raw.y)) return null;
    return { x: Math.round(raw.x), y: Math.round(raw.y) };
  } catch {
    return null;
  }
}

export async function loadPersistedAnchor(): Promise<MiniWindowAnchor | null> {
  let blob: string | null = null;
  try {
    blob = await stateApi.readStateJson(ANCHOR_STORAGE_KEY);
  } catch {
    blob = null;
  }

  if (!blob && typeof localStorage !== 'undefined') {
    blob = localStorage.getItem(ANCHOR_STORAGE_KEY);
  }

  return blob === null ? null : parseAnchorBlob(blob);
}

export async function persistAnchor(anchor: MiniWindowAnchor): Promise<void> {
  const rounded: MiniWindowAnchor = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
  const blob = JSON.stringify(rounded);

  try {
    await stateApi.writeStateJson(ANCHOR_STORAGE_KEY, blob);
  } catch {
    /* 磁盘不可写时静默降级到 localStorage */
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ANCHOR_STORAGE_KEY, blob);
  }
}

async function collectWorkAreas(): Promise<WorkAreaRect[]> {
  const monitors = await availableMonitors();
  const areas: WorkAreaRect[] = [];

  for (const monitor of monitors) {
    const scale = monitor.scaleFactor || 1;
    const origin = monitor.workArea.position.toLogical(scale);
    const extent = monitor.workArea.size.toLogical(scale);
    areas.push({ x: origin.x, y: origin.y, width: extent.width, height: extent.height });
  }

  return areas;
}

function pickClosestArea(areas: WorkAreaRect[], focusX: number, focusY: number): WorkAreaRect {
  let closest = areas[0];
  let closestGap = Number.POSITIVE_INFINITY;

  for (const area of areas) {
    const gap =
      (area.x + area.width / 2 - focusX) ** 2 +
      (area.y + area.height / 2 - focusY) ** 2;
    if (gap < closestGap) {
      closestGap = gap;
      closest = area;
    }
  }

  return closest;
}

export async function fitAnchorIntoViewport(
  anchor: MiniWindowAnchor | null,
): Promise<MiniWindowAnchor | null> {
  if (anchor === null) return null;

  try {
    const areas = await collectWorkAreas();
    if (areas.length === 0) return anchor;

    // 以“展开态窗口中心”挑显示器，再按展开态尺寸夹回工作区。
    const focusX = anchor.x + MINI_PLAYER_WINDOW_WIDTH / 2;
    const focusY = anchor.y + MINI_PLAYER_WINDOW_BASE_HEIGHT / 2;
    const area = pickClosestArea(areas, focusX, focusY);

    const maxX = area.x + Math.max(0, area.width - MINI_PLAYER_WINDOW_WIDTH);
    const maxY = area.y + Math.max(0, area.height - MINI_PLAYER_WINDOW_EXPANDED_HEIGHT);

    return {
      x: Math.round(Math.min(maxX, Math.max(area.x, anchor.x))),
      y: Math.round(Math.min(maxY, Math.max(area.y, anchor.y))),
    };
  } catch {
    return anchor;
  }
}
