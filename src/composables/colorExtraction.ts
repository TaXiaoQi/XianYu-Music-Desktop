import { fileApi } from '../services/tauri/fileApi';
import { MemoryCache } from '../utils/MemoryCache';

interface ExtractColorOptions {
  colorBoost?: number;
  depth?: number;
}

interface PaletteQuery {
  source: string;
  count: number;
  colorBoost: number;
  depth: number;
}

const PALETTE_SIZE_DEFAULT = 4;
const COLOR_BOOST_DEFAULT = 56;
const DEPTH_DEFAULT = 58;
const STORE_CAPACITY = 128;
const RECORD_LIFETIME_MS = 900000;
const RPC_DEADLINE_MS = 10000;

/** 后端取色不可用时的兜底配色（与主题推导色保持同一 HSL 表述）。 */
const FALLBACK_HSL_TUPLES: ReadonlyArray<readonly [number, number, number]> = [
  [220, 28, 34],
  [196, 58, 56],
  [340, 52, 58],
  [42, 72, 60],
];

const formatHslTuple = ([hue, sat, light]: readonly [number, number, number]) =>
  `hsl(${hue}, ${sat}%, ${light}%)`;

const paletteStore = new MemoryCache<string, string[]>({
  maxEntries: STORE_CAPACITY,
  ttlMs: RECORD_LIFETIME_MS,
});

export function clearPaletteCache() {
  paletteStore.clear();
}

function buildFallbackPalette(size: number): string[] {
  return FALLBACK_HSL_TUPLES.slice(0, size).map(formatHslTuple);
}

function normalizePaletteQuery(
  source: string,
  count: number,
  options: ExtractColorOptions,
): PaletteQuery {
  return {
    source,
    count,
    colorBoost: options.colorBoost ?? COLOR_BOOST_DEFAULT,
    depth: options.depth ?? DEPTH_DEFAULT,
  };
}

function readStoredPalette(queryKey: string): string[] | undefined {
  const stored = paletteStore.get(queryKey);
  return stored ? [...stored] : undefined;
}

function rememberPalette(queryKey: string, palette: string[]) {
  paletteStore.set(queryKey, [...palette]);
}

/** 给取色 RPC 设一个截止时间，超时直接落回兜底配色，避免封面加载悬挂。 */
function raceAgainstDeadline<T>(task: Promise<T>, deadlineMs: number, deadlineValue: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(deadlineValue), deadlineMs);
  });
  return Promise.race([task, deadline]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

export async function extractDominantColors(
  source: string,
  count: number = PALETTE_SIZE_DEFAULT,
  options: ExtractColorOptions = {},
): Promise<string[]> {
  const query = normalizePaletteQuery(source, count, options);
  const queryKey = JSON.stringify(query);
  const stored = readStoredPalette(queryKey);
  if (stored) {
    return stored;
  }

  const fallbackPalette = buildFallbackPalette(count);

  try {
    const nativePalette = await raceAgainstDeadline(
      fileApi.extractPalette(query.source, query.count, query.colorBoost, query.depth),
      RPC_DEADLINE_MS,
      fallbackPalette,
    );

    const resolvedPalette = nativePalette.length > 0 ? nativePalette : fallbackPalette;
    rememberPalette(queryKey, resolvedPalette);
    return resolvedPalette;
  } catch (error) {
    console.warn('[取色] extract_palette 调用失败，使用回退调色板', error);
    return fallbackPalette;
  }
}
