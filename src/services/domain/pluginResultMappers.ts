import type { PluginPlaylistSearchResult, PluginSearchResult, PluginSource, QualityKey } from '../../types';
import { qualityKeyToBakaPluginQuality } from '../../types';
import { extractNeteasePicId, neteasePicIdToUrl, normalizeKuwoCoverUrl } from '../../utils/coverUrl';
import { dispatchFallbackModuleSync } from '../fallbackModules/registry';

export const stripHtmlTags = (str: unknown): string => {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '');
};

/** 单节点封面提取：直接字段 + 网易云专辑嵌套 + picId 兜底 */
const extractCoverFromNode = (node: any): string => {
  if (!node || typeof node !== 'object') return '';
  const raw = node.rawData || node.raw || node;
  let url =
    node.artwork || node.cover || node.coverImg || node.coverUrl || node.cover_url || node.pic || node.picurl || node.img || node.imgurl || node.imgUrl || node.albumPic || node.picture ||
    raw.artwork || raw.cover || raw.coverImg || raw.coverUrl || raw.cover_url || raw.pic || raw.picurl || raw.img || raw.imgurl || raw.imgUrl || raw.albumPic || raw.picture || '';

  // 过滤非字符串真值：网易云搜索的 al.pic 是超大整数，JSON 解析后丢精度，
  // 不能当 URL 用；清空后走下方 picId 加密拼 CDN 兜底
  if (url && typeof url !== 'string') url = '';

  if (!url && (node.al?.picUrl || raw.al?.picUrl)) url = node.al?.picUrl || raw.al?.picUrl;
  if (!url && (node.album?.picUrl || raw.album?.picUrl)) url = node.album?.picUrl || raw.album?.picUrl;
  if (!url && (node.album?.blurPicUrl || raw.album?.blurPicUrl)) url = node.album?.blurPicUrl || raw.album?.blurPicUrl;
  if (!url && (node.coverImgUrl || raw.coverImgUrl)) url = node.coverImgUrl || raw.coverImgUrl;
  if (!url && (node.picUrl || raw.picUrl)) url = node.picUrl || raw.picUrl;

  // 网易云 weapi/search 常只给 picId 不给 picUrl；直接加密拼 CDN，避免再打 getMusicInfo
  if (!url) {
    const picId = extractNeteasePicId(node) ?? extractNeteasePicId(raw);
    if (picId !== null) url = neteasePicIdToUrl(picId);
  }
  return typeof url === 'string' ? url : '';
};

/** 网易云类插件把数据藏在一层嵌套（song/data/music…）里，需递归一层再取封面 */
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
    // 单位启发式（ms/s 歧义区间 1000~59999 只能取一解）：
    // 该区间按秒解释 = 16.7 分钟 ~ 16.6 小时（B 站音乐合集视频极常见，
    // 播客/串烧也在此区间）；按毫秒解释 = 1~60 秒的铃声级短音频（罕见）。
    // 毫秒来源（网易云 dt / B 站 timelength）正常歌曲 ≥ 60000（1 分钟），
    // 秒来源（插件 duration）B 站最长合集 < 60000，故以 60000 为界。
    return val >= 60000 ? Math.floor(val) : Math.floor(val * 1000);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    // 处理 "03:45" 或 "01:02:03" 冒号分割格式
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
    // 处理纯数字字符串 "215" 或 "215000"，单位启发式与数字分支一致（60000 为界）
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

/** 从歌手条目中提取头像 URL，兼容各平台常见字段（含嵌套对象） */
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

/** 从插件返回结果中提取 isEnd（分页结束标志），兼容 isEnd/is_end 及嵌套一层 */
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

/**
 * 将插件 getTopLists 返回的分类数据展平为榜单条目列表。
 * 兼容「分类数组（{ title, data: [...] }）」与「扁平数组（条目本身）」两种结构。
 * 条目 rawData 带 _isTopList 标记，供详情加载走 getTopListDetail。
 */
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
      // 扁平数组：每个条目本身就是一个榜单
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
