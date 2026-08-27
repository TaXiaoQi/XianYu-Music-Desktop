/**
 * 插件引擎 · 目录搜索（音乐/歌单/歌手/专辑）。
 *
 * 关键字 → 列表：音乐、歌单、歌手、专辑四类搜索，含落雪式增量退避、QQ 宿主
 * 兜底链（风控说明）、歌手专辑从音乐搜索结果去重提取。仅依赖共享工具叶子
 * pluginCatalogShared 与 pluginResultMappers / qqHostSearchFallback。
 */
import type {
  PluginSource,
  PluginSearchResult,
  PluginPlaylistSearchResult,
} from '../../types';
import {
  extractArtist,
  extractArtistAvatarUrl,
  extractCoverUrl,
  extractResultList,
  resetMediaItem,
  stripHtmlTags,
  toPluginSearchResult,
} from './pluginResultMappers';
import {
  isQqMusicPluginSource,
  qqHostAlbumSearchFallback,
  qqHostSearchFallback,
} from './qqHostSearchFallback';
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ==================== 音乐搜索 ====================

/** 音乐搜索诊断版：保留初始化、能力和接口错误，供歌词选择页直接展示原因。 */
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

  // 仅在歌词替换场景下要求 getLyric；普通搜索（如 bilibili 插件）不要求歌词支持
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
    // 音乐搜索始终使用 'music' 类型；Baka 插件可能未在 supportedSearchType 中声明 'music'
    // 但实际支持音乐搜索。若插件确实不支持则会返回空，由调用方处理。
    const searchType = 'music';

    const callSearch = async (attempt: number) => {
      log(`[pluginSearch] ${source.name} searchType=${searchType}, 第 ${attempt} 次调用 search()`);
      // 与 MusicFree PluginMethodsWrapper.search() 第175~176行一致
      const result = (await pluginSearchMethod(keyword, page, searchType)) ?? {};
      const list = extractResultList(result);
      log(
        `[pluginSearch] ${source.name} search 返回(第 ${attempt} 次): type=${typeof result}, keys=${result ? Object.keys(result).join(',') : 'null'}, dataIsArray=${Array.isArray(result?.data)}, dataLen=${result?.data?.length ?? 0}, extractedLen=${list.length}`,
      );
      return { result, list };
    };

    let { result, list } = await callSearch(1);

    // QQ 音乐插件搜索兜底：无签名搜索端点已被腾讯累积风控（reqCode 2001 恒空列表），
    // 插件返回空不代表真无结果。短间隔重试对累积风控无效，QQ 插件直接跳过重试，
    // 改由宿主复用 LX 侧已验证的搜索链（签名 Mobile → Web 兜底）代取结果；
    // 播放仍走插件自身 getMediaSource，不受影响。
    if (list.length === 0 && isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
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

    // 部分 MusicFree QQ 插件的上游接口会偶发正常响应但 data=[]。
    // 参考落雪(lx) 的增量退避：不做短固定间隔的快速放弃，逐步拉长间隔反复重试，共 6 次约 12s
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
      // 关键：每个 item 都调用 resetMediaItem，与 MusicFree 完全一致
      list.forEach((_: any) => {
        resetMediaItem(_, source.name);
      });

      // 将 resetMediaItem 后的对象转为 PluginSearchResult
      const results = list.map((item: any) => toPluginSearchResult(item, source));
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
    // [修复防御]: 完整序列化错误信息，方便调试
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

export async function pluginPlaylistSearch(
  source: PluginSource,
  keyword: string,
  page: number,
): Promise<PluginPlaylistSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.search !== 'function') return [];

    // 尝试 'sheet' 类型；部分插件使用 'playlist' 类型
    let result = (await inst.instance.search(keyword, page, 'sheet')) ?? {};
    let list = extractResultList(result);
    if (list.length === 0) {
      result = (await inst.instance.search(keyword, page, 'playlist')) ?? {};
      list = extractResultList(result);
    }
    // 回退 0: 尝试 'album' 类型，将专辑也索引到歌单页
    if (list.length === 0) {
      result = (await inst.instance.search(keyword, page, 'album')) ?? {};
      list = extractResultList(result);
      if (list.length > 0) {
        return list.map((item: any) => {
          resetMediaItem(item, source.name);
          const id = item.id || item.albumId || item.songId || item.musicId || '';
          const title = stripHtmlTags(item.title || item.name || item.album || '');
          const coverUrl = extractCoverUrl(item);
          return {
            id,
            title,
            coverUrl,
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
    if (list.length === 0) {
      // 回退 1: 尝试 importMusicSheet（用户输入收藏夹 URL/ID 时）
      if (typeof inst.instance.importMusicSheet === 'function') {
        try {
          const imported = await inst.instance.importMusicSheet(keyword);
          if (Array.isArray(imported) && imported.length > 0) {
            const title = `${source.name}收藏夹`;
            return [{
              id: keyword,
              title,
              coverUrl: extractCoverUrl(imported[0]),
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

      // 注意：不再回退 getTopLists——关键词与榜单无关，把榜单塞进歌单搜索结果
      // 会让搜索页歌单 tab 偶现排行榜内容（榜单有专门的榜单页入口）。

      console.warn(
        `[${source.name}] 歌单搜索无结果: search(sheet/playlist) 返回 keys=`,
        result ? Object.keys(result) : result,
        '; 插件可能未实现歌单搜索或上游接口变更',
      );
      return [];
    }

    return list.map((item: any) => {
      resetMediaItem(item, source.name);
      const id = item.id || item.songId || item.musicId || '';
      const title = stripHtmlTags(item.title || item.name || '');
      const coverUrl = extractCoverUrl(item);
      return {
        id,
        title,
        coverUrl,
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
    // 同一 artistSearch 路径可间歇性成功（风控/节流），因此多尝试几次成功路径本身，
    // 而不是退化到"从音乐搜索结果拼歌手"（后者拿不到完整 artist 元数据，多为假数据）。
    let result: any;
    try {
      result = await retryOnEmpty(
        artistLabel,
        () => doSearch(keyword, page, 'artist'),
        (r) => {
          const list = extractResultList(r);
          if (list.length === 0) return true;
          // 列表非空但没有任何有效 artist 字段 → 视为无效（疑似把歌曲当 artist 返回），重试
          return list.every(
            (it: any) => !it?.name && !it?.title && !it?.artist && !it?.singername && !it?.singer,
          );
        },
        // 参考落雪(lx) 的增量退避：800/1600/2400/...ms，累积约 12s 才放弃，加载转圈持续更久
        (i) => 800 * i,
        6,
      );
    } catch (e: any) {
      catalogLog(`${artistLabel} 多次尝试后仍为空/异常，放弃本次 artist 结果: ${e?.message || e}`);
      return [];
    }
    const list = extractResultList(result ?? {});
    if (list.length === 0) return [];
    const valid = list
      .map((item: any) => {
        resetMediaItem(item, source.name);
        const id = item.id || item.artistId || item.singerId || item.sid || '';
        const name = stripHtmlTags(item.name || item.title || item.artist || item.singername || item.singer || '');
        if (!name) return null;
        const avatarUrl = extractArtistAvatarUrl(item);
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
      })
      .filter(Boolean) as PluginArtistResult[];
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

    // 直接尝试搜索；Baka 插件可能未声明 album 但实际支持
    const result = (await inst.instance.search(keyword, page, 'album')) ?? {};
    const list = extractResultList(result);
    if (list.length > 0) {
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

    // QQ 插件兜底：无签名专辑搜索（search_type=2）已被间歇风控（2001），插件返回空
    // 不代表真无结果。宿主用签名 Desktop 接口代取，结果带插件原生 albumMID，
    // 后续 getAlbumInfo 解析曲目不受影响。
    if (list.length === 0 && page === 1 && isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
      log(`[pluginAlbumSearch] ${source.name} 插件专辑搜索为空，走宿主 QQ 专辑兜底: "${keyword}"`);
      const hostAlbums = await qqHostAlbumSearchFallback(source, keyword, page);
      if (hostAlbums.length > 0) {
        log(`[pluginAlbumSearch] ${source.name} 宿主专辑兜底成功: ${hostAlbums.length} 张`);
        return hostAlbums;
      }
    }

    // 回退：直接专辑搜索返回空时，从音乐搜索结果中提取去重专辑
    // （Baka QQ 音乐等插件的 search('album') 可能不支持，但 search('music') 可返回带专辑信息的歌曲）
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
          // 合并：保留第一个封面，累计歌曲数
          if (!existing.coverUrl && song.coverUrl) existing.coverUrl = song.coverUrl;
          existing.songCount = (existing.songCount ?? 0) + 1;
          continue;
        }
        // 专辑标识字段名跨插件不统一：QQ 是 albummid/albumMID，网易是 al.id，
        // 统一提取并保留原字段，否则点击专辑后 getAlbumInfo 拿不到 albumMid
        // 会请求出 104400 空结果（表现为专辑页打不开）
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

/**
 * 检查插件是否支持指定搜索类型
 * 始终返回 true：实际搜索函数内部已做 supportedSearchType 检查，
 * Baka 插件可能未完整声明但实际支持 album/sheet/artist 搜索。
 */
export function pluginSupportsSearchType(_source: PluginSource, _type: 'music' | 'sheet' | 'artist' | 'album'): boolean {
  return true;
}