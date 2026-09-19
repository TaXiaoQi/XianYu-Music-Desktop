import type { PluginPlaylistSearchResult, PluginSearchResult, PluginSource, QualityKey } from '../../types';
import { qualityKeyToBakaPluginQuality } from '../../types';
import { extractNeteasePicId, neteasePicIdToUrl, normalizeKuwoCoverUrl } from '../../utils/coverUrl';
import { dispatchFallbackModuleSync } from '../fallbackModules/registry';

export const stripHtmlTags = (str: unknown): string => {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '');
};

const extractCoverFromNode = (node: any): string => {
  if (!node || typeof node !== 'object') return '';
  const raw = node.rawData || node.raw || node;
  let url =
    node.artwork || node.cover || node.coverImg || node.coverUrl || node.cover_url || node.pic || node.picurl || node.img || node.imgurl || node.imgUrl || node.albumPic || node.picture ||
    raw.artwork || raw.cover || raw.coverImg || raw.coverUrl || raw.cover_url || raw.pic || raw.picurl || raw.img || raw.imgurl || raw.imgUrl || raw.albumPic || raw.picture || '';

  if (url && typeof url !== 'string') url = '';

  if (!url && (node.al?.picUrl || raw.al?.picUrl)) url = node.al?.picUrl || raw.al?.picUrl;
  if (!url && (node.album?.picUrl || raw.album?.picUrl)) url = node.album?.picUrl || raw.album?.picUrl;
  if (!url && (node.album?.blurPicUrl || raw.album?.blurPicUrl)) url = node.album?.blurPicUrl || raw.album?.blurPicUrl;
  if (!url && (node.coverImgUrl || raw.coverImgUrl)) url = node.coverImgUrl || raw.coverImgUrl;
  if (!url && (node.picUrl || raw.picUrl)) url = node.picUrl || raw.picUrl;

  if (!url) {
    const picId = extractNeteasePicId(node) ?? extractNeteasePicId(raw);
    if (picId !== null) url = neteasePicIdToUrl(picId);
  }
  return typeof url === 'string' ? url : '';
};

const NESTED_ITEM_KEYS = ['song', 'data', 'music', 'musicInfo', 'detail'];

export const extractCoverUrl = (item: any): string => {
  return dispatchFallbackModuleSync('lx_cover', 'extractCoverUrl', { item },
    () => extractCoverUrlBuiltin(item));
};

const extractCoverUrlBuiltin = (item: any): string => {
  if (!item || typeof item !== 'object') return '';
  let url = extractCoverFromNode(item);
  for (const k of NESTED_ITEM_KEYS) {
    if (!url && item[k] && typeof item[k] === 'object') {
      url = extractCoverFromNode(item[k]);
    }
  }
  if (!url && item.rawData && typeof item.rawData === 'object') {
    for (const k of NESTED_ITEM_KEYS) {
      if (item.rawData[k] && typeof item.rawData[k] === 'object') {
        url = extractCoverFromNode(item.rawData[k]);
        if (url) break;
      }
    }
  }
  if (url && typeof url === 'string' && url.startsWith('http://')) {
    url = url.replace('http://', 'https://');
  }
  if (url && typeof url === 'string' && /kuwo\.cn/i.test(url)) {
    url = normalizeKuwoCoverUrl(url) || url;
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
  qualityKeyToBakaPluginQuality(quality)
);

export const toPluginSearchResult = (item: any, source: PluginSource): PluginSearchResult => {
  const id = item.id || item.songId || item.musicId || '';
  const title = stripHtmlTags(item.title || item.name || item.songname || '');
  const artist = extractArtist(item);
  const album = extractAlbum(item);
  const coverUrl = extractCoverUrl(item);
  const duration = extractDurationMs(item);

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
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return 0;
    return val >= 60000 ? Math.floor(val) : Math.floor(val * 1000);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':').map((p) => parseInt(p, 10));
      if (parts.every((n) => !isNaN(n))) {
        if (parts.length === 2) {
          return (parts[0] * 60 + parts[1]) * 1000;
        }
        if (parts.length === 3) {
          return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        }
      }
    }
    const n = parseFloat(trimmed);
    if (!isNaN(n) && n > 0) {
      return n >= 60000 ? Math.floor(n) : Math.floor(n * 1000);
    }
  }
  return 0;
};

export const extractDurationMs = (item: any): number => {
  if (!item || typeof item !== 'object') return 0;
  const targets = [item, item.rawData, item.raw, item.song, item.music, item.data, item.detail].filter(Boolean);

  for (const t of targets) {
    const candidates = [
      t.duration,
      t.durationMs,
      t.interval,
      t.dt,
      t.time,
      t.length,
      t.dur,
      t.len,
      t.timelength,
      t.songTime,
      t.durationSeconds,
      t.intervalSeconds,
      t.al?.dt,
      t.album?.dt,
      t.album?.duration,
      t.song?.duration,
      t.music?.duration,
      t.data?.duration,
      t.detail?.duration,
    ];

    for (const candidate of candidates) {
      const durationMs = parseDuration(candidate);
      if (durationMs > 0) {
        return durationMs;
      }
    }
  }

  return 0;
};

export const extractDuration = extractDurationMs;

export const extractArtistAvatarUrl = (item: any): string => {
  if (!item || typeof item !== 'object') return '';
  const candidates = [
    'avatarUrl', 'avatar', 'avatar_url', 'picUrl', 'pic_url', 'pic',
    'img1v1Url', 'img1v1', 'headUrl', 'head_url', 'face', 'artistPic',
    'artist_pic', 'coverUrl', 'cover', 'img',
  ];
  for (const key of candidates) {
    const v = item[key];
    if (typeof v === 'string' && v) return v;
  }
  for (const key of candidates) {
    const inner = item[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const url =
        (typeof inner.url === 'string' && inner.url)
        || (typeof inner.picUrl === 'string' && inner.picUrl)
        || (typeof inner.coverUrl === 'string' && inner.coverUrl);
      if (url) return url;
    }
  }
  return extractCoverUrl(item);
};

export const extractIsEnd = (result: any): boolean | undefined => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  if (typeof result.isEnd === 'boolean') return result.isEnd;
  if (typeof result.is_end === 'boolean') return result.is_end;
  for (const key of Object.keys(result)) {
    const v = result[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.isEnd === 'boolean') return v.isEnd;
      if (typeof v.is_end === 'boolean') return v.is_end;
    }
  }
  return undefined;
};

export const extractResultList = (result: any): any[] => {
  if (!result) return [];
  if (Array.isArray(result)) return result;

  const songFields = [
    'musicList', 'musiclist', 'songList', 'songlist', 'song_list',
    'songs', 'tracks', 'dataList', 'list', 'items', 'data', 'resData',
    'sheetList', 'sheetlist', 'playlists', 'playlist',
  ];
  for (const field of songFields) {
    const val = result[field];
    if (Array.isArray(val) && val.length > 0) return val;
  }
  for (const field of songFields) {
    if (
      result[field]
      && typeof result[field] === 'object'
      && !Array.isArray(result[field])
    ) {
      const inner = extractResultList(result[field]);
      if (inner.length > 0) return inner;
    }
  }
  return [];
};

export const flattenTopListCategories = (
  topLists: any,
  source: PluginSource,
): PluginPlaylistSearchResult[] => {
  if (!Array.isArray(topLists)) return [];

  const results: PluginPlaylistSearchResult[] = [];
  for (const category of topLists) {
    if (category?.data && Array.isArray(category.data)) {
      for (const item of category.data) {
        results.push({
          id: String(item.id || ''),
          title: stripHtmlTags(item.title || item.name || ''),
          coverUrl: item.coverImg || item.cover || extractCoverUrl(item),
          playCount: item.playCount ?? item.playcount,
          trackCount: item.trackCount ?? item.trackcount,
          artist: stripHtmlTags(category.title || ''),
          platform: source.name,
          platformId: String(item.id || ''),
          pluginId: source.id,
          rawData: { ...item, _isTopList: true },
        });
      }
    } else if (category && typeof category === 'object') {
      results.push({
        id: String(category.id || ''),
        title: stripHtmlTags(category.title || category.name || ''),
        coverUrl: category.coverImg || category.cover || extractCoverUrl(category),
        playCount: category.playCount ?? category.playcount,
        trackCount: category.trackCount ?? category.trackcount,
        artist: stripHtmlTags(category.artist || category.author || ''),
        platform: source.name,
        platformId: String(category.id || ''),
        pluginId: source.id,
        rawData: { ...category, _isTopList: true },
      });
    }
  }
  return results;
};
