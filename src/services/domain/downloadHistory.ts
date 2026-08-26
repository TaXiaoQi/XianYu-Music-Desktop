/**
 * 下载记录服务
 *
 * 记录每次下载过的在线歌曲（下载位置 + 文件名 + 音质），持久化到
 * `%APPDATA%\com.xymusic.desktop\download_history.json`（由 Rust 侧命令读写）。
 *
 * 用途：播放到某首歌时判断它是否已经下载过且文件仍存在，
 * 让 UI 把下载按钮切换成「已下载」状态，避免用户重复下载。
 *
 * 记录以歌曲 path（`lx://source/songmid`）为 key，重复下载同一首歌会覆盖旧记录。
 */
import { downloadApi } from '../tauri/downloadApi';

export interface DownloadRecord {
  /** 歌曲标识，形如 `lx://kg/song123` */
  songPath: string;
  /** 下载文件的完整路径（含文件名） */
  filePath: string;
  /** 文件名（便于 UI 展示与用户手动核对） */
  fileName: string;
  /** 实际命中的音质档位，如 `320k` / `flac` */
  quality: string;
  /** 下载完成时间戳（毫秒） */
  downloadedAt: number;
  /** 歌曲标题（便于将来做下载管理页展示） */
  title?: string;
  /** 歌手名 */
  artist?: string;
}

type HistoryMap = Record<string, DownloadRecord>;

/**
 * 内存缓存，避免每次切歌都读文件。
 * null 表示尚未从磁盘加载过。
 */
let _cache: HistoryMap | null = null;
/** 并发加载去重：多处同时首次调用时共用同一个 Promise */
let _loadingPromise: Promise<HistoryMap> | null = null;

/** 从完整路径中取出文件名（兼容 Windows 反斜杠与正斜杠） */
export function fileNameFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/** 校验一条记录是否结构完整（防止手改文件或旧版本格式导致崩溃） */
function isValidRecord(value: unknown): value is DownloadRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.songPath === 'string'
    && r.songPath.length > 0
    && typeof r.filePath === 'string'
    && r.filePath.length > 0;
}

/** 过滤掉结构不合法的条目，并补齐可选字段 */
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

/** 读取下载记录（带内存缓存）。任何失败都退化为空记录，不影响下载功能本身。 */
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

/** 把当前缓存落盘 */
async function persist(): Promise<void> {
  if (!_cache) return;
  try {
    await downloadApi.writeDownloadHistory(JSON.stringify(_cache, null, 2));
  } catch (e) {
    console.warn('[DownloadHistory] 写入下载记录失败:', e);
  }
}

/** 记录一次下载（同一首歌覆盖旧记录）并立即落盘 */
export async function recordDownload(record: DownloadRecord): Promise<void> {
  const history = await loadDownloadHistory();
  history[record.songPath] = {
    ...record,
    fileName: record.fileName || fileNameFromPath(record.filePath),
  };
  await persist();
}

/**
 * 同步查询内存缓存里的记录（不校验文件是否存在）。
 * 供 UI 做快速预判；权威判断请用 checkDownloadExists。
 */
export function getDownloadRecord(songPath: string): DownloadRecord | null {
  if (!_cache || !songPath) return null;
  return _cache[songPath] ?? null;
}

/** 删除一条记录并落盘 */
export async function removeDownloadRecord(songPath: string): Promise<void> {
  const history = await loadDownloadHistory();
  if (!(songPath in history)) return;
  delete history[songPath];
  await persist();
}

/**
 * 判断某首歌是否「已下载且文件仍存在」。
 *
 * 存在 → 返回记录；文件已被用户移动或删除 → 顺手清理该条失效记录并返回 null，
 * 让 UI 回落到普通下载按钮。
 */
export async function checkDownloadExists(songPath: string): Promise<DownloadRecord | null> {
  if (!songPath) return null;
  const history = await loadDownloadHistory();
  const record = history[songPath];
  if (!record) return null;

  let exists = false;
  try {
    exists = await downloadApi.fileExists(record.filePath);
  } catch (e) {
    // 检查失败时保守视为不存在，但保留记录（可能只是一次 IPC 抖动）
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

/** 仅供测试：重置内存缓存 */
export function __resetDownloadHistoryCacheForTest(): void {
  _cache = null;
  _loadingPromise = null;
}
