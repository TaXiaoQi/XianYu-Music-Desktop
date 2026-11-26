// ==================== Baka 插件自持对外入口 ====================
// BakaMusic 系插件（Toskysun）的全部宿主侧调用分支收敛于此模块：
// mf 引擎模块（pluginEngineMedia / pluginCatalogDetails 等）不含任何 baka 判定，
// 由 pluginDispatch 按 format 单点分发到本模块。
// 未来 baka 独立插件规范只需演进本模块与 bakaPluginManager*，mf 引擎零改动。
import type {
  PluginSource,
  PluginSearchResult,
  PluginPlaylistSearchResult,
  PluginMusicInfo,
  QualityKey,
  OnlineQualityFallbackBehavior,
} from '../../types';
import { ensurePluginInstance } from './pluginEngineInstance';
import { isBilibiliSource } from './pluginEngineBase';
import { BakaPluginManager } from './bakaPluginManager';
import { getLastSandboxError, SANDBOX_AUTH_FAIL_RE } from './pluginSandboxManager';
import { pickDefaultRecommendTag, type PluginAlbumResult } from './pluginCatalogShared';

// ==================== 判定 ====================

export async function isBakaPlugin(source: PluginSource): Promise<boolean> {
  return BakaPluginManager.isBakaPlugin(source);
}

// ==================== 播放 URL / 歌词 / 封面 / 评论 ====================

export async function pluginGetBakaMusicInfo(
  source: PluginSource,
  item: PluginSearchResult,
  quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
  fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
  availableQualities: QualityKey[] | null = null,
): Promise<PluginMusicInfo | null> {
  await ensurePluginInstance(source);
  return BakaPluginManager.getMediaSource(source, item, quality, fallbackBehavior, availableQualities);
}

export async function bakaGetLyric(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<{ lyric: string; tlyric?: string; lxlyric?: string; yrc?: string; qrc?: string; eslrc?: string; ttml?: string; lyricsRaw?: string } | null> {
  await ensurePluginInstance(source);
  return BakaPluginManager.getLyric(source, item);
}

export async function bakaGetCover(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<string | null> {
  await ensurePluginInstance(source);
  return BakaPluginManager.getCover(source, item);
}

export async function bakaGetMusicComments(
  source: PluginSource,
  item: PluginSearchResult,
  page: number = 1,
): Promise<{ isEnd?: boolean; data?: any[] } | null> {
  return BakaPluginManager.getMusicComments(source, item, page);
}

// ==================== 榜单 / 推荐歌单 ====================

export async function bakaGetTopLists(
  source: PluginSource,
): Promise<PluginPlaylistSearchResult[]> {
  await ensurePluginInstance(source);
  return BakaPluginManager.getTopLists(source);
}

export async function bakaGetRecommendSheets(
  source: PluginSource,
): Promise<PluginPlaylistSearchResult[]> {
  await ensurePluginInstance(source);
  const tag = pickDefaultRecommendTag(await BakaPluginManager.getRecommendSheetTags(source));
  return BakaPluginManager.getRecommendSheetsByTag(source, tag, 1);
}

// ==================== 歌单 / 专辑 / 歌手 ====================

export async function bakaGetPlaylistDetail(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<{ list: PluginSearchResult[]; isEnd?: boolean }> {
  await ensurePluginInstance(source);
  if (isBilibiliSource(source)) {
    return BakaPluginManager.getBilibiliDetail(source, sheetItem, page);
  }
  return BakaPluginManager.getPlaylistDetail(source, sheetItem, page);
}

export async function bakaGetArtistWorks(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
  type: 'music' | 'album' = 'music',
): Promise<PluginSearchResult[]> {
  await ensurePluginInstance(source);
  if (isBilibiliSource(source)) {
    return BakaPluginManager.getBilibiliArtistWorks(source, artistItem, page, type);
  }
  return BakaPluginManager.getArtistWorks(source, artistItem, page, type);
}

export async function bakaGetArtistAlbums(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginAlbumResult[]> {
  const results = await bakaGetArtistWorks(source, artistItem, page, 'album');
  return results.map((item: any) => ({
    id: item.id || '',
    name: item.title || '',
    artist: item.artist || '',
    coverUrl: item.coverUrl || '',
    platform: item.platform || source.name,
    platformId: item.id || '',
    pluginId: source.id,
    rawData: item.rawData,
  }));
}

export async function bakaGetArtistInfo(
  source: PluginSource,
  artistItem: any,
): Promise<any | null> {
  await ensurePluginInstance(source);
  return BakaPluginManager.getArtistInfo(source, artistItem);
}

export async function bakaGetAlbumSongs(
  source: PluginSource,
  albumItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  await ensurePluginInstance(source);
  if (isBilibiliSource(source)) {
    const { list } = await BakaPluginManager.getBilibiliDetail(source, albumItem, page);
    return list;
  }
  return BakaPluginManager.getAlbumSongs(source, albumItem, page);
}

// ==================== 音质 ====================

export async function bakaGetSupportedQualities(
  source: PluginSource,
): Promise<QualityKey[] | null> {
  await ensurePluginInstance(source);
  return BakaPluginManager.getSupportedQualities(source);
}

// ==================== 探测链路辅助 ====================

// 最高档探测失败后检查 baka 沙箱鉴权熔断日志：失效时逐档实测无意义，直接中止。
// 仅供 pluginDispatch 分发（非 baka 格式恒返回 null）。
export function bakaProbeAuthFailure(): string | null {
  const err = getLastSandboxError();
  return err && SANDBOX_AUTH_FAIL_RE.test(err) ? err : null;
}
