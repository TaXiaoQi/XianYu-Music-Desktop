import type { Song, PluginSearchResult, PluginSource } from '../types';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { buildLyricsRaw, loadLyrics } from '../composables/lyrics';
import { tauriInvoke } from './tauri/invoke';
import {
  getStoredPlugins,
  pluginGetLyric,
  pluginMusicSearchWithDiagnostics,
} from './pluginEngine';
import {
  ensureLxPluginInstance,
  lxPluginGetLyric,
  type LxPluginState,
} from './lxPluginEngine';
import {
  LX_SOURCE_NAMES,
  lxSearch,
  type LxSearchResultItem,
  type LxSourceId,
} from './lxMusicSdk';

const VALID_LX_SOURCES: ReadonlySet<string> = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);
const ONLINE_PATH_RE = /^[a-z][a-z\d+.-]*:\/\//i;

export type LyricsSearchCandidate =
  | {
      id: string;
      kind: 'musicfree';
      pluginId: string;
      pluginName: string;
      sourceName: string;
      title: string;
      artist: string;
      album: string;
      duration: number;
      result: PluginSearchResult;
    }
  | {
      id: string;
      kind: 'lx';
      pluginId: string;
      pluginName: string;
      sourceName: string;
      sourceId: LxSourceId;
      title: string;
      artist: string;
      album: string;
      duration: number;
      result: LxSearchResultItem;
    };

export type LyricsSearchSourceStatus = 'success' | 'empty' | 'error' | 'unsupported';

export interface LyricsSearchSourceGroup {
  id: string;
  sourceName: string;
  candidates: LyricsSearchCandidate[];
  status: LyricsSearchSourceStatus;
  reason: string;
  /** MusicFree 由插件搜索；LX 插件本身无搜索协议，歌曲目录由应用搜索。 */
  searchProvider: 'plugin' | 'app-catalog';
}

export interface LyricsPluginGroup {
  pluginId: string;
  pluginName: string;
  pluginFormat: PluginSource['format'];
  formatLabel: string;
  sources: LyricsSearchSourceGroup[];
}

const sortedEnabledPlugins = () => getStoredPlugins()
  .map((plugin, index) => ({ plugin, index }))
  .filter(({ plugin }) => plugin.enabled)
  .sort((left, right) => {
    const orderDifference = (left.plugin.sortOrder ?? 0) - (right.plugin.sortOrder ?? 0);
    return orderDifference || left.index - right.index;
  })
  .map(({ plugin }) => plugin);

const parseLxDuration = (interval: string): number => {
  const parts = interval.split(':').map(Number);
  if (parts.length !== 2 || parts.some(part => !Number.isFinite(part))) return 0;
  return parts[0] * 60 + parts[1];
};

const createMusicFreeGroup = async (
  plugin: PluginSource,
  query: string,
): Promise<LyricsPluginGroup> => {
  const diagnostics = await pluginMusicSearchWithDiagnostics(plugin, query, 1, 30);
  const status: LyricsSearchSourceStatus = diagnostics.status === 'success'
    ? 'success'
    : diagnostics.status === 'empty'
      ? 'empty'
      : ['search_unsupported', 'lyrics_unsupported'].includes(diagnostics.status)
        ? 'unsupported'
        : 'error';

  return {
    pluginId: plugin.id,
    pluginName: plugin.name,
    pluginFormat: plugin.format,
    formatLabel: 'MusicFree',
    sources: [{
      id: plugin.id,
      sourceName: plugin.name,
      status,
      reason: diagnostics.reason,
      searchProvider: 'plugin',
      candidates: diagnostics.results.map((result, index) => ({
        id: `mf:${plugin.id}:${result.id || result.platformId || index}`,
        kind: 'musicfree' as const,
        pluginId: plugin.id,
        pluginName: plugin.name,
        sourceName: plugin.name,
        title: result.title || result.name || '未知歌曲',
        artist: result.artist || '未知歌手',
        album: result.album || '',
        duration: result.duration > 10000 ? result.duration / 1000 : result.duration,
        result,
      })),
    }],
  };
};

const createLxSourceGroup = async (
  plugin: PluginSource,
  sourceId: LxSourceId,
  query: string,
  state: LxPluginState,
): Promise<LyricsSearchSourceGroup> => {
  const groupId = `${plugin.id}:${sourceId}`;
  const sourceName = LX_SOURCE_NAMES[sourceId] || sourceId.toUpperCase();
  const sourceInfo = state.initInfo?.sources[sourceId];

  if (!sourceInfo) {
    return {
      id: groupId,
      sourceName,
      candidates: [],
      status: 'error',
      reason: `插件已初始化，但初始化信息中没有音源“${sourceId}”`,
      searchProvider: 'app-catalog',
    };
  }

  if (!sourceInfo.actions.includes('lyric')) {
    return {
      id: groupId,
      sourceName,
      candidates: [],
      status: 'unsupported',
      reason: `插件的“${sourceName}”音源未声明 lyric 能力，只支持：${sourceInfo.actions.join('、') || '无'}`,
      searchProvider: 'app-catalog',
    };
  }

  try {
    const results = await lxSearch(sourceId, query, 1);
    return {
      id: groupId,
      sourceName,
      status: results.list.length > 0 ? 'success' : 'empty',
      reason: results.list.length > 0
        ? `应用歌曲目录返回 ${results.list.length} 首歌曲；选中后由“${plugin.name}”获取歌词`
        : `应用歌曲目录搜索成功，但没有找到与“${query}”匹配的歌曲`,
      searchProvider: 'app-catalog',
      candidates: results.list.map((result, index) => ({
        id: `lx:${plugin.id}:${sourceId}:${result.songmid || index}`,
        kind: 'lx' as const,
        pluginId: plugin.id,
        pluginName: plugin.name,
        sourceName,
        sourceId,
        title: result.name || '未知歌曲',
        artist: result.singer || '未知歌手',
        album: result.albumName || '',
        duration: parseLxDuration(result.interval),
        result,
      })),
    };
  } catch (error) {
    return {
      id: groupId,
      sourceName,
      candidates: [],
      status: 'error',
      reason: `应用歌曲目录搜索失败：${String(error)}`,
      searchProvider: 'app-catalog',
    };
  }
};

const createLxPluginGroup = async (
  plugin: PluginSource,
  query: string,
): Promise<LyricsPluginGroup> => {
  const sourceIds = [...new Set(
    plugin.sources.filter(source => VALID_LX_SOURCES.has(source)),
  )] as LxSourceId[];
  const createUnavailableSources = (
    status: LyricsSearchSourceStatus,
    reason: string,
  ): LyricsSearchSourceGroup[] => sourceIds.length > 0
    ? sourceIds.map(sourceId => ({
      id: `${plugin.id}:${sourceId}`,
      sourceName: LX_SOURCE_NAMES[sourceId] || sourceId.toUpperCase(),
      candidates: [],
      status,
      reason,
      searchProvider: 'app-catalog',
    }))
    : [{
      id: `${plugin.id}:unknown`,
      sourceName: '未声明音源',
      candidates: [],
      status,
      reason,
      searchProvider: 'app-catalog',
    }];

  if (sourceIds.length === 0) {
    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginFormat: plugin.format,
      formatLabel: 'LX',
      sources: createUnavailableSources('unsupported', '插件没有声明受支持的音乐音源，无法搜索歌词'),
    };
  }

  const state = await ensureLxPluginInstance(plugin);
  if (!state || state.status !== 'ready' || !state.initInfo) {
    const reason = state?.errorMessage
      || (/初始化失败/.test(plugin.description) ? plugin.description : '')
      || 'LX 插件初始化失败，请检查插件文件、网络请求或插件日志';
    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginFormat: plugin.format,
      formatLabel: 'LX',
      sources: createUnavailableSources('error', reason),
    };
  }

  return {
    pluginId: plugin.id,
    pluginName: plugin.name,
    pluginFormat: plugin.format,
    formatLabel: 'LX',
    sources: await Promise.all(
      sourceIds.map(sourceId => createLxSourceGroup(plugin, sourceId, query, state)),
    ),
  };
};

export const createDefaultLyricsSearchQuery = (song: Song) =>
  [song.title || song.name, song.artist]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(' ');

/** 按“插件 → 音源 → 候选歌词”搜索；明确不支持歌词流程的插件不会出现在结果中。 */
export async function searchLyricsFromAllPlugins(query: string): Promise<LyricsPluginGroup[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const tasks: Promise<LyricsPluginGroup>[] = [];
  for (const plugin of sortedEnabledPlugins()) {
    if (plugin.format === 'musicfree') {
      tasks.push(createMusicFreeGroup(plugin, normalizedQuery));
      continue;
    }

    if (plugin.format === 'lx') {
      tasks.push(createLxPluginGroup(plugin, normalizedQuery));
      continue;
    }

    tasks.push(Promise.resolve({
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginFormat: plugin.format,
      formatLabel: '未知格式',
      sources: [{
        id: `${plugin.id}:unknown`,
        sourceName: '未识别插件',
        candidates: [],
        status: 'unsupported',
        reason: '无法识别插件格式，仅支持 MusicFree 和 LX 插件',
        searchProvider: 'plugin',
      }],
    }));
  }

  const groups = await Promise.all(tasks);
  return groups.filter(group => group.sources.some(source => source.status !== 'unsupported'));
}

export async function getLyricsForCandidate(candidate: LyricsSearchCandidate): Promise<string> {
  const plugin = getStoredPlugins().find(item => item.id === candidate.pluginId && item.enabled);
  if (!plugin) throw new Error(`插件“${candidate.pluginName}”不可用`);

  if (candidate.kind === 'musicfree') {
    const result = await pluginGetLyric(plugin, candidate.result);
    const lyrics = result?.lyricsRaw?.trim() || '';
    if (!lyrics) throw new Error('该搜索结果没有返回歌词');
    return lyrics;
  }

  await ensureLxPluginInstance(plugin);
  const result = await lxPluginGetLyric(plugin, candidate.sourceId, candidate.result);
  const lyrics = result
    ? buildLyricsRaw(result.lyric, result.tlyric, result.rlyric, result.lxlyric)
    : '';
  if (!lyrics.trim()) throw new Error('该搜索结果没有返回歌词');
  return lyrics;
}

export const isRuntimeOnlyLyricsSong = (song: Song) =>
  song.source_type === 'remote' || ONLINE_PATH_RE.test(song.path);

/**
 * 应用歌词到当前歌曲。本地歌曲写回原歌词存储位置；在线歌曲更新运行时歌曲元数据。
 */
export async function applyLyricsReplacement(song: Song, lyricsRaw: string): Promise<'saved' | 'runtime'> {
  const normalizedLyrics = lyricsRaw.replace(/^\uFEFF/, '').trim();
  if (!normalizedLyrics) throw new Error('歌词内容为空');

  const playbackStore = usePlaybackStore();
  if (playbackStore.currentSong?.path !== song.path) {
    throw new Error('当前播放歌曲已经切换，请重新选择歌词');
  }

  if (!isRuntimeOnlyLyricsSong(song)) {
    const currentStorage = await tauriInvoke('get_song_lyrics_for_edit', { path: song.path });
    await tauriInvoke('save_song_lyrics', {
      path: song.path,
      lyrics: normalizedLyrics,
      source: currentStorage.source,
      sourcePath: currentStorage.sourcePath,
    });
    await loadLyrics(normalizedLyrics);
    return 'saved';
  }

  const libraryStore = useLibraryStore();
  // 同步写入当前闭包持有的歌曲对象，防止已在途的在线歌词请求晚到后覆盖手动选择。
  song.lyrics_raw = normalizedLyrics;
  libraryStore.patchSongMeta(song.path, { lyrics_raw: normalizedLyrics });
  playbackStore.patchQueueSongMeta(song.path, { lyrics_raw: normalizedLyrics });
  playbackStore.currentSong = { ...playbackStore.currentSong, lyrics_raw: normalizedLyrics };
  await loadLyrics(normalizedLyrics);
  return 'runtime';
}
