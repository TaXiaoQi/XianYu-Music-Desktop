/**
 * 歌曲分享服务
 *
 * - 调用服务端 `create_share` 生成分享链接（落地页 /s/{shareId} 不做网页播放，仅拉起客户端）。
 * - 现有签名请求封装在 Rust 侧完成，前端只需传 action + body。
 * - 播放时预加载分享链接：同一首歌只生成一次并缓存，避免用户点分享时才等网络。
 */
import { signedRequest } from './auth/authService';
import { fileApi } from './tauri/fileApi';
import { readImageBase64 } from './tauri/pluginApi';
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

/** 取歌曲音源定位标识（统一契约：与移动端 share_service.dart 同构）。
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

/**
 * 取歌曲「来源信息」（统一契约：与移动端 share_service.dart 同构）。
 * 按播放协议提取：lx://<source>/<songmid> → 音源 key（kw/wy/kg/tx/mg）；
 * plugin://<platform>/<id> → 插件标识（插件名或插件 id，如「酷我音乐」）；
 * 本地歌曲标记为 'local'。服务端透传进深链，客户端据此显示来源并选择播放路径。
 */
function getSongSource(song: Song): string {
  const s = song as any;
  const path = typeof s?.path === 'string' ? s.path : '';
  if (path.startsWith('lx://')) {
    return path.slice('lx://'.length).split('/')[0] || 'local';
  }
  if (path.startsWith('plugin://')) {
    return path.slice('plugin://'.length).split('/')[0] || 'local';
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

/** 取歌曲稳定标识（统一契约：本地主键优先，否则回退来源 path）。 */
function getSongId(song: Song): string {
  return song?.id != null ? String(song.id) : song?.path || '';
}

/** 构造 create_share 请求体 */
function buildShareBody(
  song: Song,
  coverUrl?: string,
  extra?: Partial<{ expireMinutes: number; source: string }>,
): Record<string, unknown> {
  // 分享链接有效时长：钳制到服务端允许的 5 分钟 ~ 24 小时，缺省 2 小时。
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

/** 判断是否为可被外部访问的远程封面（排除 Tauri 本地 asset 协议与回环地址） */
function isRemoteCoverUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host !== 'asset.localhost' && host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
}

/** 把 Tauri convertFileSrc 产物（http://asset.localhost/<encoded path>）还原为本地文件路径 */
function assetUrlToPath(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== 'asset.localhost') return '';
    return decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

/** 把封面候选值归一化为本地文件路径：远程 URL 返回空，asset.localhost 还原路径，其余视为本地路径 */
function toLocalCoverPath(candidate: string): string {
  if (!candidate) return '';
  if (isRemoteCoverUrl(candidate)) return '';
  return assetUrlToPath(candidate) || candidate;
}

/**
 * 解析分享封面 URL：在线封面（http(s)）直接用；
 * 本地封面读取本地文件上传到服务端，返回可被落地页访问的 HTTPS URL。
 * 失败静默返回空串（分享链接仍可生成，仅无封面）。
 */
async function resolveShareCover(song: Song, coverUrl?: string): Promise<string> {
  const s = song as any;
  const log = (...args: unknown[]) => console.warn('[shareCover]', ...args);
  // 在线封面：http(s) 远程封面直通，无需本地上传
  if (coverUrl && isRemoteCoverUrl(coverUrl)) return coverUrl;
  try {
    // 封面已是 data: URL（代理产物）时直接上传，无需本地文件路径
    if (coverUrl && /^data:image\//i.test(coverUrl)) {
      return (await uploadCoverDataUrl(coverUrl)) || '';
    }
    const isOnline =
      s?.source_type === 'remote' ||
      s?.source_type === 'plugin' ||
      s?.sourceType === 'remote' ||
      s?.sourceType === 'plugin';
    // 与播放页/列表取封面同源：优先全尺寸封面保证清晰度，缩略图仅作兜底
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
    // 兜底：coverUrl 还原路径 → DB 持久化缩略图路径
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

/** 是否已有该歌曲的分享链接（缓存命中） */
export function getCachedShareUrl(song: Song | null | undefined): string | null {
  if (!song) return null;
  return shareCache.get(shareCacheKey(song))?.url ?? null;
}

/** 获取（必要时创建）分享链接；已缓存直接返回，否则请求服务端并缓存 */
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
    // 仅缓存带封面的链接：无封面时清除缓存，下次分享会重试封面解析/上传
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

/** 预加载当前歌曲分享链接（fire-and-forget，失败静默，勿阻塞播放） */
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