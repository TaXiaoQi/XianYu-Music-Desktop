// ==================== 插件格式分发层 ====================
// 全应用唯一按 format 路由的模块：baka → bakaPluginApi（baka 自持实现），
// 其余 → mf 引擎实现（pluginEngineMedia / pluginCatalogDetails，均不含 baka 判定）。
// 未来 baka 独立插件规范只需替换 bakaPluginApi，mf 引擎无需感知。
import type {
  PluginSource,
  PluginSearchResult,
  PluginPlaylistSearchResult,
  PluginMusicInfo,
  QualityKey,
  OnlineQualityFallbackBehavior,
} from '../../types';
import { ensurePluginInstance } from './pluginEngineInstance';
import {
  isBakaPlugin,
  pluginGetBakaMusicInfo,
  bakaGetLyric,
  bakaGetCover,
  bakaGetMusicComments,
  bakaGetTopLists,
  bakaGetRecommendSheets,
  bakaGetPlaylistDetail,
  bakaGetArtistWorks,
  bakaGetArtistAlbums,
  bakaGetArtistInfo,
  bakaGetAlbumSongs,
  bakaGetSupportedQualities,
  bakaProbeAuthFailure,
} from './bakaPluginApi';
import {
  mfGetMusicInfo,
  mfGetLyric,
  mfGetCover,
} from './pluginEngineMedia';
import {
  mfGetTopLists,
  mfGetRecommendSheets,
  mfPlaylistDetailInner,
  withQqDurations,
  mfArtistWorksInner,
  mfGetArtistAlbums,
  mfGetArtistInfoRaw,
  mfGetAlbumSongsInner,
  mfGetSupportedQualities,
} from './pluginCatalogDetails';
import { fetchPlatformMusicComments } from './platformComments';
import { extractArtistDescription, catalogLog } from './pluginCatalogShared';

// 兼容既有消费方：baka 专用直连入口
export { pluginGetBakaMusicInfo } from './bakaPluginApi';
export { isBakaPlugin } from './bakaPluginApi';

// 非 baka 分流能力的既有出口（保持 pluginEngine 门面完整）
export {
  pluginGetVideoSource,
  clearLastMvSourceCallFailed,
  wasLastMvSourceCallFailed,
} from './pluginEngineMedia';
export type { PluginVideoQuality, PluginVideoSource } from './pluginEngineMedia';

// 该格式插件是否要求每次解析新鲜直链（预解析音质缓存不可信，下载链路跳过预解析捷径）
export async function pluginRequiresFreshResolve(source: PluginSource): Promise<boolean> {
  return isBakaPlugin(source);
}

// 最高档探测失败后的沙箱鉴权熔断检查（非 baka 格式恒返回 null）
export async function pluginProbeAuthFailure(source: PluginSource): Promise<string | null> {
  if (!(await isBakaPlugin(source))) return null;
  return bakaProbeAuthFailure();
}

// ==================== 播放 URL ====================

export async function pluginGetMusicInfo(
  source: PluginSource,
  item: PluginSearchResult,
  quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
  fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
  availableQualities: QualityKey[] | null = null,
): Promise<PluginMusicInfo | null> {
  if (await isBakaPlugin(source)) {
    return pluginGetBakaMusicInfo(source, item, quality, fallbackBehavior, availableQualities);
  }
  return mfGetMusicInfo(source, item, quality, fallbackBehavior, availableQualities);
}

// ==================== 歌词 / 封面 / 评论 ====================

export async function pluginGetLyric(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<{ lyric: string; tlyric?: string; lxlyric?: string; yrc?: string; qrc?: string; eslrc?: string; ttml?: string; lyricsRaw?: string } | null> {
  if (await isBakaPlugin(source)) {
    return bakaGetLyric(source, item);
  }
  return mfGetLyric(source, item);
}

export async function pluginGetCover(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<string | null> {
  if (await isBakaPlugin(source)) {
    return bakaGetCover(source, item);
  }
  return mfGetCover(source, item);
}

export async function pluginGetMusicComments(
  source: PluginSource,
  item: PluginSearchResult,
  page: number = 1,
): Promise<{ isEnd?: boolean; data?: any[] } | null> {
  await ensurePluginInstance(source);
  if (await isBakaPlugin(source)) {
    const result = await bakaGetMusicComments(source, item, page);
    if (result) return result;
  }
  return fetchPlatformMusicComments(source, item, page);
}

// ==================== 榜单 / 推荐歌单 ====================

export async function pluginGetTopLists(
  source: PluginSource,
  lxKey?: string,
): Promise<PluginPlaylistSearchResult[]> {
  if (await isBakaPlugin(source)) {
    return bakaGetTopLists(source);
  }
  return mfGetTopLists(source, lxKey);
}

export async function pluginGetRecommendSheets(
  source: PluginSource,
  lxKey?: string,
): Promise<PluginPlaylistSearchResult[]> {
  if (await isBakaPlugin(source)) {
    return bakaGetRecommendSheets(source);
  }
  return mfGetRecommendSheets(source, lxKey);
}

// ==================== 歌单 / 专辑 / 歌手详情 ====================

async function routePlaylistDetailInner(
  source: PluginSource,
  sheetItem: any,
  page: number,
): Promise<{ list: PluginSearchResult[]; isEnd?: boolean }> {
  // 精确导入的合成歌单（_importedTracks）直接交 mf 路径返回导入曲目，必须先于
  // baka 分支：baka 插件对合成 raw 会落到自己的详情分页查询，把全量数据截断成单页
  if (Array.isArray(sheetItem?._importedTracks) && sheetItem._importedTracks.length > 0) {
    return mfPlaylistDetailInner(source, sheetItem, page);
  }
  if (await isBakaPlugin(source)) {
    return bakaGetPlaylistDetail(source, sheetItem, page);
  }
  return mfPlaylistDetailInner(source, sheetItem, page);
}

export async function pluginGetPlaylistDetail(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  const { list } = await routePlaylistDetailInner(source, sheetItem, page);
  return withQqDurations(source, list);
}

export async function pluginGetPlaylistDetailWithEnd(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<{ songs: PluginSearchResult[]; isEnd?: boolean }> {
  const { list, isEnd } = await routePlaylistDetailInner(source, sheetItem, page);
  return { songs: await withQqDurations(source, list), isEnd };
}

export async function pluginGetArtistWorks(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  const list = (await isBakaPlugin(source))
    ? await bakaGetArtistWorks(source, artistItem, page, 'music')
    : await mfArtistWorksInner(source, artistItem, page);
  return withQqDurations(source, list);
}

export async function pluginGetArtistAlbums(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<import('./pluginCatalogShared').PluginAlbumResult[]> {
  if (await isBakaPlugin(source)) {
    return bakaGetArtistAlbums(source, artistItem, page);
  }
  return mfGetArtistAlbums(source, artistItem, page);
}

export async function pluginGetArtistInfo(
  source: PluginSource,
  artistItem: any,
): Promise<string> {
  if (!source || !artistItem) return '';
  let info: any = null;
  if (await isBakaPlugin(source)) {
    info = await bakaGetArtistInfo(source, artistItem);
  } else {
    info = await mfGetArtistInfoRaw(source, artistItem);
  }
  const desc = extractArtistDescription(info);
  catalogLog(`[${source.name}] getArtistInfo → ${desc ? `简介 ${desc.length} 字符` : '无简介'}`);
  return desc;
}

export async function pluginGetAlbumSongs(
  source: PluginSource,
  albumItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  const list = (await isBakaPlugin(source))
    ? await bakaGetAlbumSongs(source, albumItem, page)
    : await mfGetAlbumSongsInner(source, albumItem, page);
  return withQqDurations(source, list);
}

// ==================== 音质 ====================

export async function pluginGetSupportedQualities(
  source: PluginSource,
): Promise<QualityKey[] | null> {
  if (await isBakaPlugin(source)) {
    return bakaGetSupportedQualities(source);
  }
  return mfGetSupportedQualities(source);
}
