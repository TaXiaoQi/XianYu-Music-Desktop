import type {
  PluginSource,
  PluginSearchResult,
  PluginPlaylistSearchResult,
} from '../../types';
import {
  extractArtist,
  extractArtistAvatarUrl,
  extractCoverUrl,
  extractCoverUrls,
  extractResultList,
  resetMediaItem,
  stripHtmlTags,
  toPluginSearchResults,
} from './pluginResultMappers';
import {
  isQqMusicPluginSource,
  qqHostAlbumSearchFallback,
  qqHostSearchFallback,
} from './qqHostSearchFallback';
import { dispatchFallbackModule } from '../fallbackModules/registry';
import { log, pluginInstanceErrors } from './pluginEngineBase';
import { ensurePluginInstance } from './pluginEngineInstance';
import {
  retryOnEmpty,
  extractArtistDescription,
  catalogLog,
} from './pluginCatalogShared';
import type {
  PluginMusicSearchDiagnostics,
  PluginAlbumResult,
  PluginArtistResult,
} from './pluginCatalogShared';
import type { PlaylistImportResult } from './playlistImportBase';
import { getListDetailKg } from './playlistImportKg';
import { getListDetailWy } from './playlistImportWy';
import { getListDetailTx } from './playlistImportTx';
import { getListDetailKw } from './playlistImportKw';
import {
  getListDetailQishui,
  isQishuiKeyword,
  isQishuiSource,
} from './playlistImportQishui';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ==================== 音乐搜索 ====================

export async function pluginMusicSearchWithDiagnostics(
  source: PluginSource,
  keyword: string,
  page: number,
  _limit: number,
  requireLyricSupport = false,
): Promise<PluginMusicSearchDiagnostics> {
  log(`[pluginSearch] 开始: ${source.name}, keyword="${keyword}", page=${page}`);
  const inst = await ensurePluginInstance(source);
  if (!inst) {
    log(`[pluginSearch] 实例为 null: ${source.name}`);
    return {
      results: [],
      status: 'init_failed',
      reason: pluginInstanceErrors.get(source.id) || '插件实例初始化失败，请检查插件文件、订阅地址或插件日志',
      supportsLyrics: false,
    };
  }
  log(`[pluginSearch] 实例就绪: ${source.name}, search=${typeof inst.instance.search}`);

  if (typeof inst.instance.search !== 'function') {
    log(`[${source.name}] 无 search 函数`);
    return {
      results: [],
      status: 'search_unsupported',
      reason: '插件未实现歌曲搜索方法 search，无法按搜索内容查找歌词',
      supportsLyrics: typeof inst.instance.getLyric === 'function',
    };
  }
  const pluginSearchMethod = inst.instance.search;

  if (requireLyricSupport && typeof inst.instance.getLyric !== 'function') {
    log(`[${source.name}] 无 getLyric 函数（歌词替换场景需要）`);
    return {
      results: [],
      status: 'lyrics_unsupported',
      reason: '插件可以提供音乐资源，但未实现独立歌词方法 getLyric，不能用于更改歌词',
      supportsLyrics: false,
    };
  }

  try {
    const searchType = 'music';

    const callSearch = async (attempt: number) => {
      log(`[pluginSearch] ${source.name} searchType=${searchType}, 第 ${attempt} 次调用 search()`);
      const result = (await pluginSearchMethod(keyword, page, searchType)) ?? {};
      const list = extractResultList(result);
      log(
        `[pluginSearch] ${source.name} search 返回(第 ${attempt} 次): type=${typeof result}, keys=${result ? Object.keys(result).join(',') : 'null'}, dataIsArray=${Array.isArray(result?.data)}, dataLen=${result?.data?.length ?? 0}, extractedLen=${list.length}`,
      );
      return { result, list };
    };

    let { result, list } = await callSearch(1);

    if (list.length === 0 && await isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
      log(`[pluginSearch] ${source.name} 插件搜索为空，走宿主 QQ 兜底链: "${keyword}"`);
      const hostResults = await qqHostSearchFallback(source, keyword, page);
      if (hostResults.length > 0) {
        log(`[pluginSearch] ${source.name} 宿主兜底成功: ${hostResults.length} 首`);
        return {
          results: hostResults,
          status: 'success',
          reason: `插件搜索被风控，宿主兜底解析返回 ${hostResults.length} 首歌曲`,
          searchType,
          supportsLyrics: typeof inst.instance.getLyric === 'function',
        };
      }
      return {
        results: [],
        status: 'empty',
        reason: `插件搜索与宿主兜底均未找到与“${keyword}”匹配的歌曲`,
        searchType,
        supportsLyrics: true,
      };
    }

    if (list.length === 0) {
      const attempts = 6;
      let attempt = 2;
      while (list.length === 0 && attempt <= attempts) {
        const wait = 800 * (attempt - 1);
        log(`[pluginSearch] ${source.name} 第 ${attempt - 1} 次返回空列表，${wait}ms 后重试(共 ${attempts} 次)`);
        await sleep(wait);
        ({ result, list } = await callSearch(attempt));
        attempt++;
      }
    }

    if (list.length > 0) {
      list.forEach((_: any) => {
        resetMediaItem(_, source.name);
      });

      const results = await toPluginSearchResults(list, source);
      return {
        results,
        status: results.length > 0 ? 'success' : 'empty',
        reason: results.length > 0
          ? `插件返回 ${results.length} 首歌曲，可逐项获取歌词`
          : `插件搜索成功，但没有找到与“${keyword}”匹配的歌曲`,
        searchType,
        supportsLyrics: typeof inst.instance.getLyric === 'function',
      };
    }
    return {
      results: [],
      status: Array.isArray(result?.data) ? 'empty' : 'invalid_response',
      reason: Array.isArray(result?.data)
        ? `插件多次搜索（最多 6 次）均未找到与“${keyword}”匹配的歌曲`
        : `插件 search 返回格式无效或为空：实际字段为 ${result ? Object.keys(result).join(', ') || '空对象' : 'null'}`,
      searchType,
      supportsLyrics: true,
    };
  } catch (e: any) {
    const errMsg = e?.message || (typeof e === 'string' ? e : '') || 'Unknown error';
    log(`[${source.name}] 搜索失败: ${errMsg}`);
    return {
      results: [],
      status: 'search_failed',
      reason: `插件搜索调用失败：${errMsg}`,
      supportsLyrics: true,
    };
  }
}

export async function pluginSearch(
  source: PluginSource,
  keyword: string,
  page: number,
  limit: number,
): Promise<PluginSearchResult[]> {
  return (await pluginMusicSearchWithDiagnostics(source, keyword, page, limit)).results;
}

// ==================== 插件歌单搜索 ====================

// 判断输入是否像歌单分享链接或纯数字歌单 ID。
// 自己的歌单只能靠链接/ID 精确导入，公开搜索搜不到。
export function looksLikeSheetLinkOrId(keyword: string): boolean {
  const t = (keyword || '').trim().toLowerCase();
  if (!t) return false;
  if (/^\d{6,}$/.test(t)) return true;
  return /https?:\/\/|\.com|\.cn|\.cc|netease|kugou|kuwo|qishui|douyin|qq\.com/.test(t);
}

// ==================== 宿主歌单导入兜底（酷狗→汽水→网易→QQ→酷我） ====================

type HostPlatform = 'kg' | 'qishui' | 'wy' | 'tx' | 'kw';

function isHostPlatformKeyword(platform: HostPlatform, keyword: string): boolean {
  const t = (keyword || '').trim().toLowerCase();
  switch (platform) {
    case 'kg':
      return t.includes('kugou.com') || t.includes('gcid_') || t.includes('global_collection_id');
    case 'qishui':
      return isQishuiKeyword(keyword);
    case 'wy':
      return t.includes('music.163.com') || t.includes('y.music.163.com') || t.includes('163cn.tv');
    case 'tx':
      return t.includes('y.qq.com');
    case 'kw':
      return t.includes('kuwo.cn');
  }
}

export function sourceMatchesHostPlatform(source: PluginSource, platform: HostPlatform): boolean {
  const name = (source.name || '').toLowerCase();
  const srcs = (source.sources || []).map(s => (s || '').trim().toLowerCase());
  const has = (v: string) => srcs.some(s => s.includes(v));
  switch (platform) {
    case 'kg':
      return name.includes('酷狗') || name.includes('kugou') || has('kg') || has('kugou') || has('酷狗');
    case 'qishui':
      return isQishuiSource(source.name, source.sources || []);
    case 'wy':
      return name.includes('网易') || name.includes('netease') || has('wy') || has('netease') || has('网易');
    case 'tx':
      return name.includes('qq') || name.includes('企鹅') || name.includes('腾讯') || has('tx') || has('qq');
    case 'kw':
      return name.includes('酷我') || name.includes('kuwo') || has('kw') || has('kuwo') || has('酷我');
  }
}

function hostSheetFallbackResult(
  source: PluginSource,
  keyword: string,
  result: PlaylistImportResult,
): PluginPlaylistSearchResult | null {
  if (!result.songs.length) return null;
  const title = result.info.name || `${source.name}收藏夹`;
  return {
    id: keyword,
    title,
    coverUrl: result.info.img || result.songs[0]?.coverUrl || '',
    trackCount: result.songs.length,
    artist: result.info.author || '',
    platform: source.name,
    platformId: keyword,
    pluginId: source.id,
    // _hostFallback 标记宿主兜底导入的歌：入库走 plugin:// 插件链而非
    // lx:// 直连（插件取链接可能走付费代理，lx 直连公开接口拿不到地址）。
    // 富字段（title/artist/album/coverUrl/duration）必须一并保留——消费端
    // _importedTracks 会经 toPluginSearchResult 回转，只留 rawData 会让
    // 专辑/封面全部丢失（导入歌单显示「未知专辑」且无封面）
    rawData: {
      id: keyword,
      title,
      _importedTracks: result.songs.map(s => ({
        ...(s.rawData as Record<string, any>),
        _hostFallback: true,
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        coverUrl: s.coverUrl,
        duration: s.duration,
      })),
    },
  };
}

/// 插件 importMusicSheet 失败/返回空后的宿主兜底链：
/// 链接特征直接尝试；纯数字 ID 仅在对应来源插件下尝试。
async function hostSheetFallback(
  source: PluginSource,
  keyword: string,
): Promise<PluginPlaylistSearchResult | null> {
  const runners: [HostPlatform, () => Promise<PlaylistImportResult>][] = [
    ['kg', () => dispatchFallbackModule('playlist_import', 'getListDetailKg', { rawId: keyword }, () => getListDetailKg(keyword))],
    ['qishui', () => dispatchFallbackModule('playlist_import', 'getListDetailQishui', { rawId: keyword }, () => getListDetailQishui(keyword))],
    ['wy', () => dispatchFallbackModule('playlist_import', 'getListDetailWy', { rawId: keyword }, () => getListDetailWy(keyword))],
    ['tx', () => dispatchFallbackModule('playlist_import', 'getListDetailTx', { rawId: keyword }, () => getListDetailTx(keyword))],
    ['kw', () => dispatchFallbackModule('playlist_import', 'getListDetailKw', { rawId: keyword }, () => getListDetailKw(keyword))],
  ];
  for (const [platform, run] of runners) {
    const applicable = isHostPlatformKeyword(platform, keyword) ||
      (looksLikeSheetLinkOrId(keyword) && sourceMatchesHostPlatform(source, platform));
    if (!applicable) continue;
    try {
      const result = await run();
      const wrapped = hostSheetFallbackResult(source, keyword, result);
      if (wrapped) return wrapped;
    } catch (e: any) {
      log(`[${source.name}] 宿主 ${platform} 歌单兜底失败: ${e?.message || e}`);
    }
  }
  return null;
}

export async function pluginPlaylistSearch(
  source: PluginSource,
  keyword: string,
  page: number,
): Promise<PluginPlaylistSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.search !== 'function') return [];

    // 链接/歌单 ID 优先走 importMusicSheet 精确导入：公开搜索会把链接当
    // 关键词，搜出来的全是别人的同名歌单。
    const linkLike = looksLikeSheetLinkOrId(keyword);
    // am 插件（animemusic/1）歌单导入：importPlaylist 返回歌单元数据+曲目，
    // 优先走它拿到真实歌单名/封面/创建者
    if (linkLike && typeof inst.instance.importPlaylist === 'function') {
      try {
        const imp = await inst.instance.importPlaylist(keyword);
        if (imp && Array.isArray(imp.list) && imp.list.length > 0) {
          const title = imp.title || `${source.name}歌单`;
          return [{
            id: keyword,
            title,
            coverUrl: imp.cover || '',
            trackCount: Number(imp.total) || imp.list.length,
            artist: imp.creator || '',
            platform: source.name,
            platformId: keyword,
            pluginId: source.id,
            rawData: { id: keyword, title, _importedTracks: imp.list },
          }];
        }
      } catch (e: any) {
        console.warn(`[${source.name}] importPlaylist 精确导入失败:`, e?.message || e);
      }
    }
    if (linkLike && typeof inst.instance.importMusicSheet === 'function') {
      try {
        const direct = await inst.instance.importMusicSheet(keyword);
        if (Array.isArray(direct) && direct.length > 0) {
          const title = `${source.name}收藏夹`;
          return [{
            id: keyword,
            title,
            coverUrl: await extractCoverUrl(direct[0]),
            trackCount: direct.length,
            artist: '',
            platform: source.name,
            platformId: keyword,
            pluginId: source.id,
            rawData: { id: keyword, title, _importedTracks: direct },
          }];
        }
      } catch (e: any) {
        console.warn(`[${source.name}] importMusicSheet 精确导入失败:`, e?.message || e);
      }
    }
    if (linkLike) {
      // 插件对部分平台歌单解析失败或返回空：宿主兜底
      // （酷狗/汽水/网易云/QQ/酷我，LX 系插件无 importMusicSheet）
      const hostResult = await hostSheetFallback(source, keyword);
      if (hostResult) return [hostResult];
    }

    let result = (await inst.instance.search(keyword, page, 'sheet')) ?? {};
    let list = extractResultList(result);
    if (list.length === 0) {
      result = (await inst.instance.search(keyword, page, 'playlist')) ?? {};
      list = extractResultList(result);
    }
    if (list.length === 0) {
      result = (await inst.instance.search(keyword, page, 'album')) ?? {};
      list = extractResultList(result);
      if (list.length > 0) {
        const covers = await extractCoverUrls(list);
        return list.map((item: any, i: number) => {
          resetMediaItem(item, source.name);
          const id = item.id || item.albumId || item.songId || item.musicId || '';
          const title = stripHtmlTags(item.title || item.name || item.album || '');
          return {
            id,
            title,
            coverUrl: covers[i],
            playCount: item.playCount ?? item.playcount ?? item.play_count,
            trackCount: item.trackCount ?? item.trackcount ?? item.track_count,
            artist: stripHtmlTags(item.artist || item.author || item.singer || ''),
            platform: item.platform || source.name,
            platformId: id,
            pluginId: source.id,
            rawData: { ...item, _isAlbum: true },
          };
        });
      }
    }
    if (list.length === 0 && !linkLike) {
      if (typeof inst.instance.importMusicSheet === 'function') {
        try {
          const imported = await inst.instance.importMusicSheet(keyword);
          if (Array.isArray(imported) && imported.length > 0) {
            const title = `${source.name}收藏夹`;
            return [{
              id: keyword,
              title,
              coverUrl: await extractCoverUrl(imported[0]),
              trackCount: imported.length,
              artist: '',
              platform: source.name,
              platformId: keyword,
              pluginId: source.id,
              rawData: { id: keyword, title, _importedTracks: imported },
            }];
          }
        } catch (e: any) {
          console.warn(`[${source.name}] importMusicSheet 回退失败:`, e?.message || e);
        }
      }


      console.warn(
        `[${source.name}] 歌单搜索无结果: search(sheet/playlist) 返回 keys=`,
        result ? Object.keys(result) : result,
        '; 插件可能未实现歌单搜索或上游接口变更',
      );
      return [];
    }

    const covers = await extractCoverUrls(list);
    return list.map((item: any, i: number) => {
      resetMediaItem(item, source.name);
      const id = item.id || item.songId || item.musicId || '';
      const title = stripHtmlTags(item.title || item.name || '');
      return {
        id,
        title,
        coverUrl: covers[i],
        playCount: item.playCount ?? item.playcount ?? item.play_count,
        trackCount: item.trackCount ?? item.trackcount ?? item.track_count,
        artist: stripHtmlTags(item.artist || item.author || ''),
        platform: item.platform || source.name,
        platformId: id,
        pluginId: source.id,
        rawData: item,
      };
    });
  } catch (e: any) {
    console.warn(`[${source.name}] 歌单搜索失败:`, e?.message || e);
    log(`[${source.name}] 歌单搜索失败: ${e?.message}`);
    return [];
  }
}

// ==================== 歌手搜索 ====================

export async function pluginArtistSearch(
  source: PluginSource,
  keyword: string,
  page: number,
): Promise<PluginArtistResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.search !== 'function') return [];
    const doSearch = inst.instance.search;

    const artistLabel = `[${source.name}] artistSearch w="${keyword}" p=${page}`;
    let result: any;
    try {
      result = await retryOnEmpty(
        artistLabel,
        () => doSearch(keyword, page, 'artist'),
        (r) => {
          const list = extractResultList(r);
          if (list.length === 0) return true;
          return list.every(
            (it: any) => !it?.name && !it?.title && !it?.artist && !it?.singername && !it?.singer,
          );
        },
        (i) => 800 * i,
        6,
      );
    } catch (e: any) {
      catalogLog(`${artistLabel} 多次尝试后仍为空/异常，放弃本次 artist 结果: ${e?.message || e}`);
      return [];
    }
    const list = extractResultList(result ?? {});
    if (list.length === 0) return [];
    const valid = (
      await Promise.all(
        list.map(async (item: any) => {
          resetMediaItem(item, source.name);
          const id = item.id || item.artistId || item.singerId || item.sid || '';
          const name = stripHtmlTags(item.name || item.title || item.artist || item.singername || item.singer || '');
          if (!name) return null;
          const avatarUrl = await extractArtistAvatarUrl(item);
          return {
            id,
            name,
            avatarUrl,
            description: extractArtistDescription(item),
            songCount: item.songCount || item.musicCount || undefined,
            albumCount: item.albumCount || undefined,
            platform: item.platform || source.name,
            platformId: id,
            pluginId: source.id,
            rawData: item,
          } as PluginArtistResult;
        }),
      )
    ).filter(Boolean) as PluginArtistResult[];
    if (valid.length === 0) {
      catalogLog(`${artistLabel} 提取出 ${list.length} 条但无有效 artist 字段`);
      return [];
    }
    return valid;
  } catch (e: any) {
    log(`[pluginArtistSearch] ${source.name} 失败: ${e?.message || e}`);
    return [];
  }
}

// ==================== 专辑搜索 ====================

export async function pluginAlbumSearch(
  source: PluginSource,
  keyword: string,
  page: number,
): Promise<PluginAlbumResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.search !== 'function') return [];

    const result = (await inst.instance.search(keyword, page, 'album')) ?? {};
    const list = extractResultList(result);
    if (list.length > 0) {
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
          description: item.description || item.desc || '',
          year: item.year || item.publishTime || undefined,
          songCount: item.songCount || item.musicCount || undefined,
          platform: item.platform || source.name,
          platformId: id,
          pluginId: source.id,
          rawData: item,
        };
      });
    }

    if (list.length === 0 && page === 1 && await isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
      log(`[pluginAlbumSearch] ${source.name} 插件专辑搜索为空，走宿主 QQ 专辑兜底: "${keyword}"`);
      const hostAlbums = await qqHostAlbumSearchFallback(source, keyword, page);
      if (hostAlbums.length > 0) {
        log(`[pluginAlbumSearch] ${source.name} 宿主专辑兜底成功: ${hostAlbums.length} 张`);
        return hostAlbums;
      }
    }

    if (page === 1) {
      log(`[pluginAlbumSearch] ${source.name} 直接专辑搜索为空，回退到音乐搜索提取专辑`);
      const songResults = await pluginSearch(source, keyword, 1, 30);
      if (songResults.length === 0) return [];

      const albumMap = new Map<string, PluginAlbumResult>();
      for (const song of songResults) {
        const albumName = song.album || '';
        if (!albumName) continue;
        const key = albumName.toLowerCase();
        const existing = albumMap.get(key);
        if (existing) {
          if (!existing.coverUrl && song.coverUrl) existing.coverUrl = song.coverUrl;
          existing.songCount = (existing.songCount ?? 0) + 1;
          continue;
        }
        const rawAlbumId = song.rawData?.albumId || song.rawData?.albumid || song.rawData?.al?.id;
        const rawAlbumMid = song.rawData?.albumMID || song.rawData?.albummid || song.rawData?.albumMid;
        albumMap.set(key, {
          id: String(rawAlbumId || albumName),
          name: albumName,
          artist: song.artist || '',
          coverUrl: song.coverUrl || '',
          platform: song.platform || source.name,
          platformId: String(rawAlbumId || albumName),
          pluginId: source.id,
          rawData: { albumName, artist: song.artist, albumId: rawAlbumId, albummid: rawAlbumMid, albumMID: rawAlbumMid },
        });
      }
      return [...albumMap.values()];
    }

    return [];
  } catch (e: any) {
    log(`[pluginAlbumSearch] ${source.name} 失败: ${e?.message || e}`);
    return [];
  }
}

// ==================== 其它 ====================

export function pluginSupportsSearchType(_source: PluginSource, _type: 'music' | 'sheet' | 'artist' | 'album'): boolean {
  return true;
}