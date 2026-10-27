import type {
  PluginSource,
  PluginSearchResult,
  PluginPlaylistSearchResult,
  QualityKey,
} from '../../types';
import { normalizeQualityKey } from '../../types';
import {
  extractAlbum,
  extractArtist,
  extractCoverUrls,
  extractResultList,
  extractIsEnd,
  resetMediaItem,
  stripHtmlTags,
  toPluginSearchResults,
  flattenTopListCategories,
} from './pluginResultMappers';
import {
  isQqMusicPluginSource,
  qqFillSongDurations,
  qqHostAlbumSongsFallback,
} from './qqHostSearchFallback';
import { BakaPluginManager } from './bakaPluginManager';
import { isBilibiliSource, log } from './pluginEngineBase';
import { ensurePluginInstance } from './pluginEngineInstance';
import {
  retryOnEmpty,
  extractArtistDescription,
  catalogLog,
} from './pluginCatalogShared';
import { hostPlaylistDetailOrNull } from './playlistImportBase';
import type { PlaylistImportResult } from './playlistImportBase';
import type {
  PluginAlbumResult,
} from './pluginCatalogShared';
import { lxToplistFetchTopLists, lxToplistFetchTracks } from './lxToplist';
import {
  lxRecommendSheetTagsFallback,
  lxRecommendSheetsByTagFallback,
  type LxRecommendSheetsResult,
  type LxRecommendTag,
} from './lxRecommendSheets';

// ==================== 插件榜单 ====================

// LX 榜单源子集（lx_toplist 兜底模块支持的平台）
const LX_TOPLIST_SOURCES = ['wy', 'kg', 'kw', 'tx'];

export const lxToplistSourcesOf = (source: PluginSource, lxKey?: string): string[] =>
  (source.sources ?? []).filter((s) => LX_TOPLIST_SOURCES.includes(s) && (!lxKey || s === lxKey));

export async function pluginGetTopLists(source: PluginSource, lxKey?: string): Promise<PluginPlaylistSearchResult[]> {
  if (source.format === 'lx') {
    const sources = lxToplistSourcesOf(source, lxKey);
    if (sources.length === 0) return [];
    try {
      return await flattenTopListCategories(
        await lxToplistFetchTopLists(sources),
        source,
      );
    } catch (e: any) {
      console.warn(`[${source.name}] lx_toplist getTopLists 调用失败:`, e?.message || e);
      return [];
    }
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (await BakaPluginManager.isBakaPlugin(source)) {
      return BakaPluginManager.getTopLists(source);
    }
    if (typeof inst.instance.getTopLists !== 'function') return [];
    const topLists = await inst.instance.getTopLists();
    return await flattenTopListCategories(topLists, source);
  } catch (e: any) {
    console.warn(`[${source.name}] getTopLists 调用失败:`, e?.message || e);
    return [];
  }
}

export async function pluginSupportsTopLists(source: PluginSource): Promise<boolean> {
  if (source.format === 'lx') return lxToplistSourcesOf(source).length > 0;
  const inst = await ensurePluginInstance(source);
  return !!inst && typeof inst.instance.getTopLists === 'function';
}

// ==================== 插件推荐歌单 ====================

// MF 插件协议自带推荐歌单能力（getRecommendSheetTags/getRecommendSheetsByTag）；
// LX 音源经 lx_recommend_sheets 兜底模块提供同协议能力（平台集合与榜单一致）
export async function pluginSupportsRecommendSheets(source: PluginSource): Promise<boolean> {
  if (source.format === 'lx') return lxToplistSourcesOf(source).length > 0;
  const inst = await ensurePluginInstance(source);
  return !!inst && typeof inst.instance.getRecommendSheetTags === 'function';
}

// MF 插件 tags 出参取默认标签：defaultTag → tags[0]（旧约定）→
// pinned 首个（MusicFree 标准形态 {pinned, data}，酷我[T]/JOOX/网易云/bilibili
// 等社区插件）→ 首分组首标签兜底；标签须原样回传（如酷我 pinned.digest 决定
// 取数端点），无可选标签传 null 交插件自身默认。社区插件普遍未对 null 判空
// （tag.id 直接抛错），绝不能在标签可得时把 null 传下去
function pickDefaultRecommendTag(tags: any): any {
  if (!tags || typeof tags !== 'object') return null;
  if (tags.defaultTag) return tags.defaultTag;
  if (Array.isArray(tags.tags) && tags.tags.length > 0) return tags.tags[0];
  const candidates: any[] = [
    ...(Array.isArray(tags.pinned) ? tags.pinned : []),
    ...(Array.isArray(tags.data) && tags.data.length > 0 && tags.data[0] && typeof tags.data[0] === 'object'
      ? tags.data[0].data || []
      : []),
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && candidate.id != null) return candidate;
  }
  return null;
}

export async function pluginGetRecommendSheets(source: PluginSource, lxKey?: string): Promise<PluginPlaylistSearchResult[]> {
  if (source.format === 'lx') return pluginLxRecommendSheets(source, lxKey);
  try {
    if (await BakaPluginManager.isBakaPlugin(source)) {
      const tag = pickDefaultRecommendTag(await BakaPluginManager.getRecommendSheetTags(source));
      return await BakaPluginManager.getRecommendSheetsByTag(source, tag, 1);
    }
    const inst = await ensurePluginInstance(source);
    if (!inst) return [];
    let tag: any = null;
    if (typeof inst.instance.getRecommendSheetTags === 'function') {
      tag = pickDefaultRecommendTag(await inst.instance.getRecommendSheetTags());
    }
    if (typeof inst.instance.getRecommendSheetsByTag !== 'function') return [];
    const result = (await inst.instance.getRecommendSheetsByTag(tag, 1)) ?? {};
    const list = extractResultList(result);
    if (list.length === 0) return [];
    const covers = await extractCoverUrls(list);
    return list
      .map((item: any, i: number) => {
        resetMediaItem(item, source.name);
        const id = String(item.id || item.sheetId || '');
        return {
          id,
          title: stripHtmlTags(item.title || item.name || ''),
          coverUrl: covers[i] || '',
          playCount: item.playCount || undefined,
          trackCount: item.trackCount || item.musicCount || undefined,
          platform: item.platform || source.name,
          platformId: id,
          pluginId: source.id,
          rawData: item,
        };
      })
      .filter((item) => item.id && item.title);
  } catch (e: any) {
    console.warn(`[${source.name}] 推荐歌单获取失败:`, e?.message || e);
    return [];
  }
}

// lx_recommend_sheets 条目 → PluginPlaylistSearchResult。条目缺 source（下发 JS
// 模块形状差异）时回退请求的平台键；_lxSource 供详情页进 lx 引擎分支
function lxRecommendSheetList(
  result: LxRecommendSheetsResult | null,
  fallbackSource: string,
  source: PluginSource,
): PluginPlaylistSearchResult[] {
  const data = Array.isArray(result?.data) ? result!.data : [];
  return data
    .map((entry: any) => {
      const lxSource = String(entry?.source ?? '') || fallbackSource;
      const id = String(entry?.id ?? '');
      resetMediaItem(entry, source.name);
      return {
        id,
        title: stripHtmlTags(entry?.title || ''),
        coverUrl: String(entry?.artwork ?? ''),
        playCount: Number(entry?.playCount) || undefined,
        trackCount: Number(entry?.worksNum) || undefined,
        artist: String(entry?.artist ?? ''),
        platform: source.name,
        platformId: id,
        pluginId: source.id,
        rawData: { ...entry, _lxSource: lxSource, _lxPlaylistId: id },
      };
    })
    .filter((item) => item.id && item.title);
}

// LX 音源推荐歌单：取 pinned 首个标签（指定 lxKey 时只接受该平台的标签）拉第一页；
// 空结果且有标签时以 null 标签（各平台默认推荐）对首个平台重试一次
async function pluginLxRecommendSheets(source: PluginSource, lxKey?: string): Promise<PluginPlaylistSearchResult[]> {
  const keys = lxToplistSourcesOf(source, lxKey);
  if (keys.length === 0) return [];
  try {
    const tags = await lxRecommendSheetTagsFallback(keys);
    let tag: LxRecommendTag | null = null;
    const pinned = tags?.pinned;
    if (Array.isArray(pinned) && pinned.length > 0 && pinned[0]) {
      if (lxKey == null || String(pinned[0].source ?? '') === lxKey) {
        tag = pinned[0];
      }
    }
    const tagSource = String(tag?.source ?? '');
    const srcKey = tagSource || keys[0];
    let list = lxRecommendSheetList(await lxRecommendSheetsByTagFallback(srcKey, tag, 1), srcKey, source);
    if (list.length === 0 && tag != null) {
      list = lxRecommendSheetList(await lxRecommendSheetsByTagFallback(keys[0], null, 1), keys[0], source);
    }
    return list;
  } catch (e: any) {
    console.warn(`[${source.name}] LX 推荐歌单获取失败:`, e?.message || e);
    return [];
  }
}

// ==================== 插件歌单详情 ====================

async function pluginGetPlaylistDetailInner(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
  // list 常规为 PluginSearchResult[]；LX 榜单分支返回 lx_search 同构条目（由调用方按引擎区分消费）
): Promise<{ list: any[]; isEnd?: boolean }> {
  // 精确导入的合成歌单（_importedTracks）直接返回导入曲目，必须放在
  // Baka 分支之前：Baka 插件对合成 raw 会落到自己的详情分页查询，
  // 把全量数据截断成单页
  if (Array.isArray(sheetItem?._importedTracks) && sheetItem._importedTracks.length > 0) {
    if (page === 1) {
      const list = sheetItem._importedTracks;
      list.forEach((_: any) => { resetMediaItem(_, source.name); });
      return { list: await toPluginSearchResults(list, source), isEnd: true };
    }
    return { list: [], isEnd: true };
  }
  // LX 榜单：走 lx_toplist 兜底模块，条目已转为与 lx_search 结果同构的形状
  if (source.format === 'lx' && sheetItem?._isTopList) {
    const lxSource = sheetItem?.rawData?._lxSource || sheetItem?.rawData?.source;
    const toplistId = String(sheetItem?.id ?? sheetItem?.rawData?.id ?? '');
    if (lxSource && toplistId) {
      try {
        return await lxToplistFetchTracks(String(lxSource), toplistId, page);
      } catch (e: any) {
        log(`[${source.name}] lx_toplist getTopListDetail 调用失败: ${e?.message}`);
      }
    }
    return { list: [], isEnd: true };
  }
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    if (isBilibiliSource(source)) {
      return BakaPluginManager.getBilibiliDetail(source, sheetItem, page);
    }
    return BakaPluginManager.getPlaylistDetail(source, sheetItem, page);
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return { list: [] };

  try {
    if (sheetItem?._isAlbum) {
      if (typeof inst.instance.getAlbumInfo === 'function') {
        const getAlbumInfo = inst.instance.getAlbumInfo;
        try {
          const result = await retryOnEmpty(
            `[${source.name}] getAlbumInfo(album as playlist) album="${stripHtmlTags(sheetItem?.title || sheetItem?.name || '')}"`,
            () => getAlbumInfo(sheetItem, page),
            (r) => extractResultList(r).length === 0,
          );
          const list = extractResultList(result);
          if (list.length > 0) {
            list.forEach((_: any) => { resetMediaItem(_, source.name); });
            return { list: await toPluginSearchResults(list, source), isEnd: extractIsEnd(result) };
          }
        } catch (e: any) {
          log(`[${source.name}] getAlbumInfo(album as playlist) 调用失败: ${e?.message}`);
        }
      }
      return { list: [], isEnd: true };
    }

    if (sheetItem?._isTopList && typeof inst.instance.getTopListDetail === 'function') {
      try {
        const result = await inst.instance.getTopListDetail(sheetItem, page);
        const list = extractResultList(result);
        if (list.length > 0) {
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return { list: await toPluginSearchResults(list, source), isEnd: extractIsEnd(result) };
        }
      } catch (e: any) {
        log(`[${source.name}] getTopListDetail 调用失败: ${e?.message}`);
      }
      return { list: [], isEnd: true };
    }

    if (typeof inst.instance.getMusicSheetInfo === 'function') {
      const getSheetInfo = inst.instance.getMusicSheetInfo;
      try {
        const result = await retryOnEmpty(
          `[${source.name}] getMusicSheetInfo sheet="${stripHtmlTags(sheetItem?.title || sheetItem?.name || '')}"`,
          () => getSheetInfo(sheetItem, page),
          (r) => extractResultList(r).length === 0,
        );
        const list = extractResultList(result);
        if (list.length > 0) {
          // MusicFree 宿主协议：插件把 trackIds 放在 result.sheetItem 里回传
          // （如网易云插件用模块级缓存 + sheetItem._trackIds 续页）。原样合并回
          // sheetItem（与调用方共享同一引用），下一页调用时插件可直接拿到全量 ID，
          // 不依赖其模块缓存在沙箱里存活。
          if (result && typeof result.sheetItem === 'object' && result.sheetItem !== null
              && sheetItem && typeof sheetItem === 'object') {
            try { Object.assign(sheetItem, result.sheetItem); } catch { /* 冻结对象忽略 */ }
          }
          if (page === 1) {
            // 插件歌单详情单页截断时用宿主全量补齐（酷狗 31 / QQ 50 场景）
            const fullSheet = await hostFullSheetIfTruncated(
              source, sheetItem, list, extractIsEnd(result), getSheetInfo,
            );
            if (fullSheet && fullSheet.length > 0) {
              return { list: fullSheet, isEnd: true };
            }
          }
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return { list: await toPluginSearchResults(list, source), isEnd: extractIsEnd(result) };
        }
      } catch (e: any) {
        log(`[${source.name}] getMusicSheetInfo 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    if (page === 1 && typeof inst.instance.search === 'function') {
      const sheetTitle = stripHtmlTags(sheetItem?.title || sheetItem?.name || '');
      if (sheetTitle) {
        log(`[${source.name}] getMusicSheetInfo 不可用或为空，回退到搜索 "${sheetTitle}"`);
        const result = (await inst.instance.search(sheetTitle, 1, 'music')) ?? {};
        const list = extractResultList(result);
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return { list: await toPluginSearchResults(list, source), isEnd: true };
      }
    }

    return { list: [], isEnd: true };
  } catch (e: any) {
    log(`[${source.name}] 获取歌单详情失败: ${e?.message}`);
    return { list: [], isEnd: true };
  }
}

// ==================== 宿主歌单全量兜底（插件单页截断） ====================

// 部分聚合插件歌单详情不分页，且上游接口单页有上限（酷狗 31 / QQ 50），
// 而宿主 playlist_fetcher（导入链路）能拿全量。此处仅在插件首页之后做
// 截断检测，命中时用宿主实现补全（kg/wy/tx/kw 四个有宿主实现的平台）。
function sheetDeclaredCount(sheetItem: any): number | null {
  const keys = [
    'trackCount', 'trackcount', 'track_count', 'worksNum', 'worksnum',
    'totalworks', 'songcount', 'songCount', 'song_count', 'totalSongNum', 'total_song_num',
  ];
  for (const item of [sheetItem, sheetItem?.rawData]) {
    if (!item || typeof item !== 'object') continue;
    for (const k of keys) {
      const v = item[k];
      const n = typeof v === 'number'
        ? v
        : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

// ID 比对键并集（小写）：插件条目与宿主条目的标识字段形态不同，取双方常见字段
function sheetSongIdKeys(item: any): string[] {
  const raw = item?.rawData;
  return [
    item?.id, item?.songmid, item?.songId, item?.song_id, item?.hash,
    item?.audioId, item?.audio_id, item?.musicId,
    raw?.songmid, raw?.songId, raw?.hash, raw?.id,
  ]
    .filter(v => v !== undefined && v !== null && v !== '')
    .map(v => String(v).toLowerCase());
}

// 截断检测与宿主补全（仅 page===1 调用）：
// 1) 声明曲目数已知且 ≤ 插件首页 → 首页已完整；
// 2) 插件未声称结尾（isEnd !== true）→ 交回常规分页循环；
// 3) 插件声称结尾 → 探测第二页确认单页型后，依次试宿主全量；结果必须
//    严格多于插件首页，且至少 1 首能与首页对上 ID（防纯数字 ID 跨平台撞车串单）。
async function hostFullSheetIfTruncated(
  source: PluginSource,
  sheetItem: any,
  page1List: any[],
  page1IsEnd: boolean | undefined,
  getSheetInfo: (item: any, page: number) => Promise<any>,
): Promise<PluginSearchResult[] | null> {
  const declared = sheetDeclaredCount(sheetItem);
  if (declared !== null && declared <= page1List.length) return null;
  if (page1IsEnd !== true) return null;

  let probeCount = 0;
  let probeFirstKeys: string[] = [];
  try {
    const probeList = extractResultList(await getSheetInfo(sheetItem, 2));
    probeCount = probeList.length;
    probeFirstKeys = probeList.length > 0 ? sheetSongIdKeys(probeList[0]) : [];
  } catch {
    // 第二页异常按「不翻页」处理
  }
  if (probeCount > 0) {
    // 单页型插件可能忽略 page 参数，第二页返回与首页相同的内容。
    // 首条 ID 对得上 → 视为未翻页，继续走宿主全量兜底；否则交回常规分页循环。
    const page1FirstKeys = sheetSongIdKeys(page1List[0]);
    const duplicated = probeFirstKeys.some(k => page1FirstKeys.includes(k));
    if (!duplicated) return null;
  }

  const sheetId = String(sheetItem?.id ?? sheetItem?.rawData?.id ?? '').trim();
  if (!sheetId) return null;
  const page1Keys = new Set(page1List.flatMap(sheetSongIdKeys));

  const runners: [string, () => Promise<PlaylistImportResult | null>][] = [
    ['kg', () => hostPlaylistDetailOrNull('kg', sheetId)],
    ['wy', () => hostPlaylistDetailOrNull('wy', sheetId)],
    ['tx', () => hostPlaylistDetailOrNull('tx', sheetId)],
    ['kw', () => hostPlaylistDetailOrNull('kw', sheetId)],
    ['mg', () => hostPlaylistDetailOrNull('mg', sheetId)],
  ];
  for (const [platform, run] of runners) {
    try {
      const result = await run();
      if (!result || !result.songs.length || result.songs.length <= page1List.length) continue;
      const overlapped = result.songs.some(s => sheetSongIdKeys(s).some(k => page1Keys.has(k)));
      if (!overlapped) continue;
      log(`[${source.name}] 歌单详情单页截断(${page1List.length}/${result.songs.length})，宿主 ${platform} 全量兜底: ${sheetId}`);
      // 复用 _importedTracks 形状：播放链路与导入歌单一致
      const tracks = result.songs.map(s => ({
        ...(s.rawData as Record<string, any>),
        _hostFallback: true,
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        coverUrl: s.coverUrl,
        duration: s.duration,
      }));
      tracks.forEach((_: any) => { resetMediaItem(_, source.name); });
      return await toPluginSearchResults(tracks, source);
    } catch (e: any) {
      log(`[${source.name}] 宿主 ${platform} 歌单详情兜底失败: ${e?.message || e}`);
    }
  }
  return null;
}

async function withQqDurations(
  source: PluginSource,
  results: PluginSearchResult[],
): Promise<PluginSearchResult[]> {
  if (!results.length) return results;
  const inst = await ensurePluginInstance(source);
  return qqFillSongDurations(source, (inst?.instance as any)?.platform, results);
}

export async function pluginGetPlaylistDetail(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  const { list } = await pluginGetPlaylistDetailInner(source, sheetItem, page);
  return withQqDurations(source, list);
}

export async function pluginGetPlaylistDetailWithEnd(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<{ songs: PluginSearchResult[]; isEnd?: boolean }> {
  const { list, isEnd } = await pluginGetPlaylistDetailInner(source, sheetItem, page);
  return { songs: await withQqDurations(source, list), isEnd };
}

// ==================== 收藏夹导入 ====================

export async function pluginImportMusicSheet(
  source: PluginSource,
  urlLike: string,
): Promise<PluginSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.importMusicSheet !== 'function') return [];
    const imported = await inst.instance.importMusicSheet(urlLike);
    if (!Array.isArray(imported) || imported.length === 0) return [];
    imported.forEach((_: any) => { resetMediaItem(_, source.name); });
    return toPluginSearchResults(imported, source);
  } catch (e: any) {
    log(`[${source.name}] importMusicSheet 失败: ${e?.message}`);
    return [];
  }
}

// ==================== 歌手作品（歌曲） ====================

async function pluginGetArtistWorksInner(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    if (isBilibiliSource(source)) {
      return BakaPluginManager.getBilibiliArtistWorks(source, artistItem, page, 'music');
    }
    return BakaPluginManager.getArtistWorks(source, artistItem, page, 'music');
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.getArtistWorks === 'function') {
      const getWorks = inst.instance.getArtistWorks;
      try {
        const result = await retryOnEmpty(
          `[${source.name}] getArtistWorks(music) artist="${stripHtmlTags(artistItem?.name || artistItem?.title || '')}"`,
          () => getWorks(artistItem, page, 'music'),
          (r) => extractResultList(r).length === 0,
        );
        const list = extractResultList(result);
        if (list.length > 0) {
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return toPluginSearchResults(list, source);
        }
      } catch (e: any) {
        log(`[${source.name}] getArtistWorks 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    if (page === 1 && typeof inst.instance.search === 'function') {
      const artistName = stripHtmlTags(artistItem?.name || artistItem?.title || artistItem?.artist || '');
      if (artistName) {
        log(`[${source.name}] getArtistWorks 不可用或为空，回退到搜索 "${artistName}"`);
        const result = (await inst.instance.search(artistName, 1, 'music')) ?? {};
        const list = extractResultList(result);
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return toPluginSearchResults(list, source);
      }
    }

    return [];
  } catch (e: any) {
    log(`[${source.name}] 获取歌手作品失败: ${e?.message}`);
    return [];
  }
}

// ==================== 歌手作品（专辑） ====================

export async function pluginGetArtistAlbums(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginAlbumResult[]> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    const results = isBilibiliSource(source)
      ? await BakaPluginManager.getBilibiliArtistWorks(source, artistItem, page, 'album')
      : await BakaPluginManager.getArtistWorks(source, artistItem, page, 'album');
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
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.getArtistWorks !== 'function') return [];

    const getWorks = inst.instance.getArtistWorks;
    const result = await retryOnEmpty(
      `[${source.name}] getArtistWorks(album) artist="${stripHtmlTags(artistItem?.name || artistItem?.title || '')}"`,
      () => getWorks(artistItem, page, 'album'),
      (r) => extractResultList(r).length === 0,
    );
    const list = extractResultList(result);
    if (list.length === 0) return [];

    const covers = await extractCoverUrls(list);
    return list.map((item: any, i: number) => {
      resetMediaItem(item, source.name);
      const id = item.id || item.albumId || '';
      const name = stripHtmlTags(item.title || item.name || item.album || '');
      const artist = extractArtist(item);
      return {
        id,
        name,
        artist,
        coverUrl: covers[i],
        platform: item.platform || source.name,
        platformId: id,
        pluginId: source.id,
        rawData: item,
      };
    });
  } catch (e: any) {
    log(`[${source.name}] 获取歌手专辑失败: ${e?.message}`);
    return [];
  }
}

export async function pluginGetArtistInfo(
  source: PluginSource,
  artistItem: any,
): Promise<string> {
  if (!source || !artistItem) return '';
  let info: any = null;
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    info = await BakaPluginManager.getArtistInfo(source, artistItem);
  } else {
    const inst = await ensurePluginInstance(source);
    if (!inst) return '';
    try {
      const fn = inst.instance.getArtistInfo;
      if (typeof fn === 'function') {
        const p = fn(artistItem);
        info = p && typeof p.catch === 'function' ? (await p.catch(() => null)) : p;
      }
    } catch {
      info = null;
    }
  }
  const desc = extractArtistDescription(info);
  catalogLog(`[${source.name}] getArtistInfo → ${desc ? `简介 ${desc.length} 字符` : '无简介'}`);
  return desc;
}

// ==================== 专辑详情 ====================

async function pluginGetAlbumSongsInner(
  source: PluginSource,
  albumItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    if (isBilibiliSource(source)) {
      const { list } = await BakaPluginManager.getBilibiliDetail(source, albumItem, page);
      return list;
    }
    return BakaPluginManager.getAlbumSongs(source, albumItem, page);
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  const albumMid = albumItem?.albumMID || albumItem?.albummid || albumItem?.albumMid;
  if (albumMid && !albumItem?.albumMID) {
    albumItem = { ...albumItem, albumMID: albumMid };
  }

  try {
    if (typeof inst.instance.getAlbumInfo === 'function') {
      const getAlbumInfo = inst.instance.getAlbumInfo;
      try {
        const result = await retryOnEmpty(
          `[${source.name}] getAlbumInfo album="${stripHtmlTags(albumItem?.title || albumItem?.name || '')}"`,
          () => getAlbumInfo(albumItem, page),
          (r) => extractResultList(r).length === 0,
        );
        const list = extractResultList(result);
        if (list.length > 0) {
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return toPluginSearchResults(list, source);
        }
      } catch (e: any) {
        log(`[${source.name}] getAlbumInfo 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    if (await isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
      const albumMidForHost = albumItem?.albumMID || albumItem?.albummid || albumItem?.albumMid;
      if (albumMidForHost) {
        log(`[pluginGetAlbumSongs] ${source.name} getAlbumInfo 为空，走宿主 QQ 专辑曲目兜底: ${albumMidForHost}`);
        const hostSongs = await qqHostAlbumSongsFallback(source, albumMidForHost, page);
        if (hostSongs.length > 0) return hostSongs;
      }
    }

    if (page === 1 && typeof inst.instance.search === 'function') {
      const albumName = stripHtmlTags(albumItem?.title || albumItem?.name || albumItem?.album || '');
      if (albumName) {
        log(`[${source.name}] getAlbumInfo 不可用或为空，回退到搜索 "${albumName}"`);
        const result = (await inst.instance.search(albumName, 1, 'music')) ?? {};
        const list = extractResultList(result);
        const albumNameLower = albumName.toLowerCase();
        const filtered = list.filter((item: any) => {
          const itemAlbum = stripHtmlTags(extractAlbum(item)).toLowerCase();
          return itemAlbum === albumNameLower || itemAlbum.includes(albumNameLower);
        });
        const songs = (filtered.length > 0 ? filtered : list);
        songs.forEach((_: any) => { resetMediaItem(_, source.name); });
        return toPluginSearchResults(songs, source);
      }
    }

    return [];
  } catch (e: any) {
    log(`[${source.name}] 获取专辑详情失败: ${e?.message}`);
    return [];
  }
}

// ==================== 对外一次性取数入口（含 QQ 时长补齐） ====================

export async function pluginGetArtistWorks(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  return withQqDurations(source, await pluginGetArtistWorksInner(source, artistItem, page));
}

export async function pluginGetAlbumSongs(
  source: PluginSource,
  albumItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  return withQqDurations(source, await pluginGetAlbumSongsInner(source, albumItem, page));
}

// ==================== 音质 ====================

export async function pluginGetSupportedQualities(source: PluginSource): Promise<QualityKey[] | null> {
  const inst = await ensurePluginInstance(source);
  if (await BakaPluginManager.isBakaPlugin(source)) {
    return BakaPluginManager.getSupportedQualities(source);
  }

  const declared = inst?.instance.supportedQualities;
  if (Array.isArray(declared)) {
    const keys = declared
      .map((q: unknown) => normalizeQualityKey(q))
      .filter((q): q is QualityKey => q !== null);
    if (keys.length > 0) return keys;
  }

  return ['128k', '320k', 'flac'];
}