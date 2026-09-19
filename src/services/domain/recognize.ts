
import { recognizeApi } from '../tauri/recognizeApi';
import type { RecognizeResponseContract } from '../tauri/contracts';
import type { LxSearchResultItem } from './lxMusicSdk';
import type { Song } from '../../types';

export interface RecognizeMatch {
  song: LxSearchResultItem;
  confidence: number;
  raw: RecognizeRawItem;
}

export interface RecognizeRawItem {
  songname?: string;
  filename?: string;
  name?: string;
  songNameSuffix?: string;
  singername?: string;
  author_name?: string;
  singer?: string;
  authors?: Array<{ author_id?: string | number; author_name?: string; singerid?: string | number; singername?: string }>;
  album?: Array<{ albumname?: string; album_id?: string | number; albumid?: string | number; sizable_cover?: string }>;
  album_name?: string;
  albumname?: string;
  album_id?: string | number;
  albumid?: string | number;
  album_audio_id?: string | number;
  mixsongid?: string | number;
  audio_id?: string | number;
  songid?: string | number;
  song_id?: string | number;
  hash?: string;
  hash_128?: string;
  FileHash?: string;
  hash_320?: string;
  hash_flac?: string;
  hash_high?: string;
  union_cover?: string;
  album_sizable_cover?: string;
  cover?: string;
  timelength?: number;
  timelength_128?: number;
  timelength_320?: number;
  duration?: number;
  dist?: number | string;
  [key: string]: unknown;
}

interface RecognizeResponseBody {
  status?: number;
  data?: RecognizeRawItem[] | null;
  err_code?: number;
  error_code?: number;
  msg?: string;
  [key: string]: unknown;
}

export const RECOGNIZE_MAX_SECONDS = 10;

export const RECOGNIZE_CANCELLED = '识别已取消';

export async function recognizeSystemAudio(): Promise<RecognizeMatch[]> {
  const response = await recognizeApi.recognizeSystemAudio();
  return parseRecognizeResponse(response);
}

export async function cancelRecognizeSystemAudio(): Promise<void> {
  await recognizeApi.cancelRecognizeSystemAudio();
}

function parseRecognizeResponse(response: RecognizeResponseContract): Promise<RecognizeMatch[]> {
  if (response.status !== 200) {
    return Promise.reject(new Error(`识别请求失败 (HTTP ${response.status})`));
  }

  let body: RecognizeResponseBody;
  try {
    body = JSON.parse(response.body);
  } catch {
    return Promise.reject(new Error('识别响应解析失败'));
  }

  if (body.status !== 1) {
    return Promise.resolve([]);
  }

  return Promise.resolve(mapRecognizeMatches(body.data));
}

function mapRecognizeMatches(list: RecognizeRawItem[] | null | undefined): RecognizeMatch[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const distRaw = parseFloat(String(item.dist ?? 0));
      const dist = Number.isFinite(distRaw) ? Math.min(Math.max(distRaw, 0), 1) : 1;
      return {
        song: mapRecognizeToLxSong(item),
        confidence: 1 - dist,
        raw: item,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

function pickString(...values: unknown[]): string {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v) !== '') {
      return String(v);
    }
  }
  return '';
}

function formatCoverUrl(...values: unknown[]): string {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v) !== '') {
      let url = String(v).trim();
      if (!url) continue;
      url = url.replace(/\{size\}/g, '400');
      if (url.startsWith('//')) {
        url = `https:${url}`;
      }
      url = url.replace('http://', 'https://');
      url = url.replace('c1.kgimg.com', 'imge.kugou.com');
      return url;
    }
  }
  return '';
}

function pickInt(...values: unknown[]): number {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') {
      const n = parseInt(String(v), 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function formatPlayTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function mapRecognizeToLxSong(item: RecognizeRawItem): LxSearchResultItem {
  const name = pickString(item.songname, item.filename, item.name, '未知歌曲');

  const singer = pickString(item.singername, item.author_name, item.singer, '未知歌手');

  const albumRecord = Array.isArray(item.album) && item.album.length > 0 ? item.album[0] : {};
  const albumName = pickString(
    (albumRecord as any).albumname,
    item.album_name,
    item.albumname,
    '',
  );
  const albumId = pickString(
    (albumRecord as any).albumid,
    (albumRecord as any).album_id,
    item.album_id,
    item.albumid,
    '',
  );

  const cover = formatCoverUrl(
    item.union_cover,
    (albumRecord as any).sizable_cover,
    item.album_sizable_cover,
    item.cover,
  );

  const hash = pickString(item.hash, item.hash_128, item.FileHash, item.hash_320, item.hash_flac, '');

  const songmid = pickString(
    String(item.album_audio_id ?? ''),
    String(item.mixsongid ?? ''),
    String(item.audio_id ?? ''),
    String(item.songid ?? ''),
    hash,
  );

  const timeLengthMs = pickInt(item.timelength, item.timelength_128, item.timelength_320, item.duration, 0);
  const durationSec = timeLengthMs > 1000 ? Math.floor(timeLengthMs / 1000) : timeLengthMs;

  const types: LxSearchResultItem['types'] = [];
  const _types: LxSearchResultItem['_types'] = {};
  if (hash) {
    types.push({ type: '128k', size: '', hash });
    _types['128k'] = { size: '', hash };
  }
  if (item.hash_320) {
    types.push({ type: '320k', size: '', hash: item.hash_320 });
    _types['320k'] = { size: '', hash: item.hash_320 };
  }
  if (item.hash_flac) {
    types.push({ type: 'flac', size: '', hash: item.hash_flac });
    _types.flac = { size: '', hash: item.hash_flac };
  }

  return {
    name,
    singer,
    albumName,
    albumId: albumId || songmid,
    songmid,
    source: 'kg',
    interval: formatPlayTime(durationSec),
    img: cover || null,
    hash,
    types,
    _types,
  };
}

export function buildRecognizeSong(match: RecognizeMatch): Song {
  const item = match.song;
  const artistNames = item.singer ? item.singer.split(/[、,&/]/).map(s => s.trim()).filter(Boolean) : ['未知歌手'];
  const song: Song = {
    name: item.name,
    title: item.name,
    path: `lx://kg/${item.hash || item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.albumName || '未知专辑',
    album_artist: item.singer || '未知歌手',
    album_key: `${item.albumName || '未知专辑'}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: 0,
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://kg/${item.hash || item.songmid}`,
  } as Song;
  (song as any)._hash = item.hash;
  (song as any)._types = item._types;
  (song as any)._songmid = item.songmid;
  (song as any)._source = item.source;
  return song;
}
