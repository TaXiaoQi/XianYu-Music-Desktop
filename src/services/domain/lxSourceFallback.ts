
import type { Song } from '../../types';
import { LX_SOURCE_NAMES, type LxSourceId } from './lxMusicSdk';
import { cacheLxSong } from './lxSongCache';
import { cacheLxSongInfo } from './lxLyricFetcher';
import { parseIntervalToSeconds } from '../../utils/remoteSong';
import { pluginApi } from '../tauri/pluginApi';
import type { AlternativeSourceResultContract } from '../tauri/contracts';

function buildSongFromRustResult(result: AlternativeSourceResultContract): Song {
  const songDuration = parseIntervalToSeconds(result.interval);
  const artistNames = result.singer
    ? result.singer.split('、').filter(Boolean)
    : ['未知歌手'];

  const song: Song = {
    name: result.name,
    title: result.name,
    path: `lx://${result.source}/${result.songmid}`,
    artist: result.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: result.albumName || '未知专辑',
    album_artist: result.singer || '未知歌手',
    album_key: `${result.albumName || '未知专辑'}-${result.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: songDuration,
    cover_thumb_path: result.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${result.source}/${result.songmid}`,
  } as any;

  (song as any)._hash = result.hash;
  (song as any)._types = result.lxTypes;
  (song as any)._copyrightId = result.copyrightId;
  (song as any)._songmid = result.songmid;
  (song as any)._source = result.source;

  return song;
}

function cacheLxItemFromRustResult(result: AlternativeSourceResultContract): void {
  const songDuration = parseIntervalToSeconds(result.interval);
  cacheLxSong({
    name: result.name,
    singer: result.singer,
    albumName: result.albumName,
    albumId: result.albumId,
    songmid: result.songmid,
    source: result.source as LxSourceId,
    interval: result.interval,
    img: result.img ?? null,
    types: [],
    _types: Object.fromEntries(
      Object.entries(result.lxTypes || {}).map(([k, v]) => [
        k,
        { size: v.size ?? null, hash: v.hash },
      ]),
    ),
    hash: result.hash || undefined,
    strMediaMid: result.strMediaMid || undefined,
    songId: typeof result.songId === 'number' ? result.songId : undefined,
    albumMid: result.albumMid || undefined,
    copyrightId: result.copyrightId || undefined,
  });
  cacheLxSongInfo(result.source as LxSourceId, result.songmid, {
    songmid: result.songmid,
    hash: result.hash || undefined,
    name: result.name,
    singer: result.singer,
    albumName: result.albumName,
    interval: result.interval,
    _interval: songDuration > 0 ? Math.round(songDuration) : undefined,
    songId: typeof result.songId === 'number' ? result.songId : undefined,
    strMediaMid: result.strMediaMid || undefined,
    albumMid: result.albumMid || undefined,
    albumId: result.albumId,
    copyrightId: result.copyrightId || undefined,
    source: result.source,
  });
}

export async function findAlternativeLxSource(
  song: Song,
  failedSources: Set<string>,
): Promise<Song | null> {
  const artistStr = song.effective_artist_names?.length
    ? song.effective_artist_names.join('、')
    : song.artist || '';

  try {
    const result = await pluginApi.findAlternativeLxSource(
      song.name,
      artistStr,
      song.duration || 0,
      Array.from(failedSources),
    );

    if (!result) return null;

    cacheLxItemFromRustResult(result);

    return buildSongFromRustResult(result);
  } catch (e: any) {
    console.warn(`[lxSourceFallback] Rust 换源失败: ${e?.message || e}`);
    return null;
  }
}

export function getLxSourceDisplayName(source: string): string {
  return LX_SOURCE_NAMES[source as LxSourceId] ?? '在线';
}
