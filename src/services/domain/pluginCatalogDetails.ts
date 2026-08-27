/**
 * 插件引擎 · 目录详情/取数（榜单、歌单、歌手、专辑、音质）。
 *
 * 条目 → 曲目/扩展信息的组合逻辑：榜单、歌单详情、收藏夹导入、歌手作品、
 * QQ 时长批量补齐、专辑曲目、歌手简介与音质列表。Baka 插件路径统一委托
 * BakaPluginManager（此处与 MusicFree 分离），QQ 插件走宿主兜底链。
 * 依赖共享工具叶子 pluginCatalogShared 与 BakaPluginManager / qqHostSearchFallback。
 */
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
  extractCoverUrl,
  extractResultList,
  extractIsEnd,
  resetMediaItem,
  stripHtmlTags,
  toPluginSearchResult,
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
import type {
  PluginAlbumResult,
} from './pluginCatalogShared';

// ==================== 插件榜单 ====================

/**
 * 获取插件排行榜（榜单）列表。
 * 调用插件的 getTopLists 接口，返回按分类展平的榜单条目。
 * 条目 rawData 带 _isTopList 标记，供 pluginGetPlaylistDetail 走 getTopListDetail 获取曲目。
 * Baka 插件的榜单机制（获取 + 展平）完全委托给 BakaPluginManager，与 MF 分离。
 */
export async function pluginGetTopLists(source: PluginSource): Promise<PluginPlaylistSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (await BakaPluginManager.isBakaPlugin(source)) {
      return BakaPluginManager.getTopLists(source);
    }
    if (typeof inst.instance.getTopLists !== 'function') return [];
    const topLists = await inst.instance.getTopLists();
    return flattenTopListCategories(topLists, source);
  } catch (e: any) {
    console.warn(`[${source.name}] getTopLists 调用失败:`, e?.message || e);
    return [];
  }
}

/** 检查插件是否支持榜单接口（getTopLists） */
export async function pluginSupportsTopLists(source: PluginSource): Promise<boolean> {
  const inst = await ensurePluginInstance(source);
  return !!inst && typeof inst.instance.getTopLists === 'function';
}

// ==================== 插件歌单详情 ====================

async function pluginGetPlaylistDetailInner(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<{ list: PluginSearchResult[]; isEnd?: boolean }> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    // B站专辑与歌单统一走专用取数路径
    if (isBilibiliSource(source)) {
      return BakaPluginManager.getBilibiliDetail(source, sheetItem, page);
    }
    return BakaPluginManager.getPlaylistDetail(source, sheetItem, page);
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return { list: [] };

  try {
    // 如果是 importMusicSheet 导入的歌单，直接返回已导入的曲目
    if (Array.isArray(sheetItem?._importedTracks) && sheetItem._importedTracks.length > 0) {
      if (page === 1) {
        const list = sheetItem._importedTracks;
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return { list: list.map((item: any) => toPluginSearchResult(item, source)), isEnd: true };
      }
      return { list: [], isEnd: true };
    }

    // 如果是专辑条目（歌单搜索中将专辑索引为歌单），用 getAlbumInfo 获取曲目
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
            return { list: list.map((item: any) => toPluginSearchResult(item, source)), isEnd: extractIsEnd(result) };
          }
        } catch (e: any) {
          log(`[${source.name}] getAlbumInfo(album as playlist) 调用失败: ${e?.message}`);
        }
      }
      return { list: [], isEnd: true };
    }

    // 如果是排行榜条目，用 getTopListDetail 获取曲目
    if (sheetItem?._isTopList && typeof inst.instance.getTopListDetail === 'function') {
      try {
        const result = await inst.instance.getTopListDetail(sheetItem, page);
        const list = extractResultList(result);
        if (list.length > 0) {
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return { list: list.map((item: any) => toPluginSearchResult(item, source)), isEnd: extractIsEnd(result) };
        }
      } catch (e: any) {
        log(`[${source.name}] getTopListDetail 调用失败: ${e?.message}`);
      }
      return { list: [], isEnd: true };
    }

    // 优先用 getMusicSheetInfo 获取歌单曲目
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
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return { list: list.map((item: any) => toPluginSearchResult(item, source)), isEnd: extractIsEnd(result) };
        }
      } catch (e: any) {
        log(`[${source.name}] getMusicSheetInfo 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    // 回退：getMusicSheetInfo 不可用或返回空，用歌单名搜索
    if (page === 1 && typeof inst.instance.search === 'function') {
      const sheetTitle = stripHtmlTags(sheetItem?.title || sheetItem?.name || '');
      if (sheetTitle) {
        log(`[${source.name}] getMusicSheetInfo 不可用或为空，回退到搜索 "${sheetTitle}"`);
        const result = (await inst.instance.search(sheetTitle, 1, 'music')) ?? {};
        const list = extractResultList(result);
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return { list: list.map((item: any) => toPluginSearchResult(item, source)), isEnd: true };
      }
    }

    return { list: [], isEnd: true };
  } catch (e: any) {
    log(`[${source.name}] 获取歌单详情失败: ${e?.message}`);
    return { list: [], isEnd: true };
  }
}

/**
 * QQ 插件详情列表统一补时长。QQ formatMusicItem 丢弃 interval、getMusicInfo
 * 对已带 artwork+qualities 的条目早退不回填，歌单/歌手/专辑详情会整页无时长；
 * 宿主按 songid 批量查 UniformRuleCtrl 补齐（一次请求，非 QQ 插件零开销）。
 */
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

/**
 * 歌单详情（含分页结束标志）。供导入等需要全量拉取歌单的场景使用：
 * 以插件返回的 isEnd 判断是否还有下一页，避免按返回数量猜页大小导致提前截断丢歌。
 */
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
    return imported.map((item: any) => toPluginSearchResult(item, source));
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
    // B站：空间作品接口被风控时返回空，走专用路径（单次尝试 + 搜索兜底），避免 6 次无效重试导致歌手页长时间转圈
    if (isBilibiliSource(source)) {
      return BakaPluginManager.getBilibiliArtistWorks(source, artistItem, page, 'music');
    }
    return BakaPluginManager.getArtistWorks(source, artistItem, page, 'music');
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    // 优先用 getArtistWorks 获取歌手作品
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
          return list.map((item: any) => toPluginSearchResult(item, source));
        }
      } catch (e: any) {
        log(`[${source.name}] getArtistWorks 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    // 回退：getArtistWorks 不可用或返回空，用歌手名搜索
    if (page === 1 && typeof inst.instance.search === 'function') {
      const artistName = stripHtmlTags(artistItem?.name || artistItem?.title || artistItem?.artist || '');
      if (artistName) {
        log(`[${source.name}] getArtistWorks 不可用或为空，回退到搜索 "${artistName}"`);
        const result = (await inst.instance.search(artistName, 1, 'music')) ?? {};
        const list = extractResultList(result);
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return list.map((item: any) => toPluginSearchResult(item, source));
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

    return list.map((item: any) => {
      resetMediaItem(item, source.name);
      const id = item.id || item.albumId || '';
      const name = stripHtmlTags(item.title || item.name || item.album || '');
      const artist = extractArtist(item);
      const coverUrl = extractCoverUrl(item);
      return {
        id,
        name,
        artist,
        coverUrl,
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

/**
 * 获取歌手简介：调用插件的 getArtistInfo（如未实现则返回空字符串，不影响现有功能）。
 * 歌手的 search('artist') 列表通常不带简介，简介在歌手详情接口里。
 */
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
    // B站专辑与歌单统一走专用取数路径
    if (isBilibiliSource(source)) {
      const { list } = await BakaPluginManager.getBilibiliDetail(source, albumItem, page);
      return list;
    }
    return BakaPluginManager.getAlbumSongs(source, albumItem, page);
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  // QQ 插件 getAlbumInfo 读 albumItem.albumMID（大写），而歌曲推导/兜底结果里
  // 常只有 albummid（小写）。缺失时统一补齐，否则请求 albumMid=undefined 得 104400，
  // 表现为专辑页 6 次重试约 12s 后空白。
  const albumMid = albumItem?.albumMID || albumItem?.albummid || albumItem?.albumMid;
  if (albumMid && !albumItem?.albumMID) {
    albumItem = { ...albumItem, albumMID: albumMid };
  }

  try {
    // 优先用 getAlbumInfo 获取专辑曲目
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
          return list.map((item: any) => toPluginSearchResult(item, source));
        }
      } catch (e: any) {
        log(`[${source.name}] getAlbumInfo 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    // QQ 插件兜底：getAlbumInfo 的无签名端点也可能被风控返回空。宿主用签名
    // AlbumSongList 接口按 albumMid 代取曲目，映射回插件歌曲结构，播放不受影响。
    if (isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
      const albumMidForHost = albumItem?.albumMID || albumItem?.albummid || albumItem?.albumMid;
      if (albumMidForHost) {
        log(`[pluginGetAlbumSongs] ${source.name} getAlbumInfo 为空，走宿主 QQ 专辑曲目兜底: ${albumMidForHost}`);
        const hostSongs = await qqHostAlbumSongsFallback(source, albumMidForHost, page);
        if (hostSongs.length > 0) return hostSongs;
      }
    }

    // 回退：getAlbumInfo 不可用或返回空，用专辑名搜索并按专辑名过滤
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
        return songs.map((item: any) => toPluginSearchResult(item, source));
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

/**
 * 获取插件声明的支持音质列表。
 *
 * 委托给 BakaPluginManager，Baka 插件使用 12 档新键值（如 '320k'、'flac'、'master'）。
 * 原版 MusicFree 插件无此字段，仅支持 standard/high/lossless 三档，
 * 返回对应的 3 档代表音质（128k / 320k / flac），由 qualityKeyToMfQuality 完成实际映射。
 *
 * 返回的键值已映射为本项目的 QualityKey（'96k' → 'mgg'）。
 */
export async function pluginGetSupportedQualities(source: PluginSource): Promise<QualityKey[] | null> {
  const inst = await ensurePluginInstance(source);
  if (await BakaPluginManager.isBakaPlugin(source)) {
    return BakaPluginManager.getSupportedQualities(source);
  }

  // [MF 原生音质键适配] 新式 MF 插件（时迁酱等）在 supportedQualities 中
  // 声明原生档位键（含 flac24bit/hires），直接作为 UI 展示与回退上界。
  const declared = inst?.instance.supportedQualities;
  if (Array.isArray(declared)) {
    const keys = declared
      .map((q: unknown) => normalizeQualityKey(q))
      .filter((q): q is QualityKey => q !== null);
    if (keys.length > 0) return keys;
  }

  // 原版 MusicFree 插件没有 Baka 的 12 档 supportedQualities，
  // 只暴露 standard/high/lossless 三档，这里返回对应的代表音质用于 UI 与回退逻辑。
  return ['128k', '320k', 'flac'];
}