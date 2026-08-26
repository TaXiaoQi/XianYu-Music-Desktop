import {pluginApi} from '../../services/tauri/pluginApi';

/**
 * 在线播放失败兜底与试听片段检测域。
 *
 * - 试听片段检测：部分插件（如汽水音乐）对 VIP 歌曲匿名只返回 30~60 秒试听片段，且
 *   片段截取自歌曲中段。这里通过实际音频时长与元数据时长的差异识别试听流，并提供
 *   片段起点/时长映射（汽水来自 SEO 端点），使进度条与歌词对齐片段在原曲中的位置。
 * - 在线流判定：区分网络直链/在线协议路径，供停滞结束判定等复用。
 */

export interface PreviewClipInfo {
  /** 片段在完整歌曲中的起点（秒） */
  start: number;
  /** 片段实际时长（秒） */
  duration: number;
}

export function isPluginPath(path: string): boolean {
  return path.startsWith('plugin://');
}

export function isQishuiPluginPath(path: string): boolean {
  return path.startsWith('plugin://汽水音乐');
}

/** 从 plugin://平台名/trackId 形式的路径中提取插件歌曲 ID */
export function extractPluginTrackId(path: string): string {
  const rest = path.slice('plugin://'.length);
  return rest.split('/').pop() || '';
}

/** 判断 path 是否为需要走后端流式播放的在线动态源（区别于本地文件） */
export function isOnlineStreamPath(path: string): boolean {
  return !!path
    && (path.startsWith('http://')
      || path.startsWith('https://')
      || path.startsWith('lx://')
      || path.startsWith('plugin://')
      || path.startsWith('remote://'));
}

const QISHUI_SEO_TRACK_URL = 'https://beta-luna.douyin.com/luna/h5/seo_track';

/** 汽水歌曲试听元数据缓存：trackId → 片段信息（起点/时长来自 SEO 端点） */
const qishuiPreviewCache = new Map<string, PreviewClipInfo>();
/** 进行中的汽水试听元数据请求，避免播放预热与检测重复请求 */
const qishuiPreviewInflight = new Map<string, Promise<PreviewClipInfo | null>>();

/** 读取汽水歌曲的试听元数据（片段起点/时长），匿名可访问，带缓存与去重 */
export async function fetchQishuiPreviewInfo(trackId: string): Promise<PreviewClipInfo | null> {
  const cached = qishuiPreviewCache.get(trackId);
  if (cached) return cached;
  const inflight = qishuiPreviewInflight.get(trackId);
  if (inflight) return inflight;

  const request = (async (): Promise<PreviewClipInfo | null> => {
    try {
      const resp = await pluginApi.pluginHttpRequest(
        'GET',
        `${QISHUI_SEO_TRACK_URL}?track_id=${encodeURIComponent(trackId)}&device_platform=web`,
        undefined, undefined, 8000,
      );
      if (resp.status < 200 || resp.status >= 300) return null;
      const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
      const track = data?.seo_track?.track;
      const preview = track?.preview;
      const fullDurationMs = Number(track?.duration) || 0;
      const previewDurationMs = Number(preview?.duration) || 0;
      const startMs = Number(preview?.start);
      // 仅当试听时长明显小于完整时长时才视为试听配置
      if (
        Number.isFinite(startMs) && startMs >= 0
        && previewDurationMs > 0 && fullDurationMs > previewDurationMs
      ) {
        const info = { start: startMs / 1000, duration: previewDurationMs / 1000 };
        qishuiPreviewCache.set(trackId, info);
        return info;
      }
    } catch { /* 匿名访问失败或网络异常时按无偏移处理 */ }
    return null;
  })();

  qishuiPreviewInflight.set(trackId, request);
  try {
    return await request;
  } finally {
    qishuiPreviewInflight.delete(trackId);
  }
}

/** 查询汽水试听缓存是否已预热（播放预热复用，避免重复请求） */
export function hasQishuiPreviewCached(trackId: string): boolean {
  return qishuiPreviewCache.has(trackId);
}

export function formatPreviewClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 试听检测条件：实际音频为短片段且远小于元数据时长（如 52s vs 261s） */
export function isPreviewLikeStream(actualDuration: number, songDuration: number): boolean {
  return actualDuration > 0
    && songDuration >= 100
    && actualDuration <= 120
    && actualDuration + 30 <= songDuration;
}