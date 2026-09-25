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
  PlaylistSourceRef,
  ParsedLink,
  WyTrackMetaPatch,
} from './playlistImportBase';
export { fetchWyTrackMetaByIds } from './playlistImportWy';
export { fetchQqTrackMetaByIds } from './playlistImportTx';
export { fetchKwTrackMetaByIds } from './playlistImportKw';
export { fetchKgTrackMetaByIds } from './playlistImportKg';

// ==================== 音源定义 ====================

const SUPPORTED_IMPORT_SOURCES: ReadonlySet<string> = new Set(['wy', 'tx', 'kw', 'kg']);

const SOURCE_PLATFORM_NAMES: Record<string, string> = {
  wy: '网易云',
  tx: 'QQ音乐',
  kw: '酷我',
  kg: '酷狗',
  mg: '咪咕',
};

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

  const searchResults = await pluginPlaylistSearch(pluginSource, input, 1);
  if (searchResults.length === 0) {
    throw new Error(`未在 ${pluginSource.name} 中找到匹配的歌单`);
  }

  const sheetItem = searchResults[0];

  const allSongs: PluginSearchResult[] = [];
  const seen = new Set<string>();
  let page = 1;
  let maxPageSize = 0;
  const MAX_PAGES = 50;
  const total = Number(sheetItem.trackCount) || 0;

  while (page <= MAX_PAGES) {
    const { songs, isEnd } = await pluginGetPlaylistDetailWithEnd(pluginSource, sheetItem.rawData, page);
    if (songs.length === 0) break;
    const fresh = songs.filter(s => {
      const key = `${s.platformId ?? s.id}|${s.title}|${s.artist}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) break;
    allSongs.push(...fresh);
    if (isEnd === true) break;
    if (total > 0 && allSongs.length >= total) break;
    maxPageSize = Math.max(maxPageSize, songs.length);
    if (songs.length < maxPageSize) break;
    page++;
  }

  const sourceRaw = sheetItem.rawData
    ? JSON.parse(JSON.stringify(sheetItem.rawData))
    : undefined;
  if (sourceRaw && Array.isArray(sourceRaw._importedTracks)) {
    delete sourceRaw._importedTracks;
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
    sourceRef: {
      sourcePluginId: pluginSource.id,
      sourceRaw,
    },
  };
}

// ==================== 收藏夹导入（哔哩哔哩等） ====================

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
    sourceRef: {
      sourcePluginId: pluginSource.id,
      sourceUrl: input,
    },
  };
}

// ==================== 主入口 ====================

export async function importPlaylist(
  source: string,
  idOrUrl: string,
): Promise<PlaylistImportResult> {
  const input = idOrUrl.trim();
  if (!input) {
    throw new Error('请输入歌单链接或 ID');
  }

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

  let result: PlaylistImportResult;
  switch (actualSource) {
    case 'wy':
      result = await getListDetailWy(actualId);
      break;
    case 'tx':
      result = await getListDetailTx(actualId);
      break;
    case 'kw':
      result = await getListDetailKw(actualId);
      break;
    case 'kg':
      result = await getListDetailKg(actualId);
      break;
    default:
      throw new Error(`不支持的音源: ${actualSource}`);
  }

  return {
    ...result,
    sourceRef: {
      sourcePluginId: actualSource,
      sourceUrl: input,
    },
  };
}