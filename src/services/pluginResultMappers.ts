import type { PluginSearchResult, PluginSource, QualityKey } from '../types';
import { extractNeteasePicId, neteasePicIdToUrl } from '../utils/coverUrl';

export const stripHtmlTags = (str: unknown): string => {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '');
};

export const extractCoverUrl = (item: any): string => {
  if (!item || typeof item !== 'object') return '';
  const raw = item.rawData || item.raw || item;
  let url =
    item.artwork || item.cover || item.coverUrl || item.cover_url || item.pic || item.img || item.albumPic || item.picture ||
    raw.artwork || raw.cover || raw.coverUrl || raw.cover_url || raw.pic || raw.img || raw.albumPic || raw.picture || '';

  if (!url && (item.al?.picUrl || raw.al?.picUrl)) url = item.al?.picUrl || raw.al?.picUrl;
  if (!url && (item.album?.picUrl || raw.album?.picUrl)) url = item.album?.picUrl || raw.album?.picUrl;
  if (!url && (item.album?.blurPicUrl || raw.album?.blurPicUrl)) url = item.album?.blurPicUrl || raw.album?.blurPicUrl;
  if (!url && (item.coverImgUrl || raw.coverImgUrl)) url = item.coverImgUrl || raw.coverImgUrl;
  if (!url && (item.picUrl || raw.picUrl)) url = item.picUrl || raw.picUrl;

  // 网易云 weapi/search 常只给 picId 不给 picUrl；直接加密拼 CDN，避免再打 getMusicInfo
  if (!url) {
    const picId = extractNeteasePicId(item) ?? extractNeteasePicId(raw);
    if (picId !== null) url = neteasePicIdToUrl(picId);
  }
  if (url && typeof url === 'string' && url.startsWith('http://')) {
    url = url.replace('http://', 'https://');
  }
  return typeof url === 'string' ? url : '';
};

export const resetMediaItem = (mediaItem: any, pluginName: string): any => {
  if (!mediaItem) return mediaItem;
  return {
    ...mediaItem,
    platform: pluginName,
  };
};

export const qualityKeyToPluginString = (quality: QualityKey): string => (
  quality === 'mgg' ? '96k' : quality
);

export const toPluginSearchResult = (item: any, source: PluginSource): PluginSearchResult => {
  const id = item.id || item.songId || item.musicId || '';
  const title = stripHtmlTags(item.title || item.name || item.songname || '');
  const artist = extractArtist(item);
  const album = extractAlbum(item);
  const coverUrl = extractCoverUrl(item);
  const duration = parseDuration(item.duration || item.interval || item.dt);

  return {
    id,
    title,
    artist,
    album,
    coverUrl,
    duration,
    platform: item.platform || source.name,
    platformId: id,
    pluginId: source.id,
    rawData: item,
  };
};

export const extractArtist = (item: any): string => {
  if (item.artist && typeof item.artist === 'string') return stripHtmlTags(item.artist);
  if (item.singer && typeof item.singer === 'string') return stripHtmlTags(item.singer);
  if (Array.isArray(item.artists)) {
    return stripHtmlTags(item.artists.map((a: any) => typeof a === 'string' ? a : (a?.name || '')).filter(Boolean).join('/'));
  }
  if (Array.isArray(item.ar)) {
    return stripHtmlTags(item.ar.map((a: any) => a?.name || '').filter(Boolean).join('/'));
  }
  return '';
};

export const extractAlbum = (item: any): string => {
  if (typeof item.album === 'string') return stripHtmlTags(item.album);
  if (item.album?.name) return stripHtmlTags(item.album.name);
  if (item.albumName) return stripHtmlTags(item.albumName);
  if (item.al?.name) return stripHtmlTags(item.al.name);
  return '';
};

export const parseDuration = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return val > 1000 ? val : val * 1000;
  if (typeof val === 'string') {
    const parts = val.split(':');
    if (parts.length >= 2) return (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
    const n = parseInt(val);
    return n > 1000 ? n : n * 1000;
  }
  return 0;
};
