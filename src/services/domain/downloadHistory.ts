import { downloadApi } from '../tauri/downloadApi';

export interface DownloadRecord {
  songPath: string;
  filePath: string;
  fileName: string;
  quality: string;
  downloadedAt: number;
  title?: string;
  artist?: string;
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

export function __resetDownloadHistoryCacheForTest(): void {
  _cache = null;
  _loadingPromise = null;
}
