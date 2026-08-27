import { hostLinuxapiEncrypt, hostWeapiEncrypt } from '../tauri/hostCryptoApi';
import { decodeName, formatSingerName } from '../../utils/musicFormat';
import type { PluginSearchResult } from '../../types';
import {
  createSearchResult,
  formatPlayTime,
  getWyListId,
  httpFetch,
  log,
  type PlaylistImportResult,
  type PlaylistInfo,
  type WyTrackMetaPatch,
} from './playlistImportBase';

/**
 * 网易云（小芸）歌单详情与曲目元数据导入。
 * 仅依赖 playlistImportBase，作为叶子模块被 playlistImport 门面消费。
 */

// ==================== 加密工具（Rust host_crypto 计算） ====================

/**
 * 网易云 linuxapi 加密（与 LxSdkSongList.linuxapiEncrypt 一致）
 * AES-ECB-128 (PKCS7Padding) + hex 大写
 */
function linuxapiEncrypt(obj: object): Promise<string> {
  return hostLinuxapiEncrypt(JSON.stringify(obj));
}

/**
 * weapi 加密（Rust host_crypto 计算，与 lx-music-desktop 一致）
 * AES-CBC 双重加密 + RSA 加密随机密钥
 */
function weapiEncrypt(object: Record<string, any>): Promise<{ params: string; encSecKey: string }> {
  return hostWeapiEncrypt(JSON.stringify(object));
}

// ==================== 歌单详情 ====================

async function getListDetailWy(rawId: string): Promise<PlaylistImportResult> {
  const id = getWyListId(rawId);
  if (!id) return { source: 'wy', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  // linuxapi 加密 POST /api/linux/forward
  const params = {
    method: 'POST',
    url: 'https://music.163.com/api/v3/playlist/detail',
    params: { id, n: 100000, s: 8 },
  };
  const eparams = await linuxapiEncrypt(params);

  const resp = await httpFetch(
    'https://music.163.com/api/linux/forward',
    'POST',
    {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      'Cookie': 'MUSIC_U=',
    },
    undefined,
    { eparams },
  );

  const body = resp.body;
  if (typeof body !== 'object' || body === null || body.code !== 200) {
    throw new Error(`网易云歌单获取失败: code=${body?.code ?? 'unknown'}`);
  }

  const playlist = body.playlist;
  if (!playlist) return { source: 'wy', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const trackIds = playlist.trackIds || [];
  const tracks = playlist.tracks || [];
  const total = trackIds.length;

  log(`getListDetailWy: trackIds=${total}, tracks=${tracks.length}`);

  const songs: PluginSearchResult[] = [];
  const fetchedIds = new Set<string>();

  // 1. 解析已有的 tracks
  for (const track of tracks) {
    const parsed = parseWyTrack(track);
    if (parsed) {
      songs.push(parsed);
      fetchedIds.add(parsed.id);
    }
  }

  // 2. 收集尚未获取详情的 trackIds
  const remainingIds: string[] = [];
  for (const tid of trackIds) {
    const songId = String(tid.id ?? '');
    if (songId && !fetchedIds.has(songId)) {
      remainingIds.push(songId);
    }
  }

  log(`getListDetailWy: already fetched=${fetchedIds.size}, remaining=${remainingIds.length}`);

  // 3. 分批获取剩余歌曲详情（每批最多 1000 首）
  if (remainingIds.length > 0) {
    const batchSize = 1000;
    let processed = 0;
    while (processed < remainingIds.length) {
      const end = Math.min(processed + batchSize, remainingIds.length);
      const batch = remainingIds.slice(processed, end);
      const batchResult = await fetchWyMusicDetailList(batch);
      songs.push(...batchResult);
      processed = end;
    }
  }

  const info: PlaylistInfo = {
    name: decodeName(playlist.name || ''),
    img: playlist.coverImgUrl || '',
    desc: decodeName(playlist.description || ''),
    author: decodeName(playlist.creator?.nickname || ''),
    playCount: String(playlist.playCount || 0),
  };

  return { source: 'wy', songs, total, info };
}

/**
 * 网易云批量获取歌曲详情（完全对齐 YinDongMusic 的实现）
 * 使用 weapi POST 到 /weapi/v3/song/detail，避免 GET URL 过长导致 400 错误
 * 每批最多 1000 首，失败自动重试 2 次
 */
async function fetchWyMusicDetailList(ids: string[]): Promise<PluginSearchResult[]> {
  if (ids.length === 0) return [];

  const MAX_RETRY = 2;
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const encrypted = await weapiEncrypt({
        c: '[' + ids.map(id => `{"id":${id}}`).join(',') + ']',
        ids: '[' + ids.join(',') + ']',
      });

      const resp = await httpFetch(
        'https://music.163.com/weapi/v3/song/detail',
        'POST',
        {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
          'Origin': 'https://music.163.com',
          'Referer': 'https://music.163.com/',
        },
        `params=${encodeURIComponent(encrypted.params)}&encSecKey=${encodeURIComponent(encrypted.encSecKey)}`,
      );

      const body = resp.body;
      if (typeof body === 'object' && body !== null && body.code === 200) {
        const songs = body.songs || [];
        const list: PluginSearchResult[] = [];
        for (const track of songs) {
          const parsed = parseWyTrack(track);
          if (parsed) list.push(parsed);
        }
        log(`fetchWyMusicDetailList: requested=${ids.length}, parsed=${list.length}, attempt=${attempt + 1}`);
        return list;
      }

      log(`fetchWyMusicDetailList: attempt=${attempt + 1} code=${body?.code}, body=${typeof body === 'string' ? body.substring(0, 200) : JSON.stringify(body).substring(0, 200)}`);
      lastError = new Error(`code=${body?.code ?? 'unknown'}`);
    } catch (e: any) {
      log(`fetchWyMusicDetailList: attempt=${attempt + 1} exception: ${e?.message}`);
      lastError = e;
    }

    if (attempt < MAX_RETRY) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  throw new Error(`网易云歌曲详情获取失败: ${lastError?.message || 'unknown'}`);
}

/**
 * 按网易云歌曲 ID 批量补全封面与时长。
 *
 * 部分第三方 MusicFree 网易云插件（如时迁酱 v7）在 search 结果里既不返回可用的
 * artwork（album.picUrl 在 weapi/search 响应中不存在），也完全不返回 duration/dt
 * 字段。这里直接用官方 weapi 的 song/detail 批量补全，绕过插件实现差异。
 *
 * @param ids 网易云歌曲 ID 列表（纯数字 ID）
 * @returns songId -> { coverUrl, durationMs } 映射；失败时返回空 Map
 */
export async function fetchWyTrackMetaByIds(
  ids: string[],
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  const validIds = ids.filter(id => /^\d+$/.test(id));
  if (validIds.length === 0) return patches;

  try {
    // 每批最多 1000 首，与 fetchWyMusicDetailList 的上游限制一致
    const BATCH_SIZE = 1000;
    for (let offset = 0; offset < validIds.length; offset += BATCH_SIZE) {
      const batch = validIds.slice(offset, offset + BATCH_SIZE);
      const details = await fetchWyMusicDetailList(batch);
      for (const detail of details) {
        patches.set(String(detail.id), {
          coverUrl: detail.coverUrl || '',
          durationMs: detail.duration || 0,
        });
      }
    }
  } catch (e: any) {
    log(`fetchWyTrackMetaByIds failed: ${e?.message || e}`);
  }

  return patches;
}

function parseWyTrack(track: any): PluginSearchResult | null {
  const id = String(track.id ?? '');
  if (!id || id === '0') return null;

  const name = decodeName(track.name || '');
  // 兼容 v3 端点（ar/al/dt）和 v1 端点（artists/album/duration）
  const ar = track.ar || track.artists || [];
  const al = track.al || track.album || {};
  const duration = track.dt || track.duration || 0;
  const img = al.picUrl || track.album?.picUrl || '';
  const singerName = formatSingerName(ar);

  const rawData = {
    songmid: id,
    name,
    singer: singerName,
    source: 'wy',
    interval: formatPlayTime(Math.floor(duration / 1000)),
  };

  return createSearchResult({
    id,
    title: name,
    artist: singerName,
    album: decodeName(al.name || ''),
    coverUrl: img,
    duration,
    platform: '网易云',
    sourceKey: 'wy',
    rawData,
  });
}

export { getListDetailWy };