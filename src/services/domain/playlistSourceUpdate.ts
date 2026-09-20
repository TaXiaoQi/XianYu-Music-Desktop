import type { Playlist, PluginSearchResult, Song } from '../../types';
import { getStoredPlugins, pluginGetPlaylistDetailWithEnd, pluginImportMusicSheet } from './pluginEngine';
import { importPlaylist } from './playlistImport';

// 平台直连导入音源（非插件）
const PLATFORM_SOURCES = new Set(['wy', 'tx', 'kw', 'kg']);

/**
 * 歌单搜索结果 → 歌曲。
 * path = lx://{真实音源}/{songmid}，保证 lx 播放链路能按真实音源命中插件、
 * 并按 songmid 取到完整 musicInfo。导入、更新、收藏夹三处共用，
 * 保证更新时拉取的源端歌曲 path 与导入时一致，可用于对比。
 */
export function importResultToSongs(songs: PluginSearchResult[]): Song[] {
  return songs.map((item) => {
    const artistNames = item.artist
      ? item.artist.split(/[、,/&]/).filter(Boolean).map((s) => s.trim())
      : ['未知歌手'];
    const raw = item.rawData as Record<string, any> | undefined;
    // lx 歌单详情条目带真实音源与 songmid（如 kw/kg/tx/wy），
    // lx:// 链路把第一段当音源 key，必须用真实 source 而非插件 pluginId。
    const sourceKey = raw?.source || item.pluginId || 'wy';
    const songmid = raw?.songmid || item.id || item.platformId || '';
    const path = `lx://${sourceKey}/${songmid}`;
    return {
      name: item.title,
      title: item.title,
      path,
      artist: item.artist || '未知歌手',
      artist_names: artistNames,
      effective_artist_names: artistNames,
      album: item.album || '未知专辑',
      album_artist: item.artist || '未知歌手',
      album_key: `${item.album || '未知专辑'}-${item.artist || '未知歌手'}`,
      is_various_artists_album: false,
      collapse_artist_credits: false,
      duration: Math.floor((item.duration || 0) / 1000),
      cover_thumb_path: item.coverUrl || '',
      source_type: 'remote' as const,
      remote_source_id: path,
      rawData: item.rawData ?? item,
      // 补齐 lx 播放链路的 _ 前缀回退字段（resolveLxCachedInfo / buildLxSongInfo 依赖）
      _hash: raw?.hash,
      _types: raw?._types ?? raw?.types,
      _copyrightId: raw?.copyrightId,
      _strMediaMid: raw?.strMediaMid,
      _albumId: raw?.albumId,
      _albumMid: raw?.albumMid,
      _songId: raw?.songId,
    } as Song;
  });
}

export function hasPlaylistSource(playlist: Playlist | null | undefined): boolean {
  return !!playlist && !!(playlist.sourcePluginId || playlist.sourceUrl);
}

/**
 * 按导入时记录的来源重新拉取源端歌曲列表（Song[]）。
 * 平台导入：用记录的 sourceUrl 重走 importPlaylist；
 * 插件导入：优先用 sourceRaw 分页拉取歌单详情，失败时用 sourceUrl 走 importMusicSheet 兜底。
 */
export async function fetchSourceSongs(playlist: Playlist): Promise<Song[]> {
  const sourcePluginId = playlist.sourcePluginId ?? '';
  const sourceUrl = playlist.sourceUrl ?? '';

  if (sourceUrl && PLATFORM_SOURCES.has(sourcePluginId)) {
    const result = await importPlaylist(sourcePluginId, sourceUrl);
    return importResultToSongs(result.songs);
  }

  if (sourcePluginId) {
    const plugin = getStoredPlugins().find(p => p.id === sourcePluginId && p.enabled);
    if (plugin) {
      const results: PluginSearchResult[] = [];
      const raw = playlist.sourceRaw;
      if (raw) {
        const seen = new Set<string>();
        let page = 1;
        let maxPageSize = 0;
        const MAX_PAGES = 50;
        const total = Number(raw.trackCount) || 0;
        while (page <= MAX_PAGES) {
          const { songs, isEnd } = await pluginGetPlaylistDetailWithEnd(plugin, raw, page);
          if (songs.length === 0) break;
          const fresh = songs.filter(s => {
            const key = `${s.platformId ?? s.id}|${s.title}|${s.artist}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (fresh.length === 0) break;
          results.push(...fresh);
          if (isEnd === true) break;
          if (total > 0 && results.length >= total) break;
          maxPageSize = Math.max(maxPageSize, songs.length);
          if (songs.length < maxPageSize) break;
          page++;
        }
      }
      if (results.length === 0 && sourceUrl) {
        results.push(...await pluginImportMusicSheet(plugin, sourceUrl));
      }
      if (results.length > 0) {
        return importResultToSongs(results);
      }
    }
  }

  throw new Error('音源插件未安装或未启用，无法更新');
}

export interface SourceDiffResult {
  sourceSongs: Song[];
  addCount: number;
  removeCount: number;
}

/**
 * 对比源端与本地：
 * - addCount：源端有而本地没有的歌曲数；
 * - removeCount：本地有而源端已移除的歌曲数（本软件内手动添加的 addedInApp 不计入）。
 */
export async function diffPlaylistWithSource(playlist: Playlist): Promise<SourceDiffResult> {
  const sourceSongs = await fetchSourceSongs(playlist);
  if (sourceSongs.length === 0) {
    return { sourceSongs, addCount: 0, removeCount: 0 };
  }

  const sourceKeys = new Set(sourceSongs.map(s => s.path));
  const localKeys = new Set(playlist.songPaths);
  const addCount = sourceSongs.filter(s => !localKeys.has(s.path)).length;
  const removeCount = (playlist.songs ?? [])
    .filter(s => !s.addedInApp && !sourceKeys.has(s.path))
    .length;

  return { sourceSongs, addCount, removeCount };
}
