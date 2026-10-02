import { downloadApi } from '../tauri/downloadApi';

export interface DownloadRecord {
  songPath: string;
  filePath: string;
  fileName: string;
  quality: string;
  downloadedAt: number;
  title?: string;
  artist?: string;
  /** 歌曲时长（毫秒），用于跨源模糊匹配时做时长校验 */
  durationMs?: number;
}

type HistoryMap = Record<string, DownloadRecord>;

let _cache: HistoryMap | null = null;
let _loadingPromise: Promise<HistoryMap> | null = null;

export function fileNameFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function isValidRecord(value: unknown): value is DownloadRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.songPath === 'string'
    && r.songPath.length > 0
    && typeof r.filePath === 'string'
    && r.filePath.length > 0;
}

function sanitizeHistory(raw: unknown): HistoryMap {
  if (!raw || typeof raw !== 'object') return {};
  const result: HistoryMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidRecord(value)) continue;
    result[key] = {
      songPath: value.songPath,
      filePath: value.filePath,
      fileName: value.fileName || fileNameFromPath(value.filePath),
      quality: value.quality || '',
      downloadedAt: typeof value.downloadedAt === 'number' ? value.downloadedAt : 0,
      title: typeof value.title === 'string' ? value.title : undefined,
      artist: typeof value.artist === 'string' ? value.artist : undefined,
      durationMs: typeof value.durationMs === 'number' && value.durationMs > 0 ? value.durationMs : undefined,
    };
  }
  return result;
}

export async function loadDownloadHistory(): Promise<HistoryMap> {
  if (_cache) return _cache;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    try {
      const text = await downloadApi.readDownloadHistory();
      const parsed = JSON.parse(text || '{}');
      _cache = sanitizeHistory(parsed);
    } catch (e) {
      console.warn('[DownloadHistory] 读取下载记录失败，按空记录处理:', e);
      _cache = {};
    }
    _loadingPromise = null;
    return _cache;
  })();

  return _loadingPromise;
}

async function persist(): Promise<void> {
  if (!_cache) return;
  try {
    await downloadApi.writeDownloadHistory(JSON.stringify(_cache, null, 2));
  } catch (e) {
    console.warn('[DownloadHistory] 写入下载记录失败:', e);
  }
}

export async function recordDownload(record: DownloadRecord): Promise<void> {
  const history = await loadDownloadHistory();
  history[record.songPath] = {
    ...record,
    fileName: record.fileName || fileNameFromPath(record.filePath),
  };
  await persist();
}

export function getDownloadRecord(songPath: string): DownloadRecord | null {
  if (!_cache || !songPath) return null;
  return _cache[songPath] ?? null;
}

export async function removeDownloadRecord(songPath: string): Promise<void> {
  const history = await loadDownloadHistory();
  if (!(songPath in history)) return;
  delete history[songPath];
  await persist();
}

export async function checkDownloadExists(songPath: string): Promise<DownloadRecord | null> {
  if (!songPath) return null;
  const history = await loadDownloadHistory();
  const record = history[songPath];
  if (!record) return null;

  let exists = false;
  try {
    exists = await downloadApi.fileExists(record.filePath);
  } catch (e) {
    console.warn('[DownloadHistory] 检查文件存在性失败:', e);
    return null;
  }

  if (!exists) {
    delete history[songPath];
    await persist();
    return null;
  }
  return record;
}

export interface FuzzyDownloadLookup {
  title: string;
  artist?: string;
  /** 当前歌曲时长（毫秒），0 或缺省时跳过时长校验 */
  durationMs?: number;
  excludeSongPath?: string;
}

/** 匹配归一化：小写 + 去所有空白。刻意不去括号内容——"歌名 (DJ版)"
 *  与"歌名"是不同录音，模糊匹配不能跨版本错配。 */
const normForMatch = (s: string): string => (s || '').toLowerCase().replace(/\s+/g, '');

/**
 * 跨源模糊匹配兜底：精确播链键未命中时，按"标题全等 + 歌手互含 + 时长±3s"
 * 在下载记录里找同一首歌其他源的本地文件（对齐移动端 localFileFuzzyFor 语义）。
 */
export async function findDownloadedFileFuzzy(lookup: FuzzyDownloadLookup): Promise<string | null> {
  const normTitle = normForMatch(lookup.title);
  if (!normTitle) return null;
  const normArtist = normForMatch(lookup.artist || '');
  const history = await loadDownloadHistory();

  const candidates = Object.values(history)
    .filter((r) => r.filePath
      && r.songPath !== lookup.excludeSongPath
      && normForMatch(r.title || r.fileName) === normTitle)
    .sort((a, b) => b.downloadedAt - a.downloadedAt);

  for (const r of candidates) {
    const rArtist = normForMatch(r.artist || '');
    const artistOk = !normArtist || !rArtist
      || rArtist === normArtist
      || rArtist.includes(normArtist)
      || normArtist.includes(rArtist);
    if (!artistOk) continue;
    if (r.durationMs && r.durationMs > 0 && lookup.durationMs && lookup.durationMs > 0
      && Math.abs(r.durationMs - lookup.durationMs) > 3000) {
      continue;
    }
    try {
      if (await downloadApi.fileExists(r.filePath)) return r.filePath;
    } catch { /* 单个候选存在性探测失败不阻断后续候选 */ }
  }
  return null;
}

export function __resetDownloadHistoryCacheForTest(): void {
  _cache = null;
  _loadingPromise = null;
}
