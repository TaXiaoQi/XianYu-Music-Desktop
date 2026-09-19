import { signedRequest } from '../auth/authService';
import { fileApi } from '../tauri/fileApi';
import { readImageBase64 } from '../tauri/pluginApi';
import { getStoredPlugins } from './pluginEngine';
import type { Song } from '../../types';

interface ShareCacheEntry {
  url?: string;
  pending?: Promise<string>;
}

const shareCache = new Map<string, ShareCacheEntry>();

function shareCacheKey(song: Song): string {
  return [song?.id, song?.path, song?.title || song?.name].join('|');
}

function songSourceMap(song: Song): { source: Record<string, any>; info: Record<string, any> } {
  const raw = (song as any)?.rawData;
  const source = raw && typeof raw === 'object' ? raw : {};
  const info = source.musicInfo && typeof source.musicInfo === 'object' ? source.musicInfo : {};
  return { source, info };
}

function getSongHash(song: Song): string {
  const s = song as any;
  const { source, info } = songSourceMap(song);
  return (
    (s?.hash as string) ||
    (source?.hash as string) ||
    (info?.hash as string) ||
    (source?.songmid as string) ||
    (source?.mid as string) ||
    (info?.songmid as string) ||
    (info?.mid as string) ||
    ''
  );
}

function getSongSource(song: Song): string {
  const s = song as any;
  const path = typeof s?.path === 'string' ? s.path : '';
  if (path.startsWith('lx://')) {
    return path.slice('lx://'.length).split('/')[0] || 'local';
  }
  if (path.startsWith('plugin://')) {
    const pid = path.slice('plugin://'.length).split('/')[0] || '';
    const plugin = pid ? getStoredPlugins().find((p) => p.id === pid) : null;
    const platform =
      Array.isArray(plugin?.sources) && plugin.sources.length
        ? plugin.sources[0]
        : '';
    return platform || plugin?.name || pid || 'local';
  }
  if (s?.source_type === 'local' || s?.sourceType === 'local') return 'local';
  const { source, info } = songSourceMap(song);
  const candidate =
    (s?.source as string) ||
    (s?.plugin_id as string) ||
    (source?.source as string) ||
    (info?.source as string) ||
    (source?.plugin_id as string) ||
    (info?.plugin_id as string) ||
    '';
  return candidate || 'local';
}

function getSongId(song: Song): string {
  return song?.id != null ? String(song.id) : song?.path || '';
}

function buildShareBody(
  song: Song,
  coverUrl?: string,
  extra?: Partial<{ expireMinutes: number; source: string }>,
): Record<string, unknown> {
  const raw = extra?.expireMinutes ?? 120;
  const expireMinutes = Math.min(24 * 60, Math.max(5, Math.round(raw)));
  return {
    song_name: song?.title || song?.name || '',
    singer: song?.artist || '',
    cover_url: coverUrl && /^https?:\/\//i.test(coverUrl) ? coverUrl : '',
    song_id: getSongId(song),
    hash: getSongHash(song),
    duration_ms: Math.round((song?.duration || 0) * 1000),
    source: extra?.source || getSongSource(song),
    expire_minutes: expireMinutes,
  };
}

function isRemoteCoverUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host !== 'asset.localhost' && host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
}

function assetUrlToPath(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== 'asset.localhost') return '';
    return decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

function toLocalCoverPath(candidate: string): string {
  if (!candidate) return '';
  if (isRemoteCoverUrl(candidate)) return '';
  return assetUrlToPath(candidate) || candidate;
}

async function resolveShareCover(song: Song, coverUrl?: string): Promise<string> {
  const s = song as any;
  const log = (...args: unknown[]) => console.warn('[shareCover]', ...args);
  if (coverUrl && isRemoteCoverUrl(coverUrl)) return coverUrl;
  try {
    if (coverUrl && /^data:image\//i.test(coverUrl)) {
      return (await uploadCoverDataUrl(coverUrl)) || '';
    }
    const isOnline =
      s?.source_type === 'remote' ||
      s?.source_type === 'plugin' ||
      s?.sourceType === 'remote' ||
      s?.sourceType === 'plugin';
    const lookupPath = s?.cue_source_path || song.path;
    let rawPath = '';
    if (!isOnline) {
      try {
        rawPath = (await fileApi.getSongCover(lookupPath)) || '';
      } catch (e: any) {
        log('getSongCover failed', lookupPath, e?.message || e);
        rawPath = '';
      }
      if (!rawPath) {
        try {
          rawPath = (await fileApi.getSongCoverThumbnail(lookupPath)) || '';
        } catch (e: any) {
          log('getSongCoverThumbnail failed', lookupPath, e?.message || e);
          rawPath = '';
        }
      }
    }
    if (!rawPath) rawPath = toLocalCoverPath(coverUrl || '');
    if (!rawPath) rawPath = toLocalCoverPath(s?.cover_thumb_path || '');
    if (!rawPath) {
      log('no cover path', { coverUrl, cover_thumb_path: s?.cover_thumb_path, songPath: song.path });
      return '';
    }
    const { mime, base64 } = await readImageBase64(rawPath);
    if (!base64) {
      log('readImageBase64 empty', rawPath);
      return '';
    }
    const dataUrl = `data:${mime || 'image/jpeg'};base64,${base64}`;
    const res = await uploadCoverDataUrl(dataUrl);
    log('upload_cover ok', res, 'rawPath=', rawPath, 'dataUrlLen=', dataUrl.length);
    return res || '';
  } catch (e: any) {
    log('resolveShareCover failed', e?.message || e);
    return '';
  }
}

async function uploadCoverDataUrl(dataUrl: string): Promise<string> {
  const res = await signedRequest<{ cover_url?: string }>(
    'upload_cover',
    { image_data: dataUrl },
    { timeoutMs: 20_000, fetchTimeoutMs: 18_000 },
  );
  return res?.cover_url || '';
}

export function getCachedShareUrl(song: Song | null | undefined): string | null {
  if (!song) return null;
  return shareCache.get(shareCacheKey(song))?.url ?? null;
}

export async function createShareUrl(
  song: Song,
  coverUrl?: string,
  extra?: ShareBodyExtra,
): Promise<string> {
  if (!song) throw new Error('当前没有可分享的歌曲');
  const key = shareCacheKey(song);
  const existing = shareCache.get(key);
  if (existing?.url) return existing.url;
  if (existing?.pending) return existing.pending;

  const pending = (async () => {
    const resolvedCover = await resolveShareCover(song, coverUrl);
    const data = await signedRequest<{ share_url: string }>(
      'create_share',
      buildShareBody(song, resolvedCover, extra),
      {
        timeoutMs: 15_000,
      },
    );
    const url = String(data?.share_url || '');
    if (resolvedCover) shareCache.set(key, { url });
    else shareCache.delete(key);
    return url;
  })()
    .catch(error => {
      shareCache.delete(key);
      throw error;
    });

  shareCache.set(key, { pending });
  return pending;
}

type ShareBodyExtra = Partial<{ expireMinutes: number; source: string }>;

export function preloadShareUrl(
  song: Song | null | undefined,
  coverUrl?: string,
  extra?: ShareBodyExtra,
): void {
  if (!song) return;
  const key = shareCacheKey(song);
  if (shareCache.has(key)) return;
  const pending = createShareUrl(song, coverUrl, extra).catch(() => '');
  shareCache.set(key, { pending });
}

export function reportShareAction(): void {
  signedRequest<any>('report_share_action', {}).catch(() => {});
}