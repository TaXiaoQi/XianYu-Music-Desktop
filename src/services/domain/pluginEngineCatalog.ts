/**
 * 插件引擎 · 目录/搜索操作。
 *
 * 音乐/歌单/歌手/专辑搜索、榜单、歌单详情、收藏夹导入、歌手作品/专辑、
 * 歌手简介、专辑歌曲等「目录类」插件调用。仅依赖 pluginEngineBase /
 * pluginEngineInstance 与外部工具模块，作为叶子被 pluginEngine 门面消费。
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
  extractArtistAvatarUrl,
  resetMediaItem,
  stripHtmlTags,
  toPluginSearchResult,
  flattenTopListCategories,
} from './pluginResultMappers';
import {
  isQqMusicPluginSource,
  qqFillSongDurations,
  qqHostAlbumSearchFallback,
  qqHostAlbumSongsFallback,
  qqHostSearchFallback,
} from './qqHostSearchFallback';
import { BakaPluginManager } from './bakaPluginManager';
import { isBilibiliSource, log, pluginInstanceErrors } from './pluginEngineBase';
import { ensurePluginInstance } from './pluginEngineInstance';

// ==================== 通用搜索工具（落雪式增量退避） ====================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MF_EMPTY_SEARCH_RETRY_DELAY_MS = 450;

/** 目录加载日志（供日志系统记录，便于排查歌单/歌手/专辑间歇加载问题） */
const catalogLog = (msg: string) => {
  log(msg);
};

/** 汇总一次插件返回的结构，便于日志中人工判断返回了什么 */
const describeResult = (r: any): string => {
  if (!r || typeof r !== 'object') return `type=${typeof r}`;
  const keys = Object.keys(r).filter(k => k !== 'isEnd').join(',') || '空对象';
  let len = 0;
  try { len = extractResultList(r).length; } catch { /* ignore */ }
  return `keys=[${keys}] extractedLen=${len}`;
};

/**
 * 调用插件方法，若结果为空则等待后重试。
 * 参考落雪(lx) 的加载方式：失败时用增量退避拉长每次间隔，延后放弃，让加载转圈持续更久、命中率更高；
 * 不做短固定间隔的快速重试。delay 可传固定值或返回每次等待时长的函数。
 */
async function retryOnEmpty<T>(
  label: string,
  fn: () => Promise<T>,
  isEmpty: (val: T) => boolean,
  delay: number | ((attempt: number) => number) = (i: number) => MF_EMPTY_SEARCH_RETRY_DELAY_MS * 2 * i,
  attempts: number = 6,
): Promise<T> {
  const getDelay = (i: number) => (typeof delay === 'function' ? delay(i) : delay);
  let result: T | undefined;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    const wait = getDelay(i);
    try {
      result = await fn();
      catalogLog(`${label} 第${i}次 → ${describeResult(result)}`);
      if (!isEmpty(result)) return result;
      if (i < attempts) {
        catalogLog(`${label} 第${i}次为空，${wait}ms后重试(共${attempts}次)`);
        await sleep(wait);
      }
    } catch (e: any) {
      lastErr = e;
      catalogLog(`${label} 第${i}次异常: ${e?.message || e}`);
      if (i < attempts) {
        catalogLog(`${label} 异常后 ${wait}ms重试(共${attempts}次)`);
        await sleep(wait);
      }
    }
  }
  // 所有尝试都用尽且每次结果都判空 → 抛错由调用方决定兜底策略
  if (result === undefined || isEmpty(result as T)) {
    throw lastErr ?? new Error(`${label} 多次尝试后仍为空`);
  }
  return result as T;
}

/** 从歌手条目/详情对象中尽力提取简介，兼容各平台常见字段（含嵌套子对象） */
function extractArtistDescription(raw: any): string {
  if (!raw || typeof raw !== 'object') return '';
  const candidates = [
    'artistDesc', 'artistIntro', 'artist_intro', 'briefDesc', 'briefdesc',
    'intro', 'desc', 'description', 'profile', 'bio', 'biography',
    'aDesc', 'aDes',
  ];
  for (const key of candidates) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = extractArtistDescription(v);
      if (inner) return inner;
    }
  }
  return '';
}

// ==================== 搜索诊断类型 ====================

export type PluginMusicSearchStatus =
  | 'success'
  | 'empty'
  | 'init_failed'
  | 'search_unsupported'
  | 'lyrics_unsupported'
  | 'invalid_response'
  | 'search_failed';

export interface PluginMusicSearchDiagnostics {
  results: PluginSearchResult[];
  status: PluginMusicSearchStatus;
  reason: string;
  searchType?: string;
  supportsLyrics: boolean;
}

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

export interface PluginArtistResult {
  id: string;
  name: string;
  avatarUrl: string;
  description?: string;
  songCount?: number;
  albumCount?: number;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData?: any;
}

export interface PluginAlbumResult {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  description?: string;
  year?: string;
  songCount?: number;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData?: any;
}

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

/**
 * 检查插件是否支持指定搜索类型
 * 始终返回 true：实际搜索函数内部已做 supportedSearchType 检查，
 * Baka 插件可能未完整声明但实际支持 album/sheet/artist 搜索。
 */
export function pluginSupportsSearchType(_source: PluginSource, _type: 'music' | 'sheet' | 'artist' | 'album'): boolean {
  return true;
}

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