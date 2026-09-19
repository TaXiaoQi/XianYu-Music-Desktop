
import type { Song } from '../../types';
import { getStoredAuth } from '../auth/authService';
import { isPluginSong } from '../../utils/pluginSong';
import { isRemoteSong } from '../../utils/remoteSong';
import { md5 } from '../auth/md5';
import type { SyncSongPayload, SyncSongType, PlaylistType } from './playlistSyncTypes';

export function getCiyuanxiId(): string | null {
  const auth = getStoredAuth();
  return auth?.user?.ciyuanxi_id ?? null;
}

export function isOnlineSong(song: Song): boolean {
  return (
    isRemoteSong(song)
    || isPluginSong(song)
    || song.path?.startsWith('lx://') === true
    || song.path?.startsWith('plugin://') === true
    || song.path?.startsWith('http://') === true
    || song.path?.startsWith('https://') === true
  );
}

export function classifySyncSong(song: Song): SyncSongType {
  if (song.source_type === 'local') return 'local';
  if (song.source_type === 'remote' || song.source_type === 'plugin') return 'online';
  return isOnlineSong(song) ? 'online' : 'local';
}

export function classifySyncPlaylist(songs: Song[]): PlaylistType {
  if (songs.length === 0) return 'local';
  const types = new Set(songs.map(classifySyncSong));
  if (types.size === 1) {
    return types.has('local') ? 'local' : 'online';
  }
  return 'mixed';
}

function generateSongHash(song: Song): string {
  if (isOnlineSong(song) && song.path) {
    return md5(song.path);
  }
  const name = song.title || song.name || '';
  const artist = song.artist || '';
  return md5(`${name}|${artist}|local`);
}

function buildOnlineSyncExtra(song: Song): {
  musicInfo?: Record<string, unknown>;
  coverUrl?: string;
  source?: string;
} {
  const path = song.path || '';
  if (!path.startsWith('lx://')) return {};
  const parts = path.replace('lx://', '').split('/');
  const source = parts[0];
  const songmid = parts.slice(1).join('/');
  if (!source || !songmid) return {};

  const anySong = song as any;
  const rawData = (anySong.rawData as any) || undefined;

  const coverThumb =
    typeof song.cover_thumb_path === 'string' ? song.cover_thumb_path : '';
  const img = (anySong.img as string) || (rawData && (rawData.img as string)) || '';
  const coverUrl =
    /^https?:/.test(coverThumb) ? coverThumb
    : /^https?:/.test(img) ? img
    : '';

  const rawTypes = anySong._types ?? rawData?._types;
  const hash = anySong._hash ?? anySong.hash ?? rawData?.hash ?? (source === 'kg' ? songmid : undefined);

  const musicInfo: Record<string, unknown> = {
    songId: songmid,
    name: song.name || song.title || songmid,
    singer: song.artist || '',
    albumName: song.album || '',
    source,
    songmid,
    ...(hash != null ? { hash } : {}),
    copyrightId: anySong._copyrightId ?? anySong.copyrightId ?? rawData?.copyrightId,
    strMediaMid: anySong._strMediaMid ?? anySong.strMediaMid ?? rawData?.strMediaMid,
    albumId: anySong._albumId ?? anySong.albumId ?? rawData?.albumId,
    albumMid: anySong._albumMid ?? anySong.albumMid ?? rawData?.albumMid,
    interval: anySong.interval ?? rawData?.interval ?? '',
    img: coverUrl,
    ...(rawTypes ? { _types: rawTypes } : {}),
    types: rawData?.types,
  };

  return {
    musicInfo,
    ...(coverUrl ? { coverUrl } : {}),
    source,
  };
}

export function songToSyncPayload(song: Song): SyncSongPayload {
  const payload: any = {
    ...JSON.parse(JSON.stringify(song)),
    syncType: classifySyncSong(song),
    song_hash: generateSongHash(song),
  };
  if (classifySyncSong(song) === 'online') {
    const extra = buildOnlineSyncExtra(song);
    if (extra.musicInfo) payload.musicInfo = extra.musicInfo;
    if (extra.coverUrl) payload.coverUrl = extra.coverUrl;
    if (extra.source) payload.source = extra.source;
  }
  return payload as SyncSongPayload;
}

const MOBILE_PLATFORM_TO_LX_SOURCE: Record<string, string> = {
  '网易云音乐': 'wy',
  '网易音乐': 'wy',
  'QQ音乐': 'tx',
  'qq音乐': 'tx',
  '酷我音乐': 'kw',
  '酷狗音乐': 'kg',
  '咪咕音乐': 'mg',
  '哔哩哔哩': 'bilibili',
  'bilibili': 'bilibili',
};

function tryConvertMobilePluginPathToLx(
  path: string,
  payload: any,
): { path: string; lxSource: string | null; songmid: string | null } {
  if (!path.startsWith('plugin://')) return { path, lxSource: null, songmid: null };
  try {
    const withoutScheme = path.slice('plugin://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx < 0) return { path, lxSource: null, songmid: null };
    const rawPlatform = withoutScheme.slice(0, slashIdx);
    const rawSongId = withoutScheme.slice(slashIdx + 1);
    const platform = decodeURIComponent(rawPlatform);
    const songId = decodeURIComponent(rawSongId);
    const lxSource = MOBILE_PLATFORM_TO_LX_SOURCE[platform] ?? null;
    if (!lxSource || !songId) return { path, lxSource: null, songmid: null };
    const musicInfo = payload.musicInfo as Record<string, any> | undefined;
    const songmid = musicInfo?.songmid || musicInfo?.mid || songId;
    const lxPath = `lx://${lxSource}/${encodeURIComponent(songmid)}`;
    return { path: lxPath, lxSource, songmid };
  } catch {
    return { path, lxSource: null, songmid: null };
  }
}

export function syncPayloadToSong(song: SyncSongPayload): Song {
  const payload = song as SyncSongPayload;
  const title = payload.title || payload.name || '';
  const artist = payload.artist || '未知歌手';
  const album = payload.album || '未知专辑';
  const artistNames = payload.artist_names?.length
    ? payload.artist_names
    : artist.split(/[、,/&]|\sft\.?\s/i).map(s => s.trim()).filter(Boolean);

  const rawDuration = payload.duration || 0;
  const duration = rawDuration > 10000 ? Math.round(rawDuration / 1000) : rawDuration;

  const coverThumbPath = (payload.cover_thumb_path || (payload as any).coverUrl || '') as string;

  const { path: resolvedPath, lxSource, songmid } = tryConvertMobilePluginPathToLx(
    payload.path,
    payload,
  );

  const lxExtra: Record<string, unknown> = {};
  if (lxSource && songmid) {
    const musicInfo = (payload as any).musicInfo as Record<string, any> | undefined;
    if (musicInfo) {
      if (musicInfo._types) lxExtra._types = musicInfo._types;
      if (musicInfo.hash || musicInfo['320hash']) lxExtra._hash = musicInfo.hash || musicInfo['320hash'];
      if (musicInfo.strMediaMid) lxExtra._strMediaMid = musicInfo.strMediaMid;
      if (musicInfo.albumMid || musicInfo.albummid) lxExtra._albumMid = musicInfo.albumMid || musicInfo.albummid;
      if (musicInfo.albumId || musicInfo.album_id) lxExtra._albumId = musicInfo.albumId || musicInfo.album_id;
      if (musicInfo.copyrightId) lxExtra._copyrightId = musicInfo.copyrightId;
      if (musicInfo.songId || musicInfo.songid) lxExtra._songId = musicInfo.songId || musicInfo.songid;
      lxExtra.rawData = { ...musicInfo, source: lxSource, songmid };
    }
  }

  return {
    ...payload,
    ...lxExtra,
    name: payload.name || title,
    title,
    path: resolvedPath,
    artist,
    artist_names: artistNames.length > 0 ? artistNames : [artist],
    effective_artist_names: payload.effective_artist_names?.length
      ? payload.effective_artist_names
      : (artistNames.length > 0 ? artistNames : [artist]),
    album,
    album_artist: payload.album_artist || artist,
    album_key: payload.album_key || `${album}-${artist}`,
    is_various_artists_album: payload.is_various_artists_album ?? false,
    collapse_artist_credits: payload.collapse_artist_credits ?? false,
    duration,
    cover_thumb_path: coverThumbPath,
    source_type: payload.source_type ?? (payload.syncType === 'online' ? 'remote' : 'local'),
  };
}

export function firstRemoteSongCover(songs: Array<{ cover_thumb_path?: string; coverUrl?: string }> | undefined): string {
  for (const s of songs ?? []) {
    const c = s?.cover_thumb_path || s?.coverUrl || '';
    if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c;
  }
  return '';
}