<script setup lang="ts">
import { defineAsyncComponent, ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-vue-next';

import type { Song, PluginSearchResult } from '../types';
import {
  useOnlineDetailStore,
  openOnlineDetail,
  type OnlineDetailType,
  type OnlineDetailStateCache,
} from '../features/onlineDetail/store';
import {
  buildOnlineCollectionKey,
  resolveOnlineCollectionPlatformId,
  type FavoriteCollectionEntry,
} from '../features/collections/store';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryStore } from '../features/library/store';
import { useAuthStore } from '../features/auth/store';
import { useToast } from '../composables/toast';
import { launchFlyingCover } from '../composables/useFlyingCover';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { showLoginRequiredDialog } from '../composables/useBanDialog';
import { downloadFavorites as downloadUserFavorites } from '../services/domain/favoritesSync';
import {
  fetchWyTrackMetaByIds,
  fetchQqTrackMetaByIds,
  fetchKwTrackMetaByIds,
  fetchKgTrackMetaByIds,
  type WyTrackMetaPatch,
} from '../services/domain/playlistImport';
import { fileSyncDownload as downloadUserPlaylists, syncPayloadToSong, firstRemoteSongCover } from '../services/domain/playlistSync';
import { getCiyuanxiId } from '../services/domain/playlistSync';
import { getSongAlbumKey } from '../features/library/playerLibraryViewShared';
import { getDisplayCoverUrl } from '../utils/coverProxy';
import {
  pluginGetArtistWorks,
  pluginGetArtistAlbums,
  pluginGetArtistInfo,
  pluginGetAlbumSongs,
  pluginGetPlaylistDetail,
  pluginGetPlaylistDetailWithEnd,
  pluginGetCover,
  pluginArtistSearch,
  pluginAlbumSearch,
  type PluginAlbumResult,
} from '../services/domain/pluginEngine';
import {
  lxSearch,
  lxGetAlbumSongs,
  lxGetPlaylistTracks,
  lxCatalogSearch,
  lxGetPic,
  type LxSourceId,
  type LxSearchResultItem,
  type LxAlbumSearchResult,
  type LxArtistSearchResult,
} from '../services/domain/lxMusicSdk';
import { ensureLxPluginInstance, lxPluginGetPic } from '../services/domain/lxPluginEngine';
import { cacheLxSong } from '../services/domain/lxSongCache';
import { cacheLxSongInfo } from '../services/domain/lxLyricFetcher';
import { parseIntervalToSeconds } from '../utils/remoteSong';
import { extractDurationMs } from '../services/domain/pluginResultMappers';

import ArtistDetailHeader from '../components/headers/ArtistDetailHeader.vue';
import AlbumDetailHeader from '../components/headers/AlbumDetailHeader.vue';
import DetailHeader from '../components/headers/DetailHeader.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';
import { type ArtistTabId } from '../utils/artistTabsOrder';
import { useSongContextActions } from '../composables/useSongContextActions';

const SongTable = defineAsyncComponent(() => import('../components/song-list/SongTable.vue'));

const route = useRoute();
const router = useRouter();
const { showToast } = useToast();
const { playSong, clearQueue, addSongsToQueue } = usePlaybackController();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const libraryStore = useLibraryStore();
const authStore = useAuthStore();
const onlineDetailStore = useOnlineDetailStore();
const { openHomeArtist, openHomeAlbum } = useHomeNavigation(router);

const detailType = computed<OnlineDetailType>(() =>
  onlineDetailStore.currentDetail?.context.type
  ?? (route.query.type as OnlineDetailType)
  ?? 'artist',
);
const ctx = computed(() => onlineDetailStore.currentDetail?.context ?? null);

const loading = ref(false);
const hasInitialLoad = ref(false);
const detailScrollRef = ref<HTMLElement | null>(null);
const detailMemoryKey = computed(() => {
  const c = ctx.value;
  if (!c) return '';
  const engine = c.engineType === 'lx'
    ? `lx:${c.lxSourceId ?? ''}`
    : `mf:${c.pluginSource?.id ?? ''}`;
  return `${engine}::${resolveOnlineCollectionPlatformId(c) || c.title || ''}`;
});
const navToken = computed(() => String(route.query.d ?? ''));
const songs = ref<any[]>([]);

let pendingScrollTop: number | null = null;
let scrollApplyToken = 0;

const cancelPendingScroll = () => {
  pendingScrollTop = null;
  scrollApplyToken += 1;
};

const handleDetailEnter = () => {
  const isStateless = detailType.value === 'album' || detailType.value === 'playlist';
  const target = isStateless ? 0 : pendingScrollTop;
  if (target === null) return;
  const token = ++scrollApplyToken;
  let attempts = 0;
  const step = () => {
    const el = detailScrollRef.value;
    if (token !== scrollApplyToken || !el) return;
    if (el.scrollTop === target) {
      pendingScrollTop = null;
      return;
    }
    el.scrollTop = target;
    el.dispatchEvent(new Event('scroll'));
    if (Math.abs(el.scrollTop - target) < 2 || attempts >= 120) {
      pendingScrollTop = null;
      return;
    }
    attempts += 1;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};
const albums = ref<any[]>([]);
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const artistActiveTab = ref<ArtistTabId>('songs');
let restoringArtistState = false;

let loadVersion = 0;

const {
  showContextMenu,
  contextMenuX,
  contextMenuY,
  contextMenuTargetSong,
  contextMenuResolvedPath,
  contextMenuIsOnlineSearch,
  handleContextMenu: handleMySongContextMenu,
} = useSongContextActions({ isBatchMode });

const title = computed(() => ctx.value?.title || '');
const subtitle = computed(() => ctx.value?.subtitle || '');
const coverUrl = computed(() => ctx.value?.coverUrl || '');
const artistDescription = computed(() => ctx.value?.description || '');
const isLxEngine = computed(() => ctx.value?.engineType === 'lx');

const artistDetailText = computed(() => {
  if (detailType.value !== 'artist') return '';
  const c = ctx.value;
  if (!c) return '';
  const explicit = (c.description || '').trim();
  if (explicit) return explicit;
  const rd = c.rawData;
  if (rd && typeof rd === 'object') {
    return (
      rd.artistDesc || rd.artist_intro || rd.intro || rd.briefDesc
      || rd.description || rd.desc || ''
    ).trim();
  }
  return '';
});
const artistDetailAvailable = computed(() => artistDetailText.value.length > 0);

watch(artistDetailAvailable, (available) => {
  if (!available && artistActiveTab.value === 'details') {
    artistActiveTab.value = 'songs';
  }
});

const isUserMode = computed(() => detailType.value === 'user');

const collectionFavoriteEntry = computed<FavoriteCollectionEntry | null>(() => {
  const c = ctx.value;
  if (!c || isUserMode.value) return null;
  if (c.origin === 'toplist') return null;
  if (detailType.value !== 'playlist' && detailType.value !== 'album') return null;

  const kind = detailType.value;
  const platformId = resolveOnlineCollectionPlatformId(c);
  if (!platformId) return null;

  return {
    key: buildOnlineCollectionKey({ ...c, type: kind }, platformId),
    type: kind,
    title: c.title,
    subtitle: c.subtitle,
    coverUrl: c.coverUrl || '',
    favoritedAt: 0,
    onlineContext: { ...c },
  };
});

const targetUsername = computed(() => {
  const raw = ctx.value?.rawData;
  if (!raw) return '';
  if (typeof raw.ciyuanxi_id === 'string' && raw.ciyuanxi_id) return raw.ciyuanxi_id;
  return typeof raw.username === 'string' ? raw.username : '';
});

const viewedFavorites = ref<Song[]>([]);

const viewedPlaylists = ref<Array<{ id: string; name: string; cloudCoverUrl?: string; songs?: any[] }>>([]);

const userModeLoading = ref(false);

const viewedUserId = computed(() => targetUsername.value || getCiyuanxiId());

const userPlaylists = computed(() => viewedPlaylists.value);

const userPlaylistItems = computed(() =>
  userPlaylists.value.map(playlist => ({
    id: playlist.id,
    name: playlist.name,
    count: Array.isArray(playlist.songs) ? playlist.songs.length : 0,
    cover: playlist.cloudCoverUrl || firstRemoteSongCover(playlist.songs) || '',
  })),
);

const gridItems = computed<any[]>(() => (isUserMode.value ? userPlaylistItems.value : albums.value));

const gridCoverDisplayMap = ref(new Map<string, string>());
function getGridItemCover(item: any): string {
  const url = isUserMode.value ? (item.cover || '') : (item.coverUrl || '');
  if (!url) return '';
  const cached = gridCoverDisplayMap.value.get(url);
  if (cached) return cached;
  return getDisplayCoverUrl(url, (dataUrl) => {
    gridCoverDisplayMap.value = new Map(gridCoverDisplayMap.value).set(url, dataUrl);
  });
}

const userModeSongs = computed<Song[]>(() => viewedFavorites.value);

async function loadUserModeData() {
  const userId = viewedUserId.value;
  if (!userId) {
    hasInitialLoad.value = true;
    return;
  }
  if (userModeLoading.value) return;

  if (!authStore.isLoggedIn) {
    hasInitialLoad.value = true;
    void showLoginRequiredDialog().then((goLogin) => {
      if (goLogin) router.push({ name: 'Auth' });
    });
    return;
  }

  userModeLoading.value = true;
  try {
    const [favorites, playlistsData] = await Promise.all([
      downloadUserFavorites(userId),
      downloadUserPlaylists(userId).catch(() => null),
    ]);
    viewedFavorites.value = [...favorites].reverse();
    viewedPlaylists.value = (playlistsData?.playlists ?? []).map(p => ({
      id: String(p.id ?? ''),
      name: p.name ?? '未知歌单',
      cloudCoverUrl: p.cloudCoverUrl || '',
      songs: p.songs ?? [],
    }));
    favorites.forEach(song => {
      const lookup = libraryStore.songLookup;
      if (!lookup.has(song.path) && song.path) {
        libraryStore.setExtraSong(song);
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(`无法加载用户数据：${msg}`, 'error');
  } finally {
    userModeLoading.value = false;
    hasInitialLoad.value = true;
  }
}

function mfResultToSong(item: PluginSearchResult): Song {
  const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];

  let album = item.album || '';
  if (!album && item.rawData) {
    const raw = item.rawData;
    album = raw.al?.name || raw.album?.name || raw.albumName || '';
  }
  if (!album && detailType.value === 'album' && title.value) {
    album = title.value;
  }
  album = album || '未知专辑';

  let durationMs = item.duration || 0;
  if ((!durationMs || durationMs <= 0) && item.rawData) {
    durationMs = extractDurationMs(item.rawData);
  }

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
    duration: Math.floor((durationMs || 0) / 1000),
    cover_thumb_path: item.coverUrl || '',
    source_type: 'plugin',
    remote_source_id: `plugin://${item.platform}/${item.id}`,
    rawData: item,
  } as any;
}

function lxResultToSong(item: LxSearchResultItem): Song {
  const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
  const songDuration = parseIntervalToSeconds(item.interval);
  const album = item.albumName || (detailType.value === 'album' ? title.value : '') || '未知专辑';
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

const songList = computed<Song[]>(() => {
  if (detailType.value === 'playlist' && ctx.value?.rawData?.userPlaylistSongs) {
    return songs.value as Song[];
  }
  return isLxEngine.value
    ? songs.value.map((item: LxSearchResultItem) => lxResultToSong(item))
    : songs.value.map((item: PluginSearchResult) => mfResultToSong(item));
});

const currentSongs = computed<Song[]>(() =>
  isUserMode.value ? userModeSongs.value : songList.value,
);

// ==================== 分页 ====================
const PAGE_SIZE = 20;
const currentDetailPage = ref(1);
const pageTransitionDirection = ref<'forward' | 'back'>('forward');
const totalDetailPages = computed(() =>
  Math.ceil(currentSongs.value.length / PAGE_SIZE),
);
const pagedSongs = computed(() =>
  currentSongs.value.slice(
    (currentDetailPage.value - 1) * PAGE_SIZE,
    currentDetailPage.value * PAGE_SIZE,
  ),
);
const pageIndexOffset = computed(() => (currentDetailPage.value - 1) * PAGE_SIZE);

function goToDetailPage(page: number) {
  pageTransitionDirection.value = page > currentDetailPage.value ? 'forward' : 'back';
  currentDetailPage.value = page;
  nextTick(() => {
    detailScrollRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

let mfCoverFetchVersion = 0;
const MF_COVER_CONCURRENCY = 3;

async function fetchMissingMfCovers(afterBatch?: Promise<void>) {
  if (!ctx.value) return;
  const { pluginSource } = ctx.value;
  if (!pluginSource) return;
  const version = ++mfCoverFetchVersion;

  if (afterBatch) {
    try { await afterBatch; } catch { /* 忽略，继续逐首兜底 */ }
    if (version !== mfCoverFetchVersion) return;
  }

  const pending: { index: number; item: PluginSearchResult }[] = [];
  songs.value.forEach((item, index) => {
    if ((!item.coverUrl || !item.duration) && item.rawData) {
      pending.push({ index, item });
    }
  });
  if (pending.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const { index, item } = pending[cursor++];
      if (version !== mfCoverFetchVersion) return;
      try {
        const cover = await pluginGetCover(pluginSource, item);
        if (version !== mfCoverFetchVersion) return;
        const current = songs.value[index];
        if (!current) continue;
        const patch: Record<string, any> = {};
        if (cover) {
          patch.coverUrl = String(cover).replace(/^http:\/\//i, 'https://');
        }
        if (item.duration && !current.duration) patch.duration = item.duration;
        if (Object.keys(patch).length > 0) {
          songs.value[index] = { ...current, ...patch };
        }
      } catch { /* ignore */ }
    }
  };

  const workers = Array.from({ length: Math.min(MF_COVER_CONCURRENCY, pending.length) }, () => worker());
  void Promise.all(workers);
}

let mfMetaFetchVersion = 0;

function extractMfSongId(s: PluginSearchResult, isQQ: boolean, isKugou: boolean): string {
  const raw = s.rawData || {};
  if (isQQ) {
    return String(s.id || s.platformId || raw.songmid || raw.mid || raw.songMid || '').trim();
  }
  if (isKugou) {
    for (const c of [s.id, s.platformId, raw.hash, raw.Hash, raw.FileHash, raw.fileHash, raw.mixsongid, raw.MixSongID, raw.audioId, raw.Audioid]) {
      if (c === undefined || c === null) continue;
      const n = String(c).trim();
      if (n) return n;
    }
    return '';
  }
  for (const c of [s.id, s.platformId, raw.rid, raw.musicrid, raw.MUSICRID, raw.musicRid, raw.musicId]) {
    if (c === undefined || c === null) continue;
    const n = String(c).replace(/^MUSIC_/i, '').trim();
    if (n) return n;
  }
  return '';
}

async function backfillMfTrackMeta(onBatchReady?: () => void) {
  const c = ctx.value;
  const pluginSource = c?.pluginSource;
  if (!c || !pluginSource) { onBatchReady?.(); return; }
  const sources = pluginSource.sources || [];
  const name = pluginSource.name || '';
  const isNetease = sources.includes('wy') || /网易云|netease/i.test(name);
  const isQQ = sources.includes('tx') || /qq|企鹅/i.test(name);
  const isKuwo = sources.includes('kw') || /酷我|kuwo/i.test(name);
  const isKugou = sources.includes('kg') || /酷狗|kugou/i.test(name);
  if (!isNetease && !isQQ && !isKuwo && !isKugou) { onBatchReady?.(); return; }

  const version = ++mfMetaFetchVersion;
  const idOk = (id: string) => {
    if (isQQ) return /^[0-9A-Za-z]{6,32}$/.test(id);
    if (isKugou) return /^[0-9A-Fa-f]{32}$/.test(id) || /^\d+$/.test(id);
    return /^\d+$/.test(id);
  };
  const pending = songs.value
    .map((s: PluginSearchResult) => ({ s, id: extractMfSongId(s, isQQ, isKugou) }))
    .filter(({ s, id }) => (!s.coverUrl || !s.duration) && idOk(id));
  if (pending.length === 0) { onBatchReady?.(); return; }

  const kgAlbumId = c.type === 'album' && c.rawData
    ? String(c.rawData.albumId ?? c.rawData.albumid ?? c.rawData.AlbumID ?? c.rawData.id ?? '')
    : '';

  const applyPatches = (map: ReadonlyMap<string, WyTrackMetaPatch>) => {
    if (map.size === 0 || version !== mfMetaFetchVersion) return;
    songs.value = songs.value.map((s: PluginSearchResult) => {
      const patch = map.get(extractMfSongId(s, isQQ, isKugou));
      if (!patch) return s;
      const upd: Record<string, any> = {};
      if (!s.coverUrl && patch.coverUrl) upd.coverUrl = patch.coverUrl.replace(/^http:\/\//i, 'https://');
      if (!s.duration && patch.durationMs) upd.duration = patch.durationMs;
      return Object.keys(upd).length > 0 ? { ...s, ...upd } : s;
    });
  };

  try {
    const patches = isNetease
      ? await fetchWyTrackMetaByIds(pending.map(item => item.id))
      : isQQ
        ? await fetchQqTrackMetaByIds(pending.map(item => item.id))
        : isKugou
          ? await fetchKgTrackMetaByIds(
              pending.map(item => ({ id: item.id, title: item.s.title, artist: item.s.artist })),
              kgAlbumId,
            )
          : await fetchKwTrackMetaByIds(
              pending.map(item => ({ id: item.id, title: item.s.title, artist: item.s.artist })),
              {
                sheetId: c.type === 'playlist' ? String(c.rawData?.id ?? '') : '',
                artistId: c.type === 'artist' ? String(c.rawData?.id ?? '') : '',
                onPatches: (m) => {
                  applyPatches(m);
                  onBatchReady?.();
                },
              },
            );

    applyPatches(patches);
  } finally {
    onBatchReady?.();
  }
}

let lxCoverFetchVersion = 0;
const LX_COVER_CONCURRENCY = 3;

async function fetchMissingLxCovers() {
  if (!ctx.value) return;
  const version = ++lxCoverFetchVersion;

  const pending: { index: number; item: LxSearchResultItem }[] = [];
  songs.value.forEach((item: LxSearchResultItem, index: number) => {
    if (!item.img) pending.push({ index, item });
  });
  if (pending.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const { index, item } = pending[cursor++];
      if (version !== lxCoverFetchVersion) return;
      try {
        const context = ctx.value;
        let cover: string | null = null;
        if (context?.engineType === 'lx' && context.pluginSource && context.lxSourceId) {
          await ensureLxPluginInstance(context.pluginSource);
          cover = await lxPluginGetPic(context.pluginSource, context.lxSourceId, item);
        }
        if (!cover) cover = await lxGetPic(item);
        if (version !== lxCoverFetchVersion) return;
        if (cover && songs.value[index]) {
          songs.value[index] = { ...songs.value[index], img: cover };
        }
      } catch { /* ignore */ }
    }
  };

  const workers = Array.from({ length: Math.min(LX_COVER_CONCURRENCY, pending.length) }, () => worker());
  void Promise.all(workers);
}

function deriveAlbumsFromMfSongs(songResults: PluginSearchResult[]): PluginAlbumResult[] {
  const albumMap = new Map<string, PluginAlbumResult>();
  for (const song of songResults) {
    const albumName = song.album || '';
    if (!albumName) continue;
    const key = albumName.toLowerCase();
    const existing = albumMap.get(key);
    if (existing) {
      existing.songCount = (existing.songCount ?? 0) + 1;
      if (!existing.coverUrl && song.coverUrl) existing.coverUrl = song.coverUrl;
      continue;
    }
    albumMap.set(key, {
      id: String(song.rawData?.albumId || song.rawData?.al?.id || albumName),
      name: albumName,
      artist: song.artist || '',
      coverUrl: song.coverUrl || '',
      platform: song.platform || '',
      platformId: String(song.rawData?.albumId || song.rawData?.al?.id || albumName),
      pluginId: '',
      rawData: song.rawData,
    });
  }
  return [...albumMap.values()];
}

async function loadData(page = 1) {
  if (!ctx.value) return;
  if (isUserMode.value) return;
  const version = ++loadVersion;
  loading.value = true;
  try {
    const userPlSongs = ctx.value.rawData?.userPlaylistSongs;
    if (detailType.value === 'playlist' && Array.isArray(userPlSongs)) {
      if (version !== loadVersion) return;
      const restored = (page === 1 ? userPlSongs : [...songs.value, ...userPlSongs]).map(syncPayloadToSong);
      songs.value = restored;
      const lookup = libraryStore.songLookup;
      restored.forEach(song => {
        if (!lookup.has(song.path) && song.path) {
          libraryStore.setExtraSong(song);
        }
      });
    } else if (isLxEngine.value && ctx.value.lxSourceId) {
      await loadLxData(page, version);
    } else {
      await loadMfData(page, version);
    }
  } catch (e: any) {
    showToast(`加载失败: ${e?.message || e}`, 'error');
  } finally {
    if (version === loadVersion) {
      loading.value = false;
    }
    if (page === 1) {
      currentDetailPage.value = 1;
    }
    hasInitialLoad.value = true;
  }

  if (ctx.value?.rawData?.userPlaylistSongs && detailType.value === 'playlist') return;
  if (version !== loadVersion) return;
  if (isLxEngine.value) {
    if (songs.value.some((s: LxSearchResultItem) => !s.img)) {
      void fetchMissingLxCovers();
    }
  } else {
    let signalBatchReady: (() => void) | null = null;
    const batchReady = new Promise<void>(resolve => { signalBatchReady = resolve; });
    void backfillMfTrackMeta(() => signalBatchReady?.());
    if (songs.value.some((s: PluginSearchResult) => !s.coverUrl || !s.duration)) {
      void fetchMissingMfCovers(batchReady);
    }
  }
}

// ==================== LX (落雪) 引擎数据加载 ====================

async function loadLxData(page: number, version: number) {
  if (!ctx.value?.lxSourceId) return;
  const source = ctx.value.lxSourceId as LxSourceId;
  const { type, rawData } = ctx.value;

  if (type === 'artist') {
    if (artistActiveTab.value === 'songs') {
      const result = await lxSearch(source, title.value, page);
      if (version !== loadVersion) return;
      if (page === 1) songs.value = result.list;
      else songs.value = [...songs.value, ...result.list];
    } else if (artistActiveTab.value === 'albums') {
      const albumResults = await lxCatalogSearch(source, title.value, 'album', page) as LxAlbumSearchResult[];
      if (version !== loadVersion) return;
      if (page === 1) albums.value = albumResults;
      else albums.value = [...albums.value, ...albumResults];
    }
  } else if (type === 'album') {
    let results = await lxGetAlbumSongs(source, rawData, page);
    if (results.length === 0 && page === 1) {
      console.warn(`[OnlineDetail] LX album direct API empty, falling back to search for "${title.value}"`);
      const albumNameNorm = title.value.trim().toLowerCase();
      const searchResult = await lxSearch(source, title.value, page);
      results = searchResult.list.filter((s: LxSearchResultItem) => {
        const songAlbumNorm = (s.albumName || '').trim().toLowerCase();
        return songAlbumNorm === albumNameNorm || songAlbumNorm.includes(albumNameNorm) || albumNameNorm.includes(songAlbumNorm);
      });
      if (results.length === 0) {
        results = searchResult.list;
      }
    }
    if (version !== loadVersion) return;
    if (page === 1) songs.value = results;
    else songs.value = [...songs.value, ...results];
  } else if (type === 'playlist') {
    if (page === 1) {
      let allTracks: LxSearchResultItem[] = [];
      let currentPage = 1;
      const MAX_PAGES = 50;
      while (currentPage <= MAX_PAGES) {
        const { list, isEnd } = await lxGetPlaylistTracks(source, rawData, currentPage);
        if (version !== loadVersion) return;
        if (list.length === 0) break;
        allTracks = [...allTracks, ...list];
        if (isEnd) break;
        currentPage++;
      }
      songs.value = allTracks;
    } else {
      const { list } = await lxGetPlaylistTracks(source, rawData, page);
      if (version !== loadVersion) return;
      songs.value = [...songs.value, ...list];
    }
    if (songs.value.length === 0 && page === 1) {
      console.warn(`[OnlineDetail] LX playlist direct API empty, falling back to search for "${title.value}"`);
      const searchResult = await lxSearch(source, title.value, page);
      if (version !== loadVersion) return;
      songs.value = searchResult.list;
    }
  }
}

// ==================== MusicFree 引擎数据加载 ====================

async function loadMfData(page: number, version: number) {
  if (!ctx.value) return;
  const { type, rawData, pluginSource } = ctx.value;
  if (!pluginSource) return;

  if (type === 'artist') {
    if (artistActiveTab.value === 'songs') {
      const results = await pluginGetArtistWorks(pluginSource, rawData, page);
      if (version !== loadVersion) return;
      if (page === 1) songs.value = results;
      else songs.value = [...songs.value, ...results];
    } else if (artistActiveTab.value === 'albums') {
      let albumResults = await pluginGetArtistAlbums(pluginSource, rawData, page);
      if (albumResults.length === 0 && page === 1) {
        console.warn(`[OnlineDetail] MF getArtistWorks('album') empty, trying pluginAlbumSearch for "${title.value}"`);
        albumResults = await pluginAlbumSearch(pluginSource, title.value, page);
      }
      if (albumResults.length === 0 && page === 1) {
        console.warn(`[OnlineDetail] MF pluginAlbumSearch empty, deriving albums from songs for "${title.value}"`);
        const songResults = await pluginGetArtistWorks(pluginSource, rawData, page);
        albumResults = deriveAlbumsFromMfSongs(songResults);
      }
      if (version !== loadVersion) return;
      if (page === 1) albums.value = albumResults;
      else albums.value = [...albums.value, ...albumResults];
    }
  } else if (type === 'album') {
    const results = await pluginGetAlbumSongs(pluginSource, rawData, page);
    if (version !== loadVersion) return;
    if (page === 1) songs.value = results;
    else songs.value = [...songs.value, ...results];
  } else if (type === 'playlist') {
    if (page === 1) {
      let allSongs: PluginSearchResult[] = [];
      let currentPage = 1;
      const MAX_PAGES = 50;
      while (currentPage <= MAX_PAGES) {
        const { songs: pageSongs, isEnd } = await pluginGetPlaylistDetailWithEnd(pluginSource, rawData, currentPage);
        if (version !== loadVersion) return;
        if (pageSongs.length === 0) break;
        allSongs = [...allSongs, ...pageSongs];
        if (isEnd) break;
        currentPage++;
      }
      songs.value = allSongs;
    } else {
      const results = await pluginGetPlaylistDetail(pluginSource, rawData, page);
      if (version !== loadVersion) return;
      songs.value = [...songs.value, ...results];
    }
  }
}

async function handlePlayAll() {
  if (!ctx.value || currentSongs.value.length === 0) {
    showToast('暂无可播放的歌曲', 'info');
    return;
  }

  try {
    const firstSong = currentSongs.value[0];

    if (isLxEngine.value) {
      for (const song of currentSongs.value) {
        const lxItem = (song as any).rawData as LxSearchResultItem | undefined;
        if (!lxItem) continue;
        cacheLxSong(lxItem);
        const dur = parseIntervalToSeconds(lxItem.interval);
        cacheLxSongInfo(lxItem.source, lxItem.songmid, {
          songmid: lxItem.songmid,
          hash: lxItem.hash,
          name: lxItem.name,
          singer: lxItem.singer,
          albumName: lxItem.albumName,
          interval: lxItem.interval,
          _interval: dur > 0 ? Math.round(dur) : undefined,
          songId: lxItem.songId,
          strMediaMid: lxItem.strMediaMid,
          albumMid: lxItem.albumMid,
          albumId: lxItem.albumId,
          copyrightId: lxItem.copyrightId,
          source: lxItem.source,
        });
      }
    }

    launchFlyingCover(firstSong.path, firstSong.cover_thumb_path || '');

    await clearQueue();
    addSongsToQueue(currentSongs.value);

    await playSong(firstSong, { preserveQueue: true });
  } catch (e: any) {
    showToast(`播放失败: ${e?.message || e}`, 'error');
  }
}

function handleAddToPlaylist() {
  if (currentSongs.value.length === 0) {
    showToast('暂无可收藏的歌曲', 'info');
    return;
  }

  for (const song of currentSongs.value) {
    libraryStore.setExtraSong(song);
  }

  const songPaths = currentSongs.value.map(s => s.path);
  openAddToPlaylistDialog(songPaths, { songs: currentSongs.value });
}

function handleSelectAll() {
  const allPaths = currentSongs.value.map(s => s.path);
  if (allPaths.length > 0 && selectedPaths.value.size === allPaths.length) {
    selectedPaths.value = new Set();
  } else {
    selectedPaths.value = new Set(allPaths);
  }
}

const handlePlaySong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
};

function handleContextMenuAddToPlaylist() {
  const song = contextMenuTargetSong.value;
  if (!song) return;
  libraryStore.setExtraSong(song);
  openAddToPlaylistDialog([song.path], { songs: [song] });
}

function resetTransientUiState() {
  cancelPendingTasks();
  isBatchMode.value = false;
  selectedPaths.value = new Set();
}

let lastHandledNavToken = 0;

function pushDetail(context: Parameters<typeof openOnlineDetail>[0]) {
  const inFlow = router.currentRoute.value.path === '/online-detail';
  const isStateful = ctx.value?.type === 'artist' || ctx.value?.type === 'user';
  const d = openOnlineDetail(context, isStateful ? captureState() : undefined);
  if (inFlow) {
    lastHandledNavToken = d;
    resetTransientUiState();
    loadFrameFresh(context.type);
  }
}

function captureState(): OnlineDetailStateCache {
  const state: OnlineDetailStateCache = {
    songs: songs.value,
    albums: albums.value,
    activeTab: artistActiveTab.value,
    scrollTop: detailScrollRef.value?.scrollTop || 0,
  };
  if (isUserMode.value) {
    state.userFavorites = viewedFavorites.value;
    state.userPlaylists = viewedPlaylists.value;
  }
  return state;
}

async function handleOnlineViewArtist(song: Song) {
  if (!ctx.value) return;
  const artistName = song.effective_artist_names?.[0] || song.artist_names?.[0] || song.artist || '';
  if (!artistName || artistName === '未知歌手') {
    showToast('当前歌曲缺少歌手信息', 'info');
    return;
  }

  if (isUserMode.value) {
    void openHomeArtist(artistName);
    return;
  }

  try {
    if (isLxEngine.value && ctx.value.lxSourceId) {
      const source = ctx.value.lxSourceId as LxSourceId;
      const results = await lxCatalogSearch(source, artistName, 'artist', 1) as LxArtistSearchResult[];
      if (results.length === 0) {
        showToast('未找到该歌手', 'info');
        return;
      }
      const artist = results[0];
      pushDetail({
        type: 'artist',
        title: artist.name,
        subtitle: artist.songCount ? `${artist.songCount} 首歌曲` : '',
        coverUrl: artist.avatarUrl,
        pluginSource: ctx.value.pluginSource,
        rawData: artist.rawData,
        platformId: (artist as any).platformId || artist.id,
        engineType: 'lx',
        lxSourceId: ctx.value.lxSourceId,
      });
    } else {
      if (!ctx.value.pluginSource) {
        showToast('当前歌曲缺少歌手信息', 'info');
        return;
      }
      const results = await pluginArtistSearch(ctx.value.pluginSource, artistName, 1);
      if (results.length === 0) {
        showToast('未找到该歌手', 'info');
        return;
      }
      const artist = results[0];
      pushDetail({
        type: 'artist',
        title: artist.name,
        subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
        description: artist.description || '',
        coverUrl: artist.avatarUrl,
        pluginSource: ctx.value.pluginSource,
        rawData: artist.rawData,
        platformId: artist.platformId || artist.id,
        engineType: 'musicfree',
      });
    }
  } catch (e: any) {
    showToast(`查看歌手失败: ${e?.message || e}`, 'error');
  }
}

async function handleOnlineViewAlbum(song: Song) {
  if (!ctx.value) return;
  const albumName = song.album || '';
  if (!albumName || albumName === '未知专辑') {
    showToast('当前歌曲缺少专辑信息', 'info');
    return;
  }

  if (isUserMode.value) {
    void openHomeAlbum(getSongAlbumKey(song));
    return;
  }

  try {
    if (isLxEngine.value && ctx.value.lxSourceId) {
      const source = ctx.value.lxSourceId as LxSourceId;
      const results = await lxCatalogSearch(source, albumName, 'album', 1) as LxAlbumSearchResult[];
      if (results.length === 0) {
        showToast('未找到该专辑', 'info');
        return;
      }
      const album = results[0];
      pushDetail({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource: ctx.value.pluginSource,
        rawData: album.rawData,
        platformId: (album as any).platformId || album.id,
        engineType: 'lx',
        lxSourceId: ctx.value.lxSourceId,
      });
    } else {
      if (!ctx.value.pluginSource) {
        showToast('当前歌曲缺少专辑信息', 'info');
        return;
      }
      const results = await pluginAlbumSearch(ctx.value.pluginSource, albumName, 1);
      if (results.length === 0) {
        showToast('未找到该专辑', 'info');
        return;
      }
      const album = results[0];
      pushDetail({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource: ctx.value.pluginSource,
        rawData: album.rawData,
        platformId: album.platformId || album.id,
        engineType: 'musicfree',
      });
    }
  } catch (e: any) {
    showToast(`查看专辑失败: ${e?.message || e}`, 'error');
  }
}

function handleAlbumClick(album: any) {
  if (!ctx.value) return;
  if (!ctx.value.pluginSource) return;
  const isLx = isLxEngine.value && ctx.value.lxSourceId;
  pushDetail({
    type: 'album',
    title: album.name,
    subtitle: album.artist,
    coverUrl: album.coverUrl,
    pluginSource: ctx.value.pluginSource,
    rawData: album.rawData,
    platformId: album.platformId || album.id,
    ...(isLx ? { engineType: 'lx' as const, lxSourceId: ctx.value.lxSourceId } : { engineType: 'musicfree' as const }),
  });
}

function handleUserPlaylistClick(playlistId: string) {
  const playlist = viewedPlaylists.value.find(p => p.id === playlistId);
  if (!playlist) return;
  const songs = playlist.songs ?? [];
  pushDetail({
    type: 'playlist',
    title: playlist.name,
    subtitle: `${songs.length} 首歌曲`,
    coverUrl: playlist.cloudCoverUrl || firstRemoteSongCover(songs) || '',
    engineType: 'musicfree',
    rawData: { userPlaylistSongs: songs },
    platformId: playlist.id,
  });
}

function handleBack() {
  if (onlineDetailStore.canPopDetail()) {
    const frame = onlineDetailStore.popDetail();
    if (frame) {
      lastHandledNavToken = frame.d;
      resetTransientUiState();
      if (frame.state && (frame.context.type === 'artist' || frame.context.type === 'user')) {
        restoreFrame(frame.state);
      } else {
        loadFrameFresh(frame.context.type);
      }
      void router.replace({
        path: '/online-detail',
        query: { type: frame.context.type, d: String(frame.d) },
      });
      return;
    }
  }
  void router.back();
}

onMounted(() => {
  if (!ctx.value) {
    showToast('详情数据不可用，请从搜索页进入', 'info');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!ctx.value) void router.replace('/search');
    }));
    return;
  }
  if (isUserMode.value) {
    void loadUserModeData();
  } else {
    void loadData(1);
  }
});

function cancelPendingTasks() {
  loadVersion += 1;
  mfCoverFetchVersion += 1;
  lxCoverFetchVersion += 1;
  mfMetaFetchVersion += 1;
}

function resetContentState() {
  songs.value = [];
  albums.value = [];
  viewedFavorites.value = [];
  viewedPlaylists.value = [];
}

function loadFrameFresh(type: OnlineDetailType) {
  resetContentState();
  pendingScrollTop = 0;
  if (type === 'artist' || type === 'user') {
    restoringArtistState = true;
    artistActiveTab.value = 'songs';
    void nextTick(() => { restoringArtistState = false; });
  }
  if (type === 'user') {
    void loadUserModeData();
  } else {
    void loadData(1);
  }
}

function restoreFrame(state: OnlineDetailStateCache) {
  songs.value = state.songs;
  albums.value = state.albums;
  if (state.userFavorites) viewedFavorites.value = state.userFavorites;
  if (state.userPlaylists) viewedPlaylists.value = state.userPlaylists;
  hasInitialLoad.value = true;
  restoringArtistState = true;
  artistActiveTab.value = state.activeTab as ArtistTabId;
  void nextTick(() => { restoringArtistState = false; });
  pendingScrollTop = state.scrollTop;
  if (isLxEngine.value) {
    if (songs.value.some((s: LxSearchResultItem) => !s.img)) {
      void fetchMissingLxCovers();
    }
  } else if (songs.value.some((s: PluginSearchResult) => !s.coverUrl || !s.duration)) {
    void fetchMissingMfCovers();
  }
}

onBeforeUnmount(() => {
  cancelPendingTasks();
  onlineDetailStore.clearDetailFlow();
  const dest = router.currentRoute.value;
  if (dest.path === '/search') {
    onlineDetailStore.clearTopListsCache();
  } else if (dest.path === '/' && dest.query.view === 'topLists') {
    onlineDetailStore.clearSearchPageCache();
  } else {
    onlineDetailStore.clearSearchPageCache();
    onlineDetailStore.clearTopListsCache();
  }
});

watch(() => Number(route.query.d ?? 0), (newD) => {
  if (!ctx.value) return;
  if (newD === lastHandledNavToken) return;
  lastHandledNavToken = newD;
  resetTransientUiState();
  const isStateful = ctx.value?.type === 'artist' || ctx.value?.type === 'user';
  if (isStateful) onlineDetailStore.setTopFrameState(captureState());
  loadFrameFresh(detailType.value);
});

watch(artistActiveTab, () => {
  if (restoringArtistState) return;
  if (detailType.value === 'artist' && ctx.value) {
    songs.value = [];
    albums.value = [];
    void loadData(1);
  }
});

watch(
  () =>
    detailType.value === 'artist' && ctx.value
      ? `${ctx.value.title}|${ctx.value.rawData?.id ?? ''}`
      : '',
  async (key) => {
    if (!key) return;
    const c = ctx.value;
    if (!c || c.engineType === 'lx') return;
    if ((c.description || '').trim()) return;
    if (!c.pluginSource || !c.rawData) return;
    try {
      const desc = await pluginGetArtistInfo(c.pluginSource, c.rawData);
      if (desc && ctx.value === c) c.description = desc;
    } catch {
      /* 拿不到简介则留空，不影响现有功能 */
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="px-4 py-2 shrink-0 flex items-center gap-2 z-20">
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
        @click="handleBack"
      >
        <ArrowLeft class="h-4 w-4" />
        返回
      </button>
    </div>

    <div v-if="!ctx" class="flex-1 flex items-center justify-center text-black/30 dark:text-white/30">
      <p class="text-sm">详情数据不可用</p>
    </div>

    <div v-else-if="!hasInitialLoad" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
        <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-sm">正在加载…</p>
      </div>
    </div>

    <div v-else class="flex-1 min-h-0 relative flex flex-col">
      <div
        ref="detailScrollRef"
        class="flex-1 min-h-0 overflow-y-auto custom-scrollbar relative"
        @wheel="cancelPendingScroll"
        @touchmove="cancelPendingScroll"
      >
      <Transition name="detail-slide" mode="out-in" @enter="handleDetailEnter">
        <div v-if="detailType === 'artist' || detailType === 'user'" :key="`artist-${ctx?.platformId ?? ''}-d${navToken}`" class="relative z-20">
          <ArtistDetailHeader
            v-model:isBatchMode="isBatchMode"
            v-model:activeTab="artistActiveTab"
            :artistName="title"
            :description="artistDescription"
            :hasArtistDetail="artistDetailAvailable"
            :rawData="ctx?.rawData"
            :songs="currentSongs"
            :selectedCount="selectedPaths.size"
            :totalSongCount="currentSongs.length"
            :readOnly="true"
            :coverUrlOverride="coverUrl"
            :tabNameOverrides="isUserMode ? { songs: '收藏', albums: '歌单' } : undefined"
            @playAll="handlePlayAll"
            @selectAll="handleSelectAll"
          />

          <div class="relative">
          <Transition name="tab-fade" mode="out-in">
            <div v-if="artistActiveTab === 'songs'" key="songs">
              <Transition :name="pageTransitionDirection === 'forward' ? 'page-slide-forward' : 'page-slide-back'" mode="out-in">
                <div :key="currentDetailPage">
                  <SongTable
                    :songs="pagedSongs"
                    :indexOffset="pageIndexOffset"
                    :is-batch-mode="isBatchMode"
                    :selected-paths="selectedPaths"
                    :memory-scope-key="(isUserMode ? 'online-detail-user' : 'online-detail-artist') + '::' + detailMemoryKey + '::d' + navToken"
                    page-scroll-mode
                    :scroll-container-ref="detailScrollRef"
                    @play="handlePlaySong"
                    @contextmenu="handleMySongContextMenu"
                    @update:selectedPaths="selectedPaths = $event"
                  />
                </div>
              </Transition>
              <div v-if="totalDetailPages > 1" class="flex items-center justify-center gap-3 py-5 select-none">
                <button
                  class="px-3 py-1 rounded-lg text-sm text-gray-500 dark:text-white/50 hover:text-[#ec4141] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  :disabled="currentDetailPage === 1"
                  @click="goToDetailPage(currentDetailPage - 1)"
                >上一页</button>
                <span class="text-sm text-gray-500 dark:text-white/50">{{ currentDetailPage }} / {{ totalDetailPages }}</span>
                <button
                  class="px-3 py-1 rounded-lg text-sm text-gray-500 dark:text-white/50 hover:text-[#ec4141] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  :disabled="currentDetailPage === totalDetailPages"
                  @click="goToDetailPage(currentDetailPage + 1)"
                >下一页</button>
              </div>
            </div>

            <div v-else-if="artistActiveTab === 'albums'" key="albums" class="p-4 md:p-6 lg:p-8">
              <div v-if="gridItems.length > 0" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10">
                <div
                  v-for="item in gridItems"
                  :key="item.id"
                  class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5"
                  @click="isUserMode ? handleUserPlaylistClick(item.id) : handleAlbumClick(item)"
                >
                  <div class="relative w-full aspect-square mb-3 mt-1">
                    <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
                      <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
                      <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
                      <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
                    </div>
                    <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
                      <img
                        v-if="getGridItemCover(item)"
                        :src="getGridItemCover(item)"
                        class="w-full h-full object-cover rounded-sm"
                        alt=""
                        loading="lazy"
                        @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'"
                      />
                      <div
                        v-if="!getGridItemCover(item)"
                        class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
                      >
                        {{ item.name ? item.name.charAt(0).toUpperCase() : (isUserMode ? 'P' : 'A') }}
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-col items-start px-1 z-20">
                    <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">
                      {{ item.name }}
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 opacity-80">
                      {{ isUserMode ? `${item.count} 首歌曲` : item.artist }}
                    </p>
                  </div>
                </div>
              </div>
              <div v-else class="flex flex-col items-center justify-center py-20 text-black/30 dark:text-white/30">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <p class="text-sm">{{ isUserMode ? '暂无歌单' : '暂无专辑' }}</p>
              </div>
            </div>

            <div v-else-if="artistActiveTab === 'details'" key="details" class="p-4 md:p-6 lg:p-8">
              <div class="max-w-3xl">
                <h3 class="font-bold text-base text-gray-900 dark:text-white mb-3">歌手详情</h3>
                <div class="text-[13.5px] leading-[1.9] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-5 py-4 whitespace-pre-line break-words min-h-[120px]">
                  {{ artistDetailText }}
                </div>
              </div>
            </div>
          </Transition>
          </div>
        </div>

        <div v-else-if="detailType === 'album'" :key="`album-${ctx?.platformId ?? ''}-d${navToken}`" class="relative z-20">
          <AlbumDetailHeader
            v-model:isBatchMode="isBatchMode"
            :albumName="title"
            :albumArtist="subtitle"
            :songs="currentSongs"
            :selectedCount="selectedPaths.size"
            :totalSongCount="currentSongs.length"
            :readOnly="true"
            :coverUrlOverride="coverUrl"
            :favoriteEntry="collectionFavoriteEntry"
            @playAll="handlePlayAll"
            @addToPlaylist="handleAddToPlaylist"
            @selectAll="handleSelectAll"
          />
          <div class="relative">
            <Transition :name="pageTransitionDirection === 'forward' ? 'page-slide-forward' : 'page-slide-back'" mode="out-in">
              <div :key="currentDetailPage">
                <SongTable
                  :songs="pagedSongs"
                  :indexOffset="pageIndexOffset"
                  :is-batch-mode="isBatchMode"
                  :selected-paths="selectedPaths"
                  memory-scope-key="'online-detail-album::' + detailMemoryKey + '::d' + navToken"
                  page-scroll-mode
                  :scroll-container-ref="detailScrollRef"
                  :disable-scroll-memory="true"
                  @play="handlePlaySong"
                  @contextmenu="handleMySongContextMenu"
                  @update:selectedPaths="selectedPaths = $event"
                />
              </div>
            </Transition>
            <div v-if="totalDetailPages > 1" class="flex items-center justify-center gap-3 py-5 select-none">
              <button
                class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-white/5 hover:bg-white/10 dark:bg-white/5 dark:hover:bg-white/10 text-gray-600 dark:text-white/60 hover:text-[#ec4141] dark:hover:text-[#ec4141] border border-black/5 dark:border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                :disabled="currentDetailPage === 1"
                @click="goToDetailPage(currentDetailPage - 1)"
              >
                <ChevronLeft class="w-4 h-4" />
                上一页
              </button>
              <span class="px-3 py-1.5 rounded-full text-sm font-mono text-gray-500 dark:text-white/40 bg-white/5 dark:bg-white/5 border border-black/5 dark:border-white/10 min-w-[4rem] text-center">
                {{ currentDetailPage }} / {{ totalDetailPages }}
              </span>
              <button
                class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-white/5 hover:bg-white/10 dark:bg-white/5 dark:hover:bg-white/10 text-gray-600 dark:text-white/60 hover:text-[#ec4141] dark:hover:text-[#ec4141] border border-black/5 dark:border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                :disabled="currentDetailPage === totalDetailPages"
                @click="goToDetailPage(currentDetailPage + 1)"
              >
                下一页
                <ChevronRight class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="detailType === 'playlist'" :key="`playlist-${ctx?.platformId ?? ''}-d${navToken}`" class="relative z-20">
          <DetailHeader
            :title="title"
            :subtitle="subtitle"
            :songs="currentSongs"
            :isBatchMode="isBatchMode"
            :selectedCount="selectedPaths.size"
            :totalSongCount="currentSongs.length"
            :readOnly="true"
            :coverUrlOverride="coverUrl"
            :favoriteEntry="collectionFavoriteEntry"
            @playAll="handlePlayAll"
            @openAddToPlaylist="handleAddToPlaylist"
            @selectAll="handleSelectAll"
          />
          <div class="relative">
            <Transition :name="pageTransitionDirection === 'forward' ? 'page-slide-forward' : 'page-slide-back'" mode="out-in">
              <div :key="currentDetailPage">
                <SongTable
                  :songs="pagedSongs"
                  :indexOffset="pageIndexOffset"
                  :is-batch-mode="isBatchMode"
                  :selected-paths="selectedPaths"
                  memory-scope-key="'online-detail-playlist::' + detailMemoryKey + '::d' + navToken"
                  page-scroll-mode
                  :scroll-container-ref="detailScrollRef"
                  :disable-scroll-memory="true"
                  @play="handlePlaySong"
                  @contextmenu="handleMySongContextMenu"
                  @update:selectedPaths="selectedPaths = $event"
                />
              </div>
            </Transition>
            <div v-if="totalDetailPages > 1" class="flex items-center justify-center gap-3 py-5 select-none">
              <button
                class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-white/5 hover:bg-white/10 dark:bg-white/5 dark:hover:bg-white/10 text-gray-600 dark:text-white/60 hover:text-[#ec4141] dark:hover:text-[#ec4141] border border-black/5 dark:border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                :disabled="currentDetailPage === 1"
                @click="goToDetailPage(currentDetailPage - 1)"
              >
                <ChevronLeft class="w-4 h-4" />
                上一页
              </button>
              <span class="px-3 py-1.5 rounded-full text-sm font-mono text-gray-500 dark:text-white/40 bg-white/5 dark:bg-white/5 border border-black/5 dark:border-white/10 min-w-[4rem] text-center">
                {{ currentDetailPage }} / {{ totalDetailPages }}
              </span>
              <button
                class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-white/5 hover:bg-white/10 dark:bg-white/5 dark:hover:bg-white/10 text-gray-600 dark:text-white/60 hover:text-[#ec4141] dark:hover:text-[#ec4141] border border-black/5 dark:border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                :disabled="currentDetailPage === totalDetailPages"
                @click="goToDetailPage(currentDetailPage + 1)"
              >
                下一页
                <ChevronRight class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

      </Transition>
    </div>

    <SongContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="false"
      :is-online-search="contextMenuIsOnlineSearch"
      :resolved-file-path="contextMenuResolvedPath"
      :online-detail-type="detailType"
      @close="showContextMenu = false"
      @add-to-playlist="handleContextMenuAddToPlaylist"
      @view-online-artist="handleOnlineViewArtist"
      @view-online-album="handleOnlineViewAlbum"
    />
  </div>
</div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.detail-slide-enter-active {
  transition: opacity 280ms cubic-bezier(0.25, 0.8, 0.25, 1), transform 280ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.detail-slide-leave-active {
  pointer-events: none;
  transition: opacity 200ms ease, transform 200ms ease;
}
.detail-slide-enter-from {
  opacity: 0;
  transform: translateX(32px);
}
.detail-slide-leave-to {
  opacity: 0;
  transform: translateX(-32px);
}

.tab-fade-enter-active {
  transition: opacity 240ms cubic-bezier(0.25, 0.8, 0.25, 1), transform 240ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.tab-fade-leave-active {
  pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease;
}
.tab-fade-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}

.page-slide-forward-enter-active,
.page-slide-back-enter-active {
  transition: opacity 200ms ease, transform 200ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.page-slide-forward-leave-active,
.page-slide-back-leave-active {
  pointer-events: none;
  transition: opacity 140ms ease, transform 140ms ease;
}
.page-slide-forward-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.page-slide-forward-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
.page-slide-back-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
.page-slide-back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
