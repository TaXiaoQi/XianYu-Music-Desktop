import { listen } from '@tauri-apps/api/event';
import { onMounted, onUnmounted } from 'vue';
import { appApi } from '../services/tauri/appApi';
import { lxSearch, type LxSearchResultItem, type LxSourceId } from '../services/domain/lxMusicSdk';
import { getStoredPlugins, pluginMusicSearchWithDiagnostics } from '../services/domain/pluginEngine';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useLibraryStore } from '../features/library/store';
import { parseIntervalToSeconds } from '../utils/remoteSong';
import { useToast } from './toast';
import { finishShareLinkDialog, showShareLinkDialog } from './useShareLinkDialog';
import router from '../router';
import type { PluginSearchResult, PluginSource, Song } from '../types';

type SongLinkParams = {
  name: string;
  artist: string;
  source: string;
  cover: string;
  duration: number;
};

const VALID_LX_SOURCES: ReadonlySet<string> = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);

const LX_SOURCE_NAMES: Record<string, string> = {
  kw: '酷我音乐',
  kg: '酷狗音乐',
  tx: 'QQ音乐',
  wy: '网易云音乐',
  mg: '咪咕音乐',
};

const decodeOnce = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

function parseSongLink(raw: string): SongLinkParams {
  try {
    const u = new URL(raw);
    return {
      name: decodeOnce(u.searchParams.get('name') ?? ''),
      artist: decodeOnce(u.searchParams.get('artist') ?? ''),
      source: decodeOnce(u.searchParams.get('source') ?? ''),
      cover: decodeOnce(u.searchParams.get('cover') ?? ''),
      duration: Number(u.searchParams.get('duration') ?? '0') || 0,
    };
  } catch {
    return { name: '', artist: '', source: '', cover: '', duration: 0 };
  }
}

function lxResultToSong(item: LxSearchResultItem): Song {
  const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
  const songDuration = parseIntervalToSeconds(item.interval);
  const album = item.albumName || '未知专辑';
  return {
    name: item.name,
    title: item.name,
    path: `lx://${item.source}/${item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album,
    album_artist: item.singer || '未知歌手',
    album_key: `${album}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: songDuration,
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${item.source}/${item.songmid}`,
    _hash: item.hash,
    _types: item._types,
    _copyrightId: item.copyrightId,
    _songmid: item.songmid,
    _source: item.source,
    _songId: item.songId,
    _strMediaMid: item.strMediaMid,
    _albumMid: item.albumMid,
    _albumId: item.albumId,
    rawData: item,
  } as any;
}

function pluginResultToSong(item: PluginSearchResult): Song {
  const artistNames = item.artist
    ? item.artist.split(/[、,/&]/).filter(Boolean).map((s) => s.trim())
    : ['未知歌手'];
  const album = item.album || '未知专辑';
  const durationSec = Math.floor((item.duration || 0) / 1000);
  return {
    name: item.title,
    title: item.title,
    path: `plugin://${item.platform}/${item.id}`,
    artist: item.artist || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album,
    album_artist: item.artist || '未知歌手',
    album_key: `${album}-${item.artist || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: durationSec,
    cover_thumb_path: item.coverUrl || '',
    source_type: 'plugin',
    remote_source_id: `plugin://${item.platform}/${item.id}`,
    rawData: item,
  } as any;
}

function bestMatchIndex(
  items: { title: string; artist: string }[],
  name: string,
  artist: string,
): number {
  const ln = name.trim().toLowerCase();
  const la = artist.trim().toLowerCase();
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    let score = 0;
    const tn = (t.title || '').trim().toLowerCase();
    if (tn === ln) score += 3;
    else if (tn.includes(ln)) score += 2;
    else if (ln.includes(tn)) score += 1;
    if (la && (t.artist || '').trim().toLowerCase().includes(la)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function findPluginSource(source: string): PluginSource | null {
  if (!source) return null;
  const plugins = getStoredPlugins();
  return (
    plugins.find(
      (p) =>
        p.name === source ||
        p.id === source ||
        (Array.isArray(p.sources) && p.sources.includes(source)),
    ) ?? null
  );
}

function tryLocalMatch(name: string, artist: string, durationSec: number): Song | null {
  const normMeta = (s: string) => (s || '').trim().toLowerCase();
  const key = `${normMeta(name)}|${normMeta(artist)}`;
  const songs = useLibraryStore().songList;
  if (!songs || songs.length === 0) return null;
  const candidates: Song[] = [];
  for (const s of songs) {
    if (`${normMeta(s.title || s.name || '')}|${normMeta(s.artist || '')}` === key) {
      candidates.push(s);
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  if (durationSec <= 0) return candidates[0];
  let best: Song | undefined;
  let bestDiff = 5;
  for (const c of candidates) {
    const diff = Math.abs((c.duration || 0) - durationSec);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best ?? candidates[0];
}

async function resolveShareSong(
  name: string,
  artist: string,
  source: string,
  localSong: Song | null,
): Promise<Song | null> {
  if (localSong) return localSong;
  const keyword = artist.trim() ? `${name} ${artist}`.trim() : name.trim();

  if (source && source !== 'local') {
    const plugin = findPluginSource(source);
    if (plugin) {
      try {
        const diag = await pluginMusicSearchWithDiagnostics(plugin, keyword, 1, 20);
        if (diag.results.length > 0) {
          const idx = bestMatchIndex(
            diag.results.map((r) => ({ title: r.title, artist: r.artist })),
            name,
            artist,
          );
          return pluginResultToSong(diag.results[idx]);
        }
      } catch (e) {
        console.warn('[deeplink] 插件搜索失败，回退 lx 搜索:', e);
      }
    }
  }

  const lxSource: LxSourceId =
    source && VALID_LX_SOURCES.has(source) ? (source as LxSourceId) : 'kw';
  const result = await lxSearch(lxSource, keyword, 1);
  const first = result?.list?.[0];
  if (!first) return null;
  const idx = result.list.length
    ? bestMatchIndex(
        result.list.map((r) => ({ title: r.name, artist: r.singer })),
        name,
        artist,
      )
    : 0;
  return lxResultToSong(result.list[idx] ?? first);
}

async function playShareLinkSong(
  name: string,
  artist: string,
  source: string,
  localSong: Song | null,
) {
  const { showToast } = useToast();
  const { playSong } = usePlaybackController();
  try {
    const song = await resolveShareSong(name, artist, source, localSong);
    if (!song) {
      showToast('未找到分享的歌曲，请稍后重试', 'info');
      return;
    }
    await playSong(song, { shareLinkPlayback: true });
  } catch (error) {
    console.error('[deeplink] 分享歌曲播放失败:', error);
    showToast('分享歌曲播放失败', 'error');
  }
}

async function playShareLinkNext(
  name: string,
  artist: string,
  source: string,
  localSong: Song | null,
) {
  const { showToast } = useToast();
  const { playNext } = usePlaybackController();
  try {
    const song = await resolveShareSong(name, artist, source, localSong);
    if (!song) {
      showToast('未找到分享的歌曲，请稍后重试', 'info');
      return;
    }
    playNext(song);
  } catch (error) {
    console.error('[deeplink] 添加到下一首播放失败:', error);
    showToast('添加分享歌曲失败', 'error');
  }
}

async function searchShareSongOnline(name: string, artist: string): Promise<Song | null> {
  const keyword = artist.trim() ? `${name} ${artist}`.trim() : name.trim();
  const plugins = getStoredPlugins();
  for (const plugin of plugins) {
    try {
      const diag = await pluginMusicSearchWithDiagnostics(plugin, keyword, 1, 20);
      if (diag.results.length > 0) {
        const idx = bestMatchIndex(
          diag.results.map((r) => ({ title: r.title, artist: r.artist })),
          name,
          artist,
        );
        return pluginResultToSong(diag.results[idx]);
      }
    } catch (e) {
      console.warn('[deeplink] 插件搜索失败，继续下一插件:', e);
    }
  }
  const result = await lxSearch('kw', keyword, 1);
  const first = result?.list?.[0];
  if (!first) return null;
  const idx = result.list.length
    ? bestMatchIndex(
        result.list.map((r) => ({ title: r.name, artist: r.singer })),
        name,
        artist,
      )
    : 0;
  return lxResultToSong(result.list[idx] ?? first);
}

function resolveShareSourceAbility(source: string): { specified: boolean; any: boolean } {
  const plugins = getStoredPlugins();
  if (plugins.length === 0) return { specified: false, any: false };
  const specified = source
    ? plugins.some(
        (p) =>
          p.name === source ||
          p.id === source ||
          (Array.isArray(p.sources) && p.sources.includes(source)),
      )
    : false;
  return { specified, any: true };
}

async function handleSongLink(raw: string) {
  const { name, artist, source, cover, duration } = parseSongLink(raw);
  if (!name.trim()) return;
  const { playSong, playNext } = usePlaybackController();

  const localSong = tryLocalMatch(name, artist, duration);

  if (localSong) {
    const action = await showShareLinkDialog({
      name,
      artist,
      sourceLabel: '本地音乐',
      cover,
      mode: 'local',
    });
    if (action === 'cancel') return;
    try {
      if (action === 'playNext') {
        await playShareLinkNext(name, artist, source, localSong);
      } else if (action === 'play') {
        await playShareLinkSong(name, artist, source, localSong);
      }
    } finally {
      finishShareLinkDialog();
    }
    return;
  }

  if (source === 'local' || !source) {
    const onlineSong = await searchShareSongOnline(name, artist);
    if (onlineSong) {
      const action = await showShareLinkDialog({
        name,
        artist,
        sourceLabel: '本地无音源',
        cover,
        mode: 'online',
      });
      if (action === 'cancel') return;
      try {
        if (action === 'play') {
          await playSong(onlineSong, { shareLinkPlayback: true });
        } else if (action === 'playNext') {
          playNext(onlineSong);
        }
      } finally {
        finishShareLinkDialog();
      }
      return;
    }
    const action = await showShareLinkDialog({
      name,
      artist,
      sourceLabel: '未找到在线音源',
      cover,
      mode: 'import',
    });
    if (action === 'cancel') return;
    if (action === 'import') router.push('/plugins');
    return;
  }

  const ability = resolveShareSourceAbility(source);
  const sourceName =
    (source && LX_SOURCE_NAMES[source]) ||
    findPluginSource(source)?.name ||
    source ||
    '在线搜索';

  if (ability.specified) {
    const action = await showShareLinkDialog({
      name,
      artist,
      sourceLabel: sourceName,
      cover,
      mode: 'local',
    });
    if (action === 'cancel') return;
    try {
      if (action === 'playNext') {
        await playShareLinkNext(name, artist, source, localSong);
      } else {
        await playShareLinkSong(name, artist, source, localSong);
      }
    } finally {
      finishShareLinkDialog();
    }
    return;
  }

  if (ability.any) {
    const { showToast } = useToast();
    const action = await showShareLinkDialog({
      name,
      artist,
      sourceLabel: '无指定音源',
      cover,
      mode: 'online',
      onlineActionLabel: '无指定音源，前往在线播放',
    });
    if (action === 'cancel') return;
    try {
      if (action === 'play') {
        const fallback = await searchShareSongOnline(name, artist);
        if (fallback) {
          await playSong(fallback, { shareLinkPlayback: true });
        } else {
          showToast('未找到分享的歌曲，请稍后重试', 'info');
        }
      }
    } finally {
      finishShareLinkDialog();
    }
    return;
  }

  const action = await showShareLinkDialog({
    name,
    artist,
    sourceLabel: '无可用音源',
    cover,
    mode: 'import',
  });
  if (action === 'cancel') return;
  if (action === 'import') router.push('/plugins');
}

async function consumePendingDeepLinks() {
  try {
    const links = await appApi.consumePendingDeepLinks();
    for (const link of links) {
      await handleSongLink(link);
    }
  } catch (error) {
    console.error('Failed to consume pending deep links:', error);
  }
}

export function useDeepLinkBridge() {
  let unlisten: (() => void) | null = null;

  onMounted(async () => {
    unlisten = await listen('app:deep-link', () => consumePendingDeepLinks());
    await consumePendingDeepLinks();
  });

  onUnmounted(() => {
    unlisten?.();
  });
}
