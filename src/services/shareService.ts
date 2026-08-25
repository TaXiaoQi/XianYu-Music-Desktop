/**
 * 歌曲分享服务
 *
 * - 调用服务端 `create_share` 生成分享链接（落地页 /s/{shareId} 不做网页播放，仅拉起客户端）。
 * - 现有签名请求封装在 Rust 侧完成，前端只需传 action + body。
 * - 播放时预加载分享链接：同一首歌只生成一次并缓存，避免用户点分享时才等网络。
 */
import { signedRequest } from './auth/authService';
import type { Song } from '../types';

interface ShareCacheEntry {
  url?: string;
  pending?: Promise<string>;
}

const shareCache = new Map<string, ShareCacheEntry>();

function shareCacheKey(song: Song): string {
  return [song?.id, song?.path, song?.title || song?.name].join('|');
}

/** 在线歌曲的插件原始数据（对应移动端 onlineSongJson），容错返回对象 */
function songSourceMap(song: Song): { source: Record<string, any>; info: Record<string, any> } {
  const raw = (song as any)?.rawData;
  const source = raw && typeof raw === 'object' ? raw : {};
  const info = source.musicInfo && typeof source.musicInfo === 'object' ? source.musicInfo : {};
  return { source, info };
}

/**
 * 取歌曲音源定位标识（统一契约：与移动端 share_service.dart 同构）。
 * hash 是卡片拉起客户端的核心定位键 —— 优先顶层 hash，其次插件原始数据 hash，
 * 再回退 songmid/mid（QQ系歌曲）。保证两端同一首歌生成一致的深链。
 */
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

/** 取歌曲稳定标识（统一契约：本地主键优先，否则回退来源 path）。 */
function getSongId(song: Song): string {
  return song?.id != null ? String(song.id) : song?.path || '';
}

/** 构造 create_share 请求体 */
function buildShareBody(song: Song, coverUrl?: string): Record<string, unknown> {
  return {
    song_name: song?.title || song?.name || '',
    singer: song?.artist || '',
    cover_url: coverUrl && /^https?:\/\//i.test(coverUrl) ? coverUrl : '',
    song_id: getSongId(song),
    hash: getSongHash(song),
    duration_ms: Math.round((song?.duration || 0) * 1000),
  };
}

/** 是否已有该歌曲的分享链接（缓存命中） */
export function getCachedShareUrl(song: Song | null | undefined): string | null {
  if (!song) return null;
  return shareCache.get(shareCacheKey(song))?.url ?? null;
}

/** 获取（必要时创建）分享链接；已缓存直接返回，否则请求服务端并缓存 */
export async function createShareUrl(song: Song, coverUrl?: string): Promise<string> {
  if (!song) throw new Error('当前没有可分享的歌曲');
  const key = shareCacheKey(song);
  const existing = shareCache.get(key);
  if (existing?.url) return existing.url;
  if (existing?.pending) return existing.pending;

  const pending = signedRequest<{ share_url: string }>('create_share', buildShareBody(song, coverUrl), {
    timeoutMs: 15_000,
  })
    .then(data => {
      const url = String(data?.share_url || '');
      shareCache.set(key, { url });
      return url;
    })
    .catch(error => {
      shareCache.delete(key);
      throw error;
    });

  shareCache.set(key, { pending });
  return pending;
}

/** 预加载当前歌曲分享链接（fire-and-forget，失败静默，勿阻塞播放） */
export function preloadShareUrl(song: Song | null | undefined, coverUrl?: string): void {
  if (!song) return;
  const key = shareCacheKey(song);
  if (shareCache.has(key)) return;
  const pending = createShareUrl(song, coverUrl).catch(() => '');
  shareCache.set(key, { pending });
}