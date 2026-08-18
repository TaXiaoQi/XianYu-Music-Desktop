import type { PluginSearchResult, PluginSource, QualityKey } from '../types';
import { qualityKeyToBakaPluginQuality } from '../types';
import { extractNeteasePicId, neteasePicIdToUrl, normalizeKuwoCoverUrl } from '../utils/coverUrl';

export const stripHtmlTags = (str: unknown): string => {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '');
};

export const extractCoverUrl = (item: any): string => {
  if (!item || typeof item !== 'object') return '';
  const raw = item.rawData || item.raw || item;
  let url =
    item.artwork || item.cover || item.coverImg || item.coverUrl || item.cover_url || item.pic || item.picurl || item.img || item.imgurl || item.imgUrl || item.albumPic || item.picture ||
    raw.artwork || raw.cover || raw.coverImg || raw.coverUrl || raw.cover_url || raw.pic || raw.picurl || raw.img || raw.imgurl || raw.imgUrl || raw.albumPic || raw.picture || '';

  // 过滤非字符串真值：网易云搜索的 al.pic 是超大整数，JSON 解析后丢精度，
  // 不能当 URL 用；清空后走下方 picId 加密拼 CDN 兜底
  if (url && typeof url !== 'string') url = '';

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
  // 酷我第三方(mf/baka)插件会直接返回证书异常的 CDN 域名（如 imgN.sycdn.kuwo.cn），
  // 统一归一化到证书有效的 img3.kuwo.cn，保证所有渲染路径可直连显示。
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

/** 从艺术家条目中提取头像 URL，兼容各平台常见字段（含嵌套对象） */
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
  // 嵌套对象：avatar?.url / img?.url / cover?.picUrl 等
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

/** 从插件返回结果中提取歌曲列表，兼容 data/musicList/isEnd 等多种格式 */
export const extractResultList = (result: any): any[] => {
  if (!result) return [];
  if (Array.isArray(result)) return result;

  // 从对象节点中查找歌曲列表：尝试常见字段（含大小写变体），再深入一层嵌套
  const songFields = [
    'musicList', 'musiclist', 'songList', 'songlist', 'song_list',
    'songs', 'tracks', 'dataList', 'list', 'items', 'data', 'resData',
    // 歌单搜索场景的字段变体（如 bilibili 等 MF 插件）
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
