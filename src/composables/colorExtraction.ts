/**
 * 颜色提取模块（主线程入口）
 *
 * 公共 API 保持不变：extractDominantColors / clearPaletteCache。
 * 内部将图像加载和像素聚类计算委托给 Web Worker，避免切歌时主线程卡顿。
 * Worker 不可用时回退到静态调色板。
 */

import { MemoryCache } from '../utils/MemoryCache';

interface ExtractColorOptions {
  colorBoost?: number;
  depth?: number;
}

interface WorkerRequest {
  id: number;
  imageUrl: string;
  count: number;
  colorBoost: number;
  depth: number;
}

interface WorkerResponse {
  id: number;
  palette: string[];
  error?: string;
}

const FALLBACK_PALETTE = [
  'hsl(220, 28%, 34%)',
  'hsl(196, 58%, 56%)',
  'hsl(340, 52%, 58%)',
  'hsl(42, 72%, 60%)',
];

const DEFAULT_COUNT = 4;
const PALETTE_CACHE_LIMIT = 128;
const PALETTE_CACHE_TTL_MS = 15 * 60 * 1000;
const paletteCache = new MemoryCache<string, string[]>({
  maxEntries: PALETTE_CACHE_LIMIT,
  ttlMs: PALETTE_CACHE_TTL_MS,
});

// --- Worker 懒初始化 ---

let worker: Worker | null = null;
let workerInitFailed = false;
let requestIdCounter = 0;
const pendingRequests = new Map<number, {
  resolve: (palette: string[]) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}>();

function resolvePendingRequest(id: number, palette: string[]) {
  const pending = pendingRequests.get(id);
  if (!pending) return;

  pendingRequests.delete(id);
  clearTimeout(pending.timeoutId);
  pending.resolve(palette);
}

function resolveAllPendingRequests(palette: string[]) {
  for (const id of Array.from(pendingRequests.keys())) {
    resolvePendingRequest(id, [...palette]);
  }
}

export function releaseColorExtractionWorker() {
  resolveAllPendingRequests(FALLBACK_PALETTE);
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

/**
 * 懒创建颜色提取 Worker。
 * 如果 Worker 构造失败（如非浏览器环境），标记为不可用，后续直接回退。
 */
function getWorker(): Worker | null {
  if (workerInitFailed) return null;
  if (worker) return worker;

  try {
    worker = new Worker(
      new URL('../workers/colorExtraction.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, palette } = event.data;
      resolvePendingRequest(id, palette);
    };
    worker.onerror = () => {
      // Worker 发生不可恢复错误：拒绝所有待处理请求并标记不可用
      releaseColorExtractionWorker();
      workerInitFailed = true;
    };
  } catch {
    workerInitFailed = true;
  }

  return worker;
}

// --- 缓存管理 ---

export function clearPaletteCache() {
  paletteCache.clear();
}

function buildPaletteCacheKey(imageUrl: string, count: number, options: ExtractColorOptions): string {
  return JSON.stringify({
    imageUrl,
    count,
    colorBoost: options.colorBoost ?? 56,
    depth: options.depth ?? 58,
  });
}

function getCachedPalette(cacheKey: string): string[] | undefined {
  const cached = paletteCache.get(cacheKey);
  return cached ? [...cached] : undefined;
}

function setCachedPalette(cacheKey: string, palette: string[]) {
  paletteCache.set(cacheKey, [...palette]);
}

function createFallbackPalette(count: number): string[] {
  return FALLBACK_PALETTE.slice(0, count);
}

// --- 公共 API ---

export async function extractDominantColors(
  imageUrl: string,
  count: number = DEFAULT_COUNT,
  options: ExtractColorOptions = {},
): Promise<string[]> {
  const cacheKey = buildPaletteCacheKey(imageUrl, count, options);
  const cachedPalette = getCachedPalette(cacheKey);
  if (cachedPalette) {
    return cachedPalette;
  }

  const colorBoost = options.colorBoost ?? 56;
  const depth = options.depth ?? 58;
  const activeWorker = getWorker();

  // Worker 不可用时直接返回回退调色板
  if (!activeWorker) {
    const fallback = createFallbackPalette(count);
    setCachedPalette(cacheKey, fallback);
    return fallback;
  }

  // 通过 Worker 提取颜色
  const id = ++requestIdCounter;
  const request: WorkerRequest = { id, imageUrl, count, colorBoost, depth };

  const palette = await new Promise<string[]>((resolve) => {
    // 超时保护：10 秒后自动回退
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(id)) {
        resolvePendingRequest(id, createFallbackPalette(count));
      }
    }, 10_000);

    pendingRequests.set(id, { resolve, timeoutId });
    activeWorker.postMessage(request);
  });

  setCachedPalette(cacheKey, palette);
  return palette;
}

let visibilityCleanupRegistered = false;

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    releaseColorExtractionWorker();
  }
}

function registerVisibilityCleanup() {
  if (visibilityCleanupRegistered || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  visibilityCleanupRegistered = true;
}

function cleanupVisibilityCleanup() {
  if (!visibilityCleanupRegistered || typeof document === 'undefined') {
    return;
  }

  document.removeEventListener('visibilitychange', handleVisibilityChange);
  visibilityCleanupRegistered = false;
  releaseColorExtractionWorker();
}

registerVisibilityCleanup();

if (import.meta.hot) {
  import.meta.hot.dispose(cleanupVisibilityCleanup);
}
