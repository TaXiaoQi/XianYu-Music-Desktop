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
    if (isBilibiliSource(source)) {
      return BakaPluginManager.getBilibiliDetail(source, sheetItem, page);
    }
    return BakaPluginManager.getPlaylistDetail(source, sheetItem, page);
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return { list: [] };

  try {
    if (Array.isArray(sheetItem?._importedTracks) && sheetItem._importedTracks.length > 0) {
      if (page === 1) {
        const list = sheetItem._importedTracks;
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return { list: list.map((item: any) => toPluginSearchResult(item, source)), isEnd: true };
      }
      return { list: [], isEnd: true };
    }

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
          return list.map((item: any) => toPluginSearchResult(item, source));
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
          return list.map((item: any) => toPluginSearchResult(item, source));
        }
      } catch (e: any) {
        log(`[${source.name}] getAlbumInfo 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    if (isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
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