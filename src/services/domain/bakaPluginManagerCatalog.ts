import type {
  PluginSource,
  PluginSearchResult,
  PluginPlaylistSearchResult,
} from '../../types';
import { BakaPluginMedia } from './bakaPluginManagerMedia';
import {
  log,
  catalogLog,
  retryWithBackoff,
} from './bakaPluginManagerBase';
import {
  extractCoverUrl,
  extractArtist,
  extractArtistAvatarUrl,
  extractIsEnd,
  extractResultList,
  flattenTopListCategories,
  resetMediaItem,
  stripHtmlTags,
  toPluginSearchResult,
} from './pluginResultMappers';

export class BakaPluginCatalog extends BakaPluginMedia {
  // ==================== 搜索 ====================

  async searchMusic(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'music')) ?? {};
      const list = extractResultList(result);
      if (list.length === 0) return [];

      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return toPluginSearchResult(item, source);
      });
    } catch (e: any) {
      log(`[searchMusic] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async searchArtists(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<any[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'artist')) ?? {};
      const list = extractResultList(result);
      if (list.length === 0) return [];

      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: item.id || item.artistId || item.singerId || '',
          name: stripHtmlTags(item.name || item.title || item.artist || ''),
          avatarUrl: extractArtistAvatarUrl(item),
          description: item.description || item.desc || '',
          songCount: item.songCount || item.musicCount || undefined,
          albumCount: item.albumCount || undefined,
          platform: item.platform || source.name,
          platformId: item.id || item.artistId || item.singerId || '',
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchArtists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async searchAlbums(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<any[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'album')) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: item.id || item.albumId || '',
          name: stripHtmlTags(item.title || item.name || item.album || ''),
          artist: extractArtist(item),
          coverUrl: extractCoverUrl(item),
          description: item.description || item.desc || '',
          year: item.year || item.publishTime || undefined,
          songCount: item.songCount || item.musicCount || undefined,
          platform: item.platform || source.name,
          platformId: item.id || item.albumId || '',
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchAlbums] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async searchPlaylists(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<PluginPlaylistSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'sheet')) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: String(item.id || item.sheetId || ''),
          title: stripHtmlTags(item.title || item.name || ''),
          coverUrl: extractCoverUrl(item) || '',
          playCount: item.playCount || item.playcount || undefined,
          trackCount: item.trackCount || item.musicCount || undefined,
          artist: extractArtist(item),
          platform: item.platform || source.name,
          platformId: String(item.id || item.sheetId || ''),
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchPlaylists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 专辑/歌单/歌手详情 ====================

  async getAlbumSongs(source: PluginSource, albumItem: any, page: number = 1): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getAlbumInfo === 'function') {
        const getAlbumInfo = inst.getAlbumInfo;
        const albumLabel = `[${source.name}] getAlbumInfo album="${albumItem?.title || albumItem?.name || albumItem?.album || ''}"`;
        let list: any[] = [];
        try {
          const result = await retryWithBackoff(
            albumLabel,
            () => getAlbumInfo(albumItem, page),
            (r) => extractResultList(r).length === 0,
          );
          list = extractResultList(result);
        } catch (e: any) {
          log(`[getAlbumInfo] ${source.name} 多次尝试仍空/异常: ${e?.message || e}`);
        }
        if (list.length > 0) {
          return list.map((item: any) => {
            resetMediaItem(item, source.name);
            return toPluginSearchResult(item, source);
          });
        }
      }
      if (page === 1) {
        const albumName = albumItem.title || albumItem.name || albumItem.album || '';
        if (albumName) {
          catalogLog(`[${source.name}] getAlbumInfo 重试仍为空，回退搜索 "${albumName}"`);
          return this.searchMusic(source, albumName, 1);
        }
      }
      return [];
    } catch (e: any) {
      log(`[getAlbumSongs] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async getPlaylistDetail(source: PluginSource, sheetItem: any, page: number = 1): Promise<{ list: PluginSearchResult[]; isEnd?: boolean }> {
    const inst = await this._ensureInstance(source);
    if (!inst) return { list: [] };

    if (sheetItem?._isTopList) {
      const list = await this.getTopListDetail(source, sheetItem, page);
      return { list, isEnd: list.length === 0 };
    }

    const fetchDetail = async (): Promise<any> => {
      if (typeof inst.getMusicSheetInfo !== 'function') return {};
      return (await inst.getMusicSheetInfo(sheetItem, page)) ?? {};
    };

    const sheetLabel = `[${source.name}] getMusicSheetInfo sheet="${sheetItem?.title || sheetItem?.name || ''}"`;

    let list: any[] = [];
    let isEnd: boolean | undefined;
    try {
      const raw = await retryWithBackoff(
        sheetLabel,
        fetchDetail,
        (r) => extractResultList(r).length === 0,
      );
      list = extractResultList(raw);
      isEnd = extractIsEnd(raw);
    } catch (e: any) {
      log(`[getPlaylistDetail] ${source.name} getMusicSheetInfo 多次尝试仍空/异常: ${e?.message || e}`);
      list = [];
    }

    if (list.length > 0) {
      return {
        list: list.map((item: any) => {
          resetMediaItem(item, source.name);
          return toPluginSearchResult(item, source);
        }),
        isEnd,
      };
    }

    if (page === 1) {
      const sheetName = sheetItem.title || sheetItem.name || '';
      if (sheetName) {
        catalogLog(`${sheetLabel} 重试仍为空，回退搜索 "${sheetName}"`);
        return { list: await this.searchMusic(source, sheetName, 1), isEnd: true };
      }
    }
    return { list: [], isEnd: true };
  }

  async getBilibiliDetail(source: PluginSource, item: any, page: number = 1): Promise<{ list: PluginSearchResult[]; isEnd?: boolean }> {
    const inst = await this._ensureInstance(source);
    if (!inst) return { list: [] };

    const label = `[${source.name}] BilibiliDetail item="${item?.title || item?.name || ''}"`;

    const mapList = (list: any[]) =>
      list.map((it: any) => {
        resetMediaItem(it, source.name);
        return toPluginSearchResult(it, source);
      });

    if (typeof inst.getAlbumInfo === 'function') {
      const getAlbumInfo = inst.getAlbumInfo;
      try {
        const result = await retryWithBackoff(
          `${label} 按专辑`,
          () => getAlbumInfo(item, page),
          (r) => extractResultList(r).length === 0,
        );
        const list = extractResultList(result);
        if (list.length > 0) return { list: mapList(list), isEnd: extractIsEnd(result) };
      } catch (e: any) {
        log(`[BilibiliDetail] ${source.name} getAlbumInfo 失败: ${e?.message || e}`);
      }
    }

    if (typeof inst.getMusicSheetInfo === 'function') {
      const getMusicSheetInfo = inst.getMusicSheetInfo;
      try {
        const result = await retryWithBackoff(
          `${label} 按歌单`,
          () => getMusicSheetInfo(item, page),
          (r) => extractResultList(r).length === 0,
        );
        const list = extractResultList(result);
        if (list.length > 0) return { list: mapList(list), isEnd: extractIsEnd(result) };
      } catch (e: any) {
        log(`[BilibiliDetail] ${source.name} getMusicSheetInfo 失败: ${e?.message || e}`);
      }
    }

    if (page === 1) {
      const name = item.title || item.name || item.album || '';
      if (name) {
        catalogLog(`${label} 按专辑/歌单均空，回退搜索 "${name}"`);
        return { list: await this.searchMusic(source, name, 1), isEnd: true };
      }
    }
    return { list: [], isEnd: true };
  }

  async getBilibiliArtistWorks(
    source: PluginSource,
    artistItem: any,
    page: number = 1,
    type: 'music' | 'album' = 'music',
  ): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    if (typeof inst.getArtistWorks === 'function') {
      const getArtistWorks = inst.getArtistWorks;
      try {
        const result = await getArtistWorks(artistItem, page, type);
        const list = extractResultList(result);
        if (list.length > 0) {
          return list.map((item: any) => {
            resetMediaItem(item, source.name);
            return toPluginSearchResult(item, source);
          });
        }
        catalogLog(`[${source.name}] BilibiliArtistWorks(${type}) 空间列表为空(疑似风控)`);
      } catch (e: any) {
        log(`[BilibiliArtistWorks] ${source.name} 失败: ${e?.message || e}`);
      }
    }

    if (type === 'music') {
      const artistName = artistItem?.name || artistItem?.artist || '';
      if (artistName) {
        catalogLog(`[${source.name}] BilibiliArtistWorks 回退搜索 "${artistName}"`);
        return this.searchMusic(source, artistName, page);
      }
    }
    return [];
  }

  async getArtistWorks(source: PluginSource, artistItem: any, page: number = 1, type: string = 'music'): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getArtistWorks === 'function') {
        const getArtistWorks = inst.getArtistWorks;
        const worksLabel = `[${source.name}] getArtistWorks(${type}) artist="${artistItem?.name || artistItem?.artist || ''}"`;
        let list: any[] = [];
        try {
          const result = await retryWithBackoff(
            worksLabel,
            () => getArtistWorks(artistItem, page, type),
            (r) => extractResultList(r).length === 0,
          );
          list = extractResultList(result);
        } catch (e: any) {
          log(`[getArtistWorks] ${source.name} 多次尝试仍空/异常: ${e?.message || e}`);
        }
        if (list.length > 0) {
          return list.map((item: any) => {
            resetMediaItem(item, source.name);
            return toPluginSearchResult(item, source);
          });
        }
      }
      if (page === 1) {
        const artistName = artistItem.name || artistItem.artist || '';
        if (artistName) {
          catalogLog(`[${source.name}] getArtistWorks 重试仍为空，回退搜索 "${artistName}"`);
          return this.searchMusic(source, artistName, 1);
        }
      }
      return [];
    } catch (e: any) {
      log(`[getArtistWorks] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async getArtistInfo(source: PluginSource, artistItem: any): Promise<any | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getArtistInfo !== 'function') return null;
      return (await inst.getArtistInfo(artistItem)?.catch(() => null)) || null;
    } catch {
      return null;
    }
  }

  // ==================== 榜单 ====================

  async getTopLists(source: PluginSource): Promise<PluginPlaylistSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getTopLists !== 'function') return [];
      const result = (await inst.getTopLists()) ?? [];
      const topLists = Array.isArray(result) ? result : (result?.data || []);
      return flattenTopListCategories(topLists, source);
    } catch (e: any) {
      log(`[getTopLists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async getTopListDetail(source: PluginSource, topListItem: any, page: number = 1): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getTopListDetail !== 'function') return [];
      const result = (await inst.getTopListDetail(topListItem, page)) ?? {};
      const list = extractResultList(result);
      if (list.length > 0) {
        return list.map((item: any) => {
          resetMediaItem(item, source.name);
          return toPluginSearchResult(item, source);
        });
      }
      return [];
    } catch (e: any) {
      log(`[getTopListDetail] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 推荐歌单 ====================

  async getRecommendSheetTags(source: PluginSource): Promise<any | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getRecommendSheetTags !== 'function') return null;
      return (await inst.getRecommendSheetTags()?.catch(() => null)) || null;
    } catch {
      return null;
    }
  }

  async getRecommendSheetsByTag(source: PluginSource, tag: any, page: number = 1): Promise<PluginPlaylistSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getRecommendSheetsByTag !== 'function') return [];
      const result = (await inst.getRecommendSheetsByTag(tag, page)) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: String(item.id || item.sheetId || ''),
          title: stripHtmlTags(item.title || item.name || ''),
          coverUrl: extractCoverUrl(item) || '',
          playCount: item.playCount || undefined,
          trackCount: item.trackCount || undefined,
          platform: item.platform || source.name,
          platformId: String(item.id || item.sheetId || ''),
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[getRecommendSheetsByTag] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 导入 ====================

  async importMusicSheet(source: PluginSource, urlLike: string): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.importMusicSheet !== 'function') return [];
      const result = (await inst.importMusicSheet(urlLike)) ?? [];
      const list = Array.isArray(result) ? result : (result?.data || []);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return toPluginSearchResult(item, source);
      });
    } catch (e: any) {
      log(`[importMusicSheet] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async importMusicItem(source: PluginSource, urlLike: string): Promise<PluginSearchResult | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.importMusicItem !== 'function') return null;
      const result = (await inst.importMusicItem(urlLike)) ?? null;
      if (!result) return null;
      resetMediaItem(result, source.name);
      return toPluginSearchResult(result, source);
    } catch (e: any) {
      log(`[importMusicItem] ${source.name} 失败: ${e?.message || e}`);
      return null;
    }
  }
}