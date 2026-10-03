import { hostWeapiEncrypt } from '../tauri/hostCryptoApi';
import { decodeName, formatSingerName } from '../../utils/musicFormat';
import type { PluginSearchResult } from '../../types';
import {
  createSearchResult,
  formatPlayTime,
  httpFetch,
  log,
  type WyTrackMetaPatch,
} from './playlistImportBase';

// 歌单导入内置实现已下沉 Rust（src-tauri music/playlist_fetcher/wy.rs），
// 本文件仅保留 TrackMeta 富字段补齐链路（fetchWyTrackMetaByIds）。

// ==================== 加密工具（Rust host_crypto 计算） ====================

function weapiEncrypt(object: Record<string, any>): Promise<{ params: string; encSecKey: string }> {
  return hostWeapiEncrypt(JSON.stringify(object));
}

// ==================== 歌曲详情（TrackMeta 共享） ====================

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
