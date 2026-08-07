/**
 * 颜色提取模块（主线程入口）
 *
 * 计算已迁移到 Rust 侧（src-tauri/src/music/palette.rs 的 extract_palette 命令），
 * 前端仅保留：内存缓存、超时保护、静态回退调色板。
 * 不再使用 Web Worker，切歌取色不再占用 Worker 线程。
 */

import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';

interface ExtractColorOptions {
  colorBoost?: number;
  depth?: number;
}

const FALLBACK_PALETTE = [
  'hsl(220, 28%, 34%)',
  'hsl(196, 58%, 56%)',
  'hsl(340, 52%, 58%)',
  'hsl(42, 72%, 60%)',
];

const DEFAULT_COUNT = 4;
const DEFAULT_COLOR_BOOST = 56;
const DEFAULT_DEPTH = 58;
const PALETTE_CACHE_LIMIT = 128;
const PALETTE_CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const paletteCache = new MemoryCache<string, string[]>({
  maxEntries: PALETTE_CACHE_LIMIT,
  ttlMs: PALETTE_CACHE_TTL_MS,
});

export function clearPaletteCache() {
  paletteCache.clear();
}

function buildPaletteCacheKey(source: string, count: number, options: ExtractColorOptions): string {
  return JSON.stringify({
    source,
    count,
    colorBoost: options.colorBoost ?? DEFAULT_COLOR_BOOST,
    depth: options.depth ?? DEFAULT_DEPTH,
  });
}

function createFallbackPalette(count: number): string[] {
  return FALLBACK_PALETTE.slice(0, count);
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>(resolve => {
    timeoutId = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).then(result => {
    if (timeoutId) clearTimeout(timeoutId);
    return result;
  });
}

/**
 * 从封面提取主色调调色板。
 *
 * `source` 可为：本地文件路径、`http(s)://` 直链、`data:` URI。
 * 命中缓存时直接返回；否则调用 Rust 侧 `extract_palette`，并在 10 秒超时后回退。
 */
export async function extractDominantColors(
  source: string,
  count: number = DEFAULT_COUNT,
  options: ExtractColorOptions = {},
): Promise<string[]> {
  const colorBoost = options.colorBoost ?? DEFAULT_COLOR_BOOST;
  const depth = options.depth ?? DEFAULT_DEPTH;

  const cacheKey = buildPaletteCacheKey(source, count, options);
  const cachedPalette = paletteCache.get(cacheKey);
  if (cachedPalette) {
    return [...cachedPalette];
  }

  const fallback = createFallbackPalette(count);

  try {
    const palette = await withTimeout(
      tauriInvoke('extract_palette', { source, count, colorBoost, depth }),
      REQUEST_TIMEOUT_MS,
      fallback,
    );

    const result = palette.length > 0 ? palette : fallback;
    paletteCache.set(cacheKey, [...result]);
    return result;
  } catch (error) {
    console.warn('[取色] extract_palette 调用失败，使用回退调色板', error);
    return fallback;
  }
}
