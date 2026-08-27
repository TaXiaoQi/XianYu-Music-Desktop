/**
 * 外部歌单导入服务（门面）
 *
 * 完全移植自 yyy 项目中的 LxSdkSongList.kt 和 LinkParser.kt
 * 支持从网易云(小芸)、QQ音乐(小秋)、酷我(小枸)、酷狗(小蜗)导入歌单。
 *
 * 各平台实现已拆到独立子模块：playlistImportBase（共享底座）、
 * playlistImportWy/Tx/Kw/Kg（每平台歌单详情与曲目元数据）。本模块负责
 * 音源列表、MusicFree 收藏夹/插件导入、LX 主入口编排，并 re-export 公共 API。
 */
import {
  getStoredPlugins,
  pluginGetPlaylistDetailWithEnd,
  pluginImportMusicSheet,
  pluginPlaylistSearch,
} from './pluginEngine';
import { LX_SOURCE_NAMES, type LxSourceId } from './lxMusicSdk';
import {
  parseLink,
  type PlaylistImportResult,
  type PlaylistSource,
} from './playlistImportBase';
import { getListDetailKg } from './playlistImportKg';
import { getListDetailKw } from './playlistImportKw';
import { getListDetailTx } from './playlistImportTx';
import { getListDetailWy } from './playlistImportWy';
import type { PluginSearchResult } from '../../types';

// ==================== Re-export（向后兼容入口） ====================
export { parseLink } from './playlistImportBase';
export type {
  PlaylistImportResult,
  PlaylistInfo,
  PlaylistSource,
  ParsedLink,
  WyTrackMetaPatch,
} from './playlistImportBase';
export { fetchWyTrackMetaByIds } from './playlistImportWy';
export { fetchQqTrackMetaByIds } from './playlistImportTx';
export { fetchKwTrackMetaByIds } from './playlistImportKw';
export { fetchKgTrackMetaByIds } from './playlistImportKg';

// ==================== 音源定义 ====================

/** importPlaylist 支持的 LX 源 key 集合 */
const SUPPORTED_IMPORT_SOURCES: ReadonlySet<string> = new Set(['wy', 'tx', 'kw', 'kg']);

/** 平台中文名映射 */
const SOURCE_PLATFORM_NAMES: Record<string, string> = {
  wy: '网易云',
  tx: 'QQ音乐',
  kw: '酷我',
  kg: '酷狗',
  mg: '咪咕',
};

/**
 * 从已安装的插件中读取支持歌单导入的音源列表
 * 参考 Search.vue 的 refreshPluginSourceList 逻辑：
 * - LX 插件多平台时拆分为独立条目，使用平台名显示
 * - LX 插件单平台时以插件名显示
 * - MusicFree 插件（如 BakaMusic）直接以插件名显示，key 带 mf_ 前缀
 * - 始终在首位包含"自动识别"
 */
export function getImportSourcesFromPlugins(): PlaylistSource[] {
  const sources: PlaylistSource[] = [
    { key: 'auto', name: '自动识别', platform: '', type: 'lx' },
  ];

  const raw = getStoredPlugins();
  const plugins = raw
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.enabled)
    .sort((a, b) => {
      const sa = a.p.sortOrder ?? 0;
      const sb = b.p.sortOrder ?? 0;
      if (sa !== sb) return sa - sb;
      return a.idx - b.idx;
    })
    .map(({ p }) => p);

  const seenKeys = new Set<string>();

  for (const p of plugins) {
    if (p.format === 'lx' && p.sources.length > 0) {
      const lxSources = p.sources.filter(s => SUPPORTED_IMPORT_SOURCES.has(s)) as LxSourceId[];
      if (lxSources.length === 0) continue;

      if (lxSources.length === 1) {
        const key = lxSources[0];
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        sources.push({
          key,
          name: p.name,
          platform: SOURCE_PLATFORM_NAMES[key] || '',
          type: 'lx',
        });
      } else {
        for (const sourceId of lxSources) {
          if (seenKeys.has(sourceId)) continue;
          seenKeys.add(sourceId);
          sources.push({
            key: sourceId,
            name: LX_SOURCE_NAMES[sourceId],
            platform: SOURCE_PLATFORM_NAMES[sourceId] || '',
            type: 'lx',
          });
        }
      }
    } else if (p.format === 'musicfree') {
      // MusicFree 插件（如 BakaMusic）：以插件名显示，key 带 mf_ 前缀避免与 LX 源冲突
      const key = `mf_${p.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      sources.push({
        key,
        name: p.name,
        platform: p.name,
        type: 'musicfree',
        pluginSource: p,
      });

      // 哔哩哔哩插件：额外添加收藏夹导入入口
      if (p.sources.some(s => s.toLowerCase() === 'bilibili')) {
        const favKey = `fav_${p.id}`;
        if (!seenKeys.has(favKey)) {
          seenKeys.add(favKey);
          sources.push({
            key: favKey,
            name: '哔哩哔哩收藏夹',
            platform: p.name,
            type: 'favorites',
            pluginSource: p,
          });
        }
      }
    }
  }

  return sources;
}

// ==================== MusicFree 插件歌单导入 ====================

/**
 * 通过 MusicFree 插件导入歌单
 * 流程：用户输入关键词 → 插件搜索歌单 → 取第一个结果 → 获取歌单详情
 *
 * @param pluginSource MusicFree 插件源
 * @param keyword 歌单名称、ID 或链接（作为搜索关键词）
 * @returns 导入结果
 */
export async function importPlaylistFromMusicFreePlugin(
  pluginSource: PlaylistSource['pluginSource'],
  keyword: string,
): Promise<PlaylistImportResult> {
  const input = keyword.trim();
  if (!input) {
    throw new Error('请输入歌单名称或链接');
  }

  if (!pluginSource) {
    throw new Error('插件源不可用，请重新选择音源');
  }

  // 1. 搜索歌单
  const searchResults = await pluginPlaylistSearch(pluginSource, input, 1);
  if (searchResults.length === 0) {
    throw new Error(`未在 ${pluginSource.name} 中找到匹配的歌单`);
  }

  // 取第一个搜索结果
  const sheetItem = searchResults[0];

  // 2. 获取歌单详情（可能分页，循环获取全部歌曲）
  const allSongs: PluginSearchResult[] = [];
  const seen = new Set<string>();
  let page = 1;
  let maxPageSize = 0;
  const MAX_PAGES = 50; // 安全上限
  const total = Number(sheetItem.trackCount) || 0;

  while (page <= MAX_PAGES) {
    const { songs, isEnd } = await pluginGetPlaylistDetailWithEnd(pluginSource, sheetItem.rawData, page);
    if (songs.length === 0) break;
    // 去重：部分插件忽略 page 参数，每页返回同一批
    const fresh = songs.filter(s => {
      const key = `${s.platformId ?? s.id}|${s.title}|${s.artist}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) break;
    allSongs.push(...fresh);
    // 插件明确返回 isEnd → 已到最后一页
    if (isEnd === true) break;
    // 已拉满歌单总数 → 结束
    if (total > 0 && allSongs.length >= total) break;
    maxPageSize = Math.max(maxPageSize, songs.length);
    // 兜底：isEnd 缺失时，本页数量不足已见最大页大小 → 最后一页（部分页）
    if (songs.length < maxPageSize) break;
    page++;
  }

  return {
    source: pluginSource.name,
    songs: allSongs,
    total: allSongs.length,
    info: {
      name: sheetItem.title || '导入的歌单',
      img: sheetItem.coverUrl || '',
      desc: '',
      author: sheetItem.artist || '',
      playCount: '',
    },
  };
}

// ==================== 收藏夹导入（哔哩哔哩等） ====================

/**
 * 通过插件的 importMusicSheet 接口直接导入收藏夹
 *
 * 与 importPlaylistFromMusicFreePlugin 不同，此函数不经过搜索步骤，
 * 直接将 URL/ID 传给插件的 importMusicSheet 方法获取全部曲目。
 *
 * @param pluginSource 支持收藏夹导入的插件源（如哔哩哔哩）
 * @param urlOrId 收藏夹链接或 ID
 * @returns 导入结果
 */
export async function importPlaylistFromFavorites(
  pluginSource: PlaylistSource['pluginSource'],
  urlOrId: string,
): Promise<PlaylistImportResult> {
  const input = urlOrId.trim();
  if (!input) {
    throw new Error('请输入收藏夹链接或 ID');
  }

  if (!pluginSource) {
    throw new Error('插件源不可用，请重新选择音源');
  }

  const songs = await pluginImportMusicSheet(pluginSource, input);
  if (songs.length === 0) {
    throw new Error(`未能从 ${pluginSource.name} 收藏夹中获取歌曲，请检查链接是否正确`);
  }

  return {
    source: pluginSource.name,
    songs,
    total: songs.length,
    info: {
      name: `${pluginSource.name}收藏夹`,
      img: songs[0]?.coverUrl || '',
      desc: '',
      author: '',
      playCount: '',
    },
  };
}

// ==================== 主入口 ====================

/**
 * 导入外部歌单（LX 音源）
 *
 * @param source 音源 key: "wy" | "tx" | "kw" | "kg" | "auto"
 * @param idOrUrl 歌单 ID 或分享链接
 * @returns 导入结果
 */
export async function importPlaylist(
  source: string,
  idOrUrl: string,
): Promise<PlaylistImportResult> {
  const input = idOrUrl.trim();
  if (!input) {
    throw new Error('请输入歌单链接或 ID');
  }

  // 当输入是 URL 时，自动从 URL 识别平台（忽略用户选择的源，避免选错）
  // 当输入是纯 ID 时，使用用户选择的源
  let actualSource = source;
  let actualId = input;

  if (input.startsWith('https://') || input.startsWith('http://')) {
    const parsed = parseLink(input);
    if (parsed) {
      actualSource = parsed.source;
      actualId = parsed.playlistId;
    } else {
      throw new Error('无法识别歌单链接，请确认链接来自网易云/QQ音乐/酷我/酷狗');
    }
  } else if (source === 'auto') {
    throw new Error('请选择对应音源后重试，或直接粘贴歌单链接');
  }

  try {
    switch (actualSource) {
      case 'wy':
        return await getListDetailWy(actualId);
      case 'tx':
        return await getListDetailTx(actualId);
      case 'kw':
        return await getListDetailKw(actualId);
      case 'kg':
        return await getListDetailKg(actualId);
      default:
        throw new Error(`不支持的音源: ${actualSource}`);
    }
  } catch (e: any) {
    throw e;
  }
}