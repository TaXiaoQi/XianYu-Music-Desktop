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


// ==================== 加密工具（Rust host_crypto 计算） ====================

function linuxapiEncrypt(obj: object): Promise<string> {
  return hostLinuxapiEncrypt(JSON.stringify(obj));
}

function weapiEncrypt(object: Record<string, any>): Promise<{ params: string; encSecKey: string }> {
  return hostWeapiEncrypt(JSON.stringify(object));
}

// ==================== 歌单详情 ====================

async function getListDetailWy(rawId: string): Promise<PlaylistImportResult> {
  const id = getWyListId(rawId);
  if (!id) return { source: 'wy', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

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

  for (const track of tracks) {
    const parsed = parseWyTrack(track);
    if (parsed) {
      songs.push(parsed);
      fetchedIds.add(parsed.id);
    }
  }

  const remainingIds: string[] = [];
  for (const tid of trackIds) {
    const songId = String(tid.id ?? '');
    if (songId && !fetchedIds.has(songId)) {
      remainingIds.push(songId);
    }
  }

  log(`getListDetailWy: already fetched=${fetchedIds.size}, remaining=${remainingIds.length}`);

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

export async function fetchWyTrackMetaByIds(
  ids: string[],
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  const validIds = ids.filter(id => /^\d+$/.test(id));
  if (validIds.length === 0) return patches;

  try {
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