import {pluginApi} from '../../services/tauri/pluginApi';


export interface PreviewClipInfo {
  start: number;
  duration: number;
}

export function isPluginPath(path: string): boolean {
  return path.startsWith('plugin://');
}

export function isQishuiPluginPath(path: string): boolean {
  return path.startsWith('plugin://汽水音乐');
}

export function extractPluginTrackId(path: string): string {
  const rest = path.slice('plugin://'.length);
  return rest.split('/').pop() || '';
}

export function isOnlineStreamPath(path: string): boolean {
  return !!path
    && (path.startsWith('http://')
      || path.startsWith('https://')
      || path.startsWith('lx://')
      || path.startsWith('plugin://')
      || path.startsWith('remote://'));
}

const QISHUI_SEO_TRACK_URL = 'https://beta-luna.douyin.com/luna/h5/seo_track';

const qishuiPreviewCache = new Map<string, PreviewClipInfo>();
const qishuiPreviewInflight = new Map<string, Promise<PreviewClipInfo | null>>();

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

export function hasQishuiPreviewCached(trackId: string): boolean {
  return qishuiPreviewCache.has(trackId);
}

export function formatPreviewClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function isPreviewLikeStream(actualDuration: number, songDuration: number): boolean {
  return actualDuration > 0
    && songDuration >= 100
    && actualDuration <= 120
    && actualDuration + 30 <= songDuration;
}