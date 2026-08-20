<script setup lang="ts">
import { defineAsyncComponent, ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';

import type { Song, PluginSearchResult } from '../types';
import { useOnlineDetailStore, type OnlineDetailType, type ArtistDetailStateCache } from '../features/onlineDetail/store';
import {
  buildOnlineCollectionKey,
  resolveOnlineCollectionPlatformId,
  type FavoriteCollectionEntry,
} from '../features/collections/store';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryStore } from '../features/library/store';
import { useToast } from '../composables/toast';
import { launchFlyingCover } from '../composables/useFlyingCover';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { downloadFavorites as downloadUserFavorites } from '../services/favoritesSync';
import {
  fetchWyTrackMetaByIds,
  fetchQqTrackMetaByIds,
  fetchKwTrackMetaByIds,
  fetchKgTrackMetaByIds,
  type WyTrackMetaPatch,
} from '../services/playlistImport';
import { fileSyncDownload as downloadUserPlaylists, syncPayloadToSong, firstRemoteSongCover } from '../services/playlistSync';
import { getCiyuanxiId } from '../services/playlistSync';
import { getSongAlbumKey } from '../features/library/playerLibraryViewShared';
import { getDisplayCoverUrl } from '../utils/coverProxy';
import {
  pluginGetArtistWorks,
  pluginGetArtistAlbums,
  pluginGetArtistInfo,
  pluginGetAlbumSongs,
  pluginGetPlaylistDetail,
  pluginGetCover,
  pluginArtistSearch,
  pluginAlbumSearch,
  type PluginAlbumResult,
} from '../services/pluginEngine';
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
} from '../services/lxMusicSdk';
import { ensureLxPluginInstance, lxPluginGetPic } from '../services/lxPluginEngine';
import { cacheLxSong } from '../services/lxSongCache';
import { cacheLxSongInfo } from '../services/lxLyricFetcher';
import { parseIntervalToSeconds } from '../utils/remoteSong';
import { extractDurationMs } from '../services/pluginResultMappers';

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
const onlineDetailStore = useOnlineDetailStore();
const { openHomeArtist, openHomeAlbum } = useHomeNavigation(router);

const detailType = computed<OnlineDetailType>(() => (route.query.type as OnlineDetailType) || 'artist');
const ctx = computed(() => onlineDetailStore.context);

const loading = ref(false);
/** 初始加载是否完成：完成后 Transition 始终留在 DOM 中，保证切换有动画 */
const hasInitialLoad = ref(false);
/** 整页滚动容器：header 与歌曲列表一起滚动 */
const detailScrollRef = ref<HTMLElement | null>(null);
/**
 * 内容唯一滚动记忆键：基于当前上下文的平台 ID 生成，
 * 避免同类型不同内容（专辑 A→专辑 B）互相继承滚动位置。
 * platformId 提取不到时回退到标题，确保不同内容仍有独立 key。
 */
const detailMemoryKey = computed(() => {
  const c = ctx.value;
  if (!c) return '';
  const platformId = resolveOnlineCollectionPlatformId(c);
  return platformId || c.title || '';
});
/** 歌曲列表：MF 引擎存 PluginSearchResult，LX 引擎存 LxSearchResultItem */
const songs = ref<any[]>([]);
/** 专辑列表：MF 引擎存 PluginAlbumResult，LX 引擎存 LxAlbumSearchResult */
const albums = ref<any[]>([]);
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const artistActiveTab = ref<ArtistTabId>('songs');
/** 从专辑详情返回歌手详情恢复 tab 期间置位：抑制 artistActiveTab 变化触发的重复加载（数据已随状态恢复） */
let restoringArtistState = false;

/** 竞态条件防护：每次 loadData 递增，异步回调中检查版本号防止旧数据覆盖新数据 */
let loadVersion = 0;

// 右键菜单状态（自动区分本地/在线歌曲，已下载在线歌曲索引至本地文件）
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

// 歌手简介文本：优先用已拉取的 description，缺失时从原始数据回退常见简介字段
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
/** 是否有可展示的歌手简介：无则隐藏"详情" tab（无对应 API 的插件默认不显示） */
const artistDetailAvailable = computed(() => artistDetailText.value.length > 0);

// 简介为空时若正停留在"详情" tab，回退到歌曲 tab，避免空页面残留
watch(artistDetailAvailable, (available) => {
  if (!available && artistActiveTab.value === 'details') {
    artistActiveTab.value = 'songs';
  }
});

/** 用户详情模式（排行榜"查看"进入）：展示被查看用户的云收藏与云歌单 */
const isUserMode = computed(() => detailType.value === 'user');

/** 当前在线歌单/专辑的"收藏整张"条目（歌手/用户详情页与榜单详情不提供） */
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

/** 用户详情：被查看用户的弦予号（云同步查询键），优先取 rawData.ciyuanxi_id，回退 username */
const targetUsername = computed(() => {
  const raw = ctx.value?.rawData;
  if (!raw) return '';
  if (typeof raw.ciyuanxi_id === 'string' && raw.ciyuanxi_id) return raw.ciyuanxi_id;
  return typeof raw.username === 'string' ? raw.username : '';
});

/** 用户详情：被查看用户的云收藏（Song[]），本地库可还原的用本地库，否则保留元信息 */
const viewedFavorites = ref<Song[]>([]);

/** 用户详情：被查看用户的歌单原始数据 */
const viewedPlaylists = ref<Array<{ id: string; name: string; cloudCoverUrl?: string; songs?: any[] }>>([]);

/** 用户详情加载状态 */
const userModeLoading = ref(false);

/** 用户详情：目标用户的弦予号（不存在时回退到当前用户） */
const viewedUserId = computed(() => targetUsername.value || getCiyuanxiId());

/** 用户详情：被查看用户的歌单原始数据 */
const userPlaylists = computed(() => viewedPlaylists.value);

/** 用户详情：被查看用户的歌单列表（封面解析 + 歌曲数） */
const userPlaylistItems = computed(() =>
  userPlaylists.value.map(playlist => ({
    id: playlist.id,
    name: playlist.name,
    count: Array.isArray(playlist.songs) ? playlist.songs.length : 0,
    // 云端封面缺失时（旧数据未带 cloudCoverUrl），回退用歌单内在线歌曲的远程封面
    cover: playlist.cloudCoverUrl || firstRemoteSongCover(playlist.songs) || '',
  })),
);

/** 专辑/歌单网格统一数据源：歌手页为专辑，用户页为云歌单（共用歌手页卡片样式） */
const gridItems = computed<any[]>(() => (isUserMode.value ? userPlaylistItems.value : albums.value));

/** 网格封面显示 URL：B站等防盗链封面（hdslb.com）直连 403，须经后端代理转 data:URL，代理完成回填刷新 */
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

/** 用户详情：当前容器展示的歌曲列表 */
const userModeSongs = computed<Song[]>(() => viewedFavorites.value);

/**
 * 加载被查看用户的云收藏与云歌单
 */
async function loadUserModeData() {
  const userId = viewedUserId.value;
  // 用户模式不走 loadData；初始加载期间保持整页"正在加载…"（与歌手页行为一致），结束后在 finally 解除门控
  if (!userId) {
    hasInitialLoad.value = true;
    return;
  }
  if (userModeLoading.value) return;
  userModeLoading.value = true;
  try {
    const [favorites, playlistsData] = await Promise.all([
      downloadUserFavorites(userId),
      downloadUserPlaylists(userId).catch(() => null),
    ]);
    viewedFavorites.value = favorites;
    viewedPlaylists.value = (playlistsData?.playlists ?? []).map(p => ({
      id: String(p.id ?? ''),
      name: p.name ?? '未知歌单',
      cloudCoverUrl: p.cloudCoverUrl || '',
      songs: p.songs ?? [],
    }));
    // 收藏歌曲的元信息写入 extra，供播放解析
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

// 将 PluginSearchResult 转换为 Song 用于展示和播放
function mfResultToSong(item: PluginSearchResult): Song {
  const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];

  // 专辑名：优先用 item.album；为空时尝试从 rawData 提取；仍为空时在专辑详情页用上下文标题
  let album = item.album || '';
  if (!album && item.rawData) {
    const raw = item.rawData;
    album = raw.al?.name || raw.album?.name || raw.albumName || '';
  }
  if (!album && detailType.value === 'album' && title.value) {
    album = title.value;
  }
  album = album || '未知专辑';

  // 时长：优先用 item.duration（已由 extractDurationMs 提取为毫秒）；
  // 为空时回退到 rawData 重新走统一的时长提取逻辑
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

/** 将 LxSearchResultItem 转换为 Song 用于展示和播放（与 Search.vue 中逻辑一致） */
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
  // 用户页云歌单：loadData 已转换为完整 Song，不可再走插件结果映射
  if (detailType.value === 'playlist' && ctx.value?.rawData?.userPlaylistSongs) {
    return songs.value as Song[];
  }
  return isLxEngine.value
    ? songs.value.map((item: LxSearchResultItem) => lxResultToSong(item))
    : songs.value.map((item: PluginSearchResult) => mfResultToSong(item));
});

/** 当前容器展示的歌曲列表：在线详情为在线歌曲，用户模式为被查看用户的收藏/歌单歌曲 */
const currentSongs = computed<Song[]>(() =>
  isUserMode.value ? userModeSongs.value : songList.value,
);

// MF 插件（如网易云）的 search/getAlbumInfo/getArtistWorks 可能不返回封面 URL 和时长，
// 只在 getMusicInfo 时才有。此处异步补获列表中缺失封面或时长的歌曲，不阻塞页面渲染。
let mfCoverFetchVersion = 0;
const MF_COVER_CONCURRENCY = 3;

async function fetchMissingMfCovers(afterBatch?: Promise<void>) {
  if (!ctx.value) return;
  const { pluginSource } = ctx.value;
  if (!pluginSource) return;
  const version = ++mfCoverFetchVersion;

  // 等批量补全落盘（仅批量阶段，不含慢速逐首兜底；未传则跳过等待）
  if (afterBatch) {
    try { await afterBatch; } catch { /* 忽略，继续逐首兜底 */ }
    if (version !== mfCoverFetchVersion) return; // 等待期间页面已切换
  }

  // 筛选缺封面或缺时长的歌曲（拷贝索引，避免遍历期间数组变化）。
  // pluginGetCover 内部会调用 getMusicInfo 并把返回的时长写回 item.duration。
  const pending: { index: number; item: PluginSearchResult }[] = [];
  songs.value.forEach((item, index) => {
    if ((!item.coverUrl || !item.duration) && item.rawData) {
      pending.push({ index, item });
    }
  });
  if (pending.length === 0) return;

  // 有限并发拉取封面与时长
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const { index, item } = pending[cursor++];
      if (version !== mfCoverFetchVersion) return; // 新数据加载，取消旧任务
      try {
        const cover = await pluginGetCover(pluginSource, item);
        if (version !== mfCoverFetchVersion) return;
        const current = songs.value[index];
        if (!current) continue;
        const patch: Record<string, any> = {};
        if (cover) {
          // 升级 https，避免 http 封面被 WebView2 混合内容拦截；响应式更新触发 computed 重算
          patch.coverUrl = String(cover).replace(/^http:\/\//i, 'https://');
        }
        // getMusicInfo 已把时长写回 item；仅当列表条目仍缺时长时补上（可能已被 weapi 批量补全抢占）
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

/** MF 插件（时迁酱系网易/QQ/酷我）：官方 API 批量补全封面与时长。
 *  插件详情接口（getArtistWorks/getAlbumInfo/getMusicSheetInfo）不回传时长，
 *  且其 getMusicInfo 不可靠（QQ/酷我实测拿不到 duration），与搜索页 backfillWyTrackMeta 同策略：
 *  网易走 weapi song/detail、QQ 走 fcg_play_single_song（逗号批量）、酷我走 musicInfo（逐首）。 */
let mfMetaFetchVersion = 0;

/** 提取歌曲的平台 ID：酷我歌单/歌手接口常返回 "MUSIC_123" 前缀或把 rid 放在 rawData（musicrid）；
 *  酷狗主键是 hash（32 位十六进制）或 mixsongid（纯数字），统一多字段候选，
 *  否则 ID 格式校验会整批滤掉导致补全静默跳过 */
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

  // 酷狗专辑页：从上下文取专辑 ID，整张专辑一次拉全（歌手页的 id 是歌手 ID，不能当专辑 ID 用）
  const kgAlbumId = c.type === 'album' && c.rawData
    ? String(c.rawData.albumId ?? c.rawData.albumid ?? c.rawData.AlbumID ?? c.rawData.id ?? '')
    : '';

  /** 仅补缺写入；可重复调用（增量回调与最终写入共用），补全期间切页则丢弃 */
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
                // 歌单页/歌手页分别传源 ID，优先批量接口一次拉全时长（插件映射丢弃了接口自带 duration）。
                // onPatches 增量落盘：批量命中秒级上屏，不等慢速逐首兜底
                sheetId: c.type === 'playlist' ? String(c.rawData?.id ?? '') : '',
                artistId: c.type === 'artist' ? String(c.rawData?.id ?? '') : '',
                onPatches: (m) => {
                  applyPatches(m);
                  onBatchReady?.(); // 批量阶段完成即放行封面兜底（resolve 幂等）
                },
              },
            );

    applyPatches(patches);
  } finally {
    // 全部早退/异常路径也放行信号，避免封面兜底永久等待
    onBatchReady?.();
  }
}

/** LX 引擎：异步补获列表中缺失封面的歌曲（kw/kg 源搜索结果 img 可能为 null） */
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

/**
 * MF 插件回退：从歌曲列表中提取去重专辑（当 getArtistWorks('album') 不支持时）
 */
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
  // 用户详情模式展示本地收藏/歌单，无需加载在线数据
  if (isUserMode.value) return;
  const version = ++loadVersion;
  loading.value = true;
  try {
    // 用户页云歌单：歌曲已随上下文携带（rawData.userPlaylistSongs），直接渲染，不走在线插件加载
    const userPlSongs = ctx.value.rawData?.userPlaylistSongs;
    if (detailType.value === 'playlist' && Array.isArray(userPlSongs)) {
      if (version !== loadVersion) return;
      const restored = (page === 1 ? userPlSongs : [...songs.value, ...userPlSongs]).map(syncPayloadToSong);
      songs.value = restored;
      // 元信息写入 extra，供播放解析（与用户页收藏歌曲同处理）
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
    // 仅当前版本的加载才能重置 loading，防止旧异步任务提前关闭 loading 指示器
    if (version === loadVersion) {
      loading.value = false;
    }
    hasInitialLoad.value = true;
  }

  // 云歌单歌曲元数据完整，无需补获封面
  if (ctx.value?.rawData?.userPlaylistSongs && detailType.value === 'playlist') return;
  // 歌曲列表加载完成后，异步补获缺失的封面（不阻塞渲染）
  // 版本不匹配时跳过，避免为已过期的数据触发封面拉取
  if (version !== loadVersion) return;
  if (isLxEngine.value) {
    if (songs.value.some((s: LxSearchResultItem) => !s.img)) {
      void fetchMissingLxCovers();
    }
  } else {
    // 批量补全先行落盘（酷我歌单/歌手一次拉全时长，秒级上屏）；逐首封面兜底等"批量阶段
    // 完成"信号后重新筛选，只补仍缺的条目——不排在整个慢速逐首兜底链后面
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
      // 歌手详情歌曲：用歌手名搜索
      const result = await lxSearch(source, title.value, page);
      if (version !== loadVersion) return;
      if (page === 1) songs.value = result.list;
      else songs.value = [...songs.value, ...result.list];
    } else if (artistActiveTab.value === 'albums') {
      // 歌手详情专辑：搜索后从结果中提取专辑
      const albumResults = await lxCatalogSearch(source, title.value, 'album', page) as LxAlbumSearchResult[];
      if (version !== loadVersion) return;
      if (page === 1) albums.value = albumResults;
      else albums.value = [...albums.value, ...albumResults];
    }
  } else if (type === 'album') {
    // 优先用专辑 ID 直接调 API 获取曲目
    let results = await lxGetAlbumSongs(source, rawData, page);
    // 回退：专辑 API 返回空（ID 无效或 API 失败），用专辑名搜索并按专辑名过滤
    if (results.length === 0 && page === 1) {
      console.warn(`[OnlineDetail] LX album direct API empty, falling back to search for "${title.value}"`);
      const albumNameNorm = title.value.trim().toLowerCase();
      const searchResult = await lxSearch(source, title.value, page);
      results = searchResult.list.filter((s: LxSearchResultItem) => {
        const songAlbumNorm = (s.albumName || '').trim().toLowerCase();
        return songAlbumNorm === albumNameNorm || songAlbumNorm.includes(albumNameNorm) || albumNameNorm.includes(songAlbumNorm);
      });
      // 搜索回退后不再支持分页（搜索结果分页与专辑曲目不一致）
      if (results.length === 0) {
        // 如果精确过滤后仍为空，放宽过滤条件，直接用搜索结果
        results = searchResult.list;
      }
    }
    if (version !== loadVersion) return;
    if (page === 1) songs.value = results;
    else songs.value = [...songs.value, ...results];
  } else if (type === 'playlist') {
    // 优先用歌单 ID 直接调 API 获取曲目
    let results = await lxGetPlaylistTracks(source, rawData, page);
    // 回退：歌单 API 返回空，用歌单名搜索（无法精确过滤，直接展示搜索结果）
    if (results.length === 0 && page === 1) {
      console.warn(`[OnlineDetail] LX playlist direct API empty, falling back to search for "${title.value}"`);
      const searchResult = await lxSearch(source, title.value, page);
      results = searchResult.list;
    }
    if (version !== loadVersion) return;
    if (page === 1) songs.value = results;
    else songs.value = [...songs.value, ...results];
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
      // 优先用 getArtistWorks('album') 获取专辑
      let albumResults = await pluginGetArtistAlbums(pluginSource, rawData, page);
      // 回退 1：插件不支持 album 类型，用专辑搜索
      if (albumResults.length === 0 && page === 1) {
        console.warn(`[OnlineDetail] MF getArtistWorks('album') empty, trying pluginAlbumSearch for "${title.value}"`);
        albumResults = await pluginAlbumSearch(pluginSource, title.value, page);
      }
      // 回退 2：专辑搜索也为空，从歌曲列表中推导专辑
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
    const results = await pluginGetPlaylistDetail(pluginSource, rawData, page);
    if (version !== loadVersion) return;
    if (page === 1) songs.value = results;
    else songs.value = [...songs.value, ...results];
  }
}

/** 全部播放：清空队列 → 加入全部歌曲 → 播放第一首（播放时才拉取直链） */
async function handlePlayAll() {
  if (!ctx.value || currentSongs.value.length === 0) {
    showToast('暂无可播放的歌曲', 'info');
    return;
  }

  try {
    const firstSong = currentSongs.value[0];

    // LX 引擎：全部歌曲预先缓存元信息，确保队列中后续歌曲也能正确解析 URL/歌词
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

    // 在线歌曲不 await，保持边飞边加载的并行行为（与 OnlineSongList 一致）
    launchFlyingCover(firstSong.path, firstSong.cover_thumb_path || '');

    // 清空当前播放队列，加入全部歌曲（保留 rawData，播放时由 playSong 解析协议 URL）
    await clearQueue();
    addSongsToQueue(currentSongs.value);

    // 播放第一首：playSong 内部会解析 plugin:// 或 lx:// 协议并拉取直链、歌词、封面
    await playSong(firstSong, { preserveQueue: true });
  } catch (e: any) {
    showToast(`播放失败: ${e?.message || e}`, 'error');
  }
}

/** 收藏至歌单：调用原有引擎的收藏到歌单逻辑和 UI */
function handleAddToPlaylist() {
  if (currentSongs.value.length === 0) {
    showToast('暂无可收藏的歌曲', 'info');
    return;
  }

  // 将歌曲元信息缓存到 songPool，确保歌单中能正确显示
  for (const song of currentSongs.value) {
    libraryStore.setExtraSong(song);
  }

  // 调用原有的收藏到歌单对话框，同时传入完整 Song 对象用于持久化
  const songPaths = currentSongs.value.map(s => s.path);
  openAddToPlaylistDialog(songPaths, { songs: currentSongs.value });
}

/** 全选/取消全选 */
function handleSelectAll() {
  const allPaths = currentSongs.value.map(s => s.path);
  if (allPaths.length > 0 && selectedPaths.value.size === allPaths.length) {
    selectedPaths.value = new Set();
  } else {
    selectedPaths.value = new Set(allPaths);
  }
}

/** 播放歌曲（在线/本地均由 playSong 解析协议） */
const handlePlaySong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
};

/** 右键菜单：收藏至歌单 */
function handleContextMenuAddToPlaylist() {
  const song = contextMenuTargetSong.value;
  if (!song) return;
  // 缓存在线歌曲元信息到 songPool
  libraryStore.setExtraSong(song);
  // 触发原生收藏到歌单弹窗
  openAddToPlaylistDialog([song.path], { songs: [song] });
}

/** 右键菜单：查看歌手（仅在歌单容器中显示） */
async function handleOnlineViewArtist(song: Song) {
  if (!ctx.value) return;
  const artistName = song.effective_artist_names?.[0] || song.artist_names?.[0] || song.artist || '';
  if (!artistName || artistName === '未知歌手') {
    showToast('当前歌曲缺少歌手信息', 'info');
    return;
  }

  // 用户详情模式：收藏歌曲可能为本地歌曲，直接打开本地歌手详情
  if (isUserMode.value) {
    void openHomeArtist(artistName);
    return;
  }

  try {
    if (isLxEngine.value && ctx.value.lxSourceId) {
      // LX 引擎：用 lxCatalogSearch 搜索歌手
      const source = ctx.value.lxSourceId as LxSourceId;
      const results = await lxCatalogSearch(source, artistName, 'artist', 1) as LxArtistSearchResult[];
      if (results.length === 0) {
        showToast('未找到该歌手', 'info');
        return;
      }
      const artist = results[0];
      onlineDetailStore.setContextWithHistory({
        type: 'artist',
        title: artist.name,
        subtitle: artist.songCount ? `${artist.songCount} 首歌曲` : '',
        coverUrl: artist.avatarUrl,
        pluginSource: ctx.value.pluginSource,
        rawData: artist.rawData,
        sourceSearchType: ctx.value.sourceSearchType || 'playlist',
        engineType: 'lx',
        lxSourceId: ctx.value.lxSourceId,
      });
    } else {
      if (!ctx.value.pluginSource) {
        showToast('当前歌曲缺少歌手信息', 'info');
        return;
      }
      // MF 引擎：用 pluginArtistSearch 搜索歌手
      const results = await pluginArtistSearch(ctx.value.pluginSource, artistName, 1);
      if (results.length === 0) {
        showToast('未找到该歌手', 'info');
        return;
      }
      const artist = results[0];
      onlineDetailStore.setContextWithHistory({
        type: 'artist',
        title: artist.name,
        subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
        description: artist.description || '',
        coverUrl: artist.avatarUrl,
        pluginSource: ctx.value.pluginSource,
        rawData: artist.rawData,
        sourceSearchType: ctx.value.sourceSearchType || 'playlist',
        engineType: 'musicfree',
      });
    }
    void router.push({ path: '/online-detail', query: { type: 'artist' } });
  } catch (e: any) {
    showToast(`查看歌手失败: ${e?.message || e}`, 'error');
  }
}

/** 右键菜单：查看专辑（仅在歌单容器中显示） */
async function handleOnlineViewAlbum(song: Song) {
  if (!ctx.value) return;
  const albumName = song.album || '';
  if (!albumName || albumName === '未知专辑') {
    showToast('当前歌曲缺少专辑信息', 'info');
    return;
  }

  // 用户详情模式：收藏歌曲可能为本地歌曲，直接打开本地专辑详情
  if (isUserMode.value) {
    void openHomeAlbum(getSongAlbumKey(song));
    return;
  }

  try {
    if (isLxEngine.value && ctx.value.lxSourceId) {
      // LX 引擎：用 lxCatalogSearch 搜索专辑
      const source = ctx.value.lxSourceId as LxSourceId;
      const results = await lxCatalogSearch(source, albumName, 'album', 1) as LxAlbumSearchResult[];
      if (results.length === 0) {
        showToast('未找到该专辑', 'info');
        return;
      }
      const album = results[0];
      onlineDetailStore.setContextWithHistory({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource: ctx.value.pluginSource,
        rawData: album.rawData,
        sourceSearchType: ctx.value.sourceSearchType || 'playlist',
        engineType: 'lx',
        lxSourceId: ctx.value.lxSourceId,
      });
    } else {
      if (!ctx.value.pluginSource) {
        showToast('当前歌曲缺少专辑信息', 'info');
        return;
      }
      // MF 引擎：用 pluginAlbumSearch 搜索专辑
      const results = await pluginAlbumSearch(ctx.value.pluginSource, albumName, 1);
      if (results.length === 0) {
        showToast('未找到该专辑', 'info');
        return;
      }
      const album = results[0];
      onlineDetailStore.setContextWithHistory({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource: ctx.value.pluginSource,
        rawData: album.rawData,
        sourceSearchType: ctx.value.sourceSearchType || 'playlist',
        engineType: 'musicfree',
      });
    }
    void router.push({ path: '/online-detail', query: { type: 'album' } });
  } catch (e: any) {
    showToast(`查看专辑失败: ${e?.message || e}`, 'error');
  }
}

/** 点击歌手详情中的专辑，导航到在线专辑详情 */
function handleAlbumClick(album: any) {
  if (!ctx.value) return;
  if (!ctx.value.pluginSource) return;
  const isLx = isLxEngine.value && ctx.value.lxSourceId;
  // 先保存当前歌手数据状态（歌曲/专辑/tab/滚动），随上下文入栈，返回歌手详情时恢复
  const artistState: ArtistDetailStateCache = {
    songs: songs.value,
    albums: albums.value,
    artistActiveTab: artistActiveTab.value,
    scrollTop: detailScrollRef.value?.scrollTop || 0,
  };
  // 使用带历史的上下文设置，保存当前歌手上下文
  onlineDetailStore.setContextWithHistory({
    type: 'album',
    title: album.name,
    subtitle: album.artist,
    coverUrl: album.coverUrl,
    pluginSource: ctx.value.pluginSource,
    rawData: album.rawData,
    sourceSearchType: 'artist', // 标记来源为歌手详情
    ...(isLx ? { engineType: 'lx' as const, lxSourceId: ctx.value.lxSourceId } : { engineType: 'musicfree' as const }),
  }, artistState);
  artistActiveTab.value = 'songs'; // 重置 tab
  void router.push({ path: '/online-detail', query: { type: 'album' } });
}

/** 点击用户详情中的云歌单，跳转到独立歌单详情页（与歌手页点专辑跳专辑详情同模式） */
function handleUserPlaylistClick(playlistId: string) {
  const playlist = viewedPlaylists.value.find(p => p.id === playlistId);
  if (!playlist) return;
  const songs = playlist.songs ?? [];
  // 使用带历史的上下文设置，保存当前用户上下文，返回时恢复
  onlineDetailStore.setContextWithHistory({
    type: 'playlist',
    title: playlist.name,
    subtitle: `${songs.length} 首歌曲`,
    // 封面与歌单卡片同源：云端封面缺失时回退歌单内在线歌曲的远程封面
    coverUrl: playlist.cloudCoverUrl || firstRemoteSongCover(songs) || '',
    engineType: 'musicfree',
    // 云歌单歌曲已随上下文携带，歌单详情页直接渲染，无需在线加载
    rawData: { userPlaylistSongs: songs },
    sourceSearchType: 'playlist',
  });
  // 不重置 tab：跳转前切 tab 会先播放一次容器内切换动画（歌单网格淡出→收藏列表）再跳转，观感多余
  void router.push({ path: '/online-detail', query: { type: 'playlist' } });
}

function handleBack() {
  // 如果有上一个上下文（从歌手详情进入专辑），直接 router.back
  if (onlineDetailStore.hasPreviousContext()) {
    void router.back();
  } else {
    // 返回搜索页，设置待恢复的搜索会话（tab + 插件源 + 结果快照）以还原离开前的状态，
    // 结果快照直接还原免重搜（防重复请求触发风控）
    const sourceType = ctx.value?.sourceSearchType || (detailType.value === 'user' ? 'playlist' : detailType.value);
    onlineDetailStore.setPendingSearchSession({
      type: sourceType,
      sourceId: ctx.value?.sourceSearchSourceId ?? null,
      results: onlineDetailStore.searchResultsCache,
    });
    void router.back();
  }
}

onMounted(() => {
  if (!ctx.value) {
    showToast('详情数据不可用，请从搜索页进入', 'info');
    void router.replace('/search');
    return;
  }
  if (isUserMode.value) {
    void loadUserModeData();
  } else {
    void loadData(1);
  }
});

onBeforeUnmount(() => {
  mfCoverFetchVersion += 1; // 取消 pending 的 MF 封面拉取
  lxCoverFetchVersion += 1; // 取消 pending 的 LX 封面拉取
  // 离开详情流：清空上下文与历史栈，避免下次进入残留旧上下文/嵌套导航状态
  onlineDetailStore.clearContextFlow();
  // 按去向清理一级缓存：
  // - 返回搜索页：保留搜索会话（tab+插件源+结果快照），销毁榜单缓存（已离开榜单流）
  // - 返回榜单页：保留榜单缓存，销毁搜索会话（已离开搜索流）
  // - 其他去向（真正离开在线详情流）：销毁全部一级缓存
  const destPath = router.currentRoute.value.path;
  if (destPath === '/search') {
    onlineDetailStore.clearTopListsCache();
  } else if (destPath === '/top-lists') {
    onlineDetailStore.clearSearchSession();
  } else {
    onlineDetailStore.clearSearchSession();
    onlineDetailStore.clearTopListsCache();
  }
});

// 路由 type 变化时：尝试恢复上下文并重新加载
watch(detailType, (newType, oldType) => {
  if (newType === oldType) return;
  // 检测是否为"返回"导航（上下文类型与路由类型不匹配 → 需恢复上一个上下文）
  const isRestoring = !!(ctx.value && ctx.value.type !== newType);
  // 如果上下文类型与路由类型不匹配，尝试恢复上一个上下文
  if (isRestoring) {
    onlineDetailStore.restorePreviousContext();
  }
  // 前进/返回导航都取消上一个类型的加载与封面补获任务，避免旧数据写回新类型
  loadVersion += 1;
  mfCoverFetchVersion += 1;
  lxCoverFetchVersion += 1;
  mfMetaFetchVersion += 1;
  // 从专辑详情返回歌手详情：恢复随上下文缓存的歌手数据状态（内容+tab+滚动），免重搜
  if (isRestoring && newType === 'artist') {
    const restored = ctx.value?.detailState;
    if (restored) {
      songs.value = restored.songs;
      albums.value = restored.albums;
      restoringArtistState = true;
      artistActiveTab.value = restored.artistActiveTab as ArtistTabId;
      void nextTick(() => { restoringArtistState = false; });
      nextTick(() => {
        requestAnimationFrame(() => {
          if (detailScrollRef.value) {
            detailScrollRef.value.scrollTop = restored.scrollTop;
          }
        });
      });
      // 恢复后补获缺失封面/时长（与 loadData 行为一致）
      if (isLxEngine.value) {
        if (songs.value.some((s: LxSearchResultItem) => !s.img)) {
          void fetchMissingLxCovers();
        }
      } else if (songs.value.some((s: PluginSearchResult) => !s.coverUrl || !s.duration)) {
        void fetchMissingMfCovers();
      }
      // 消费后清除，避免后续导航复用过期状态
      if (ctx.value) ctx.value.detailState = undefined;
      return;
    }
  }
  // 仅前进导航时重置整页滚动（返回导航由 SongTable 滚动记忆恢复）
  if (!isRestoring && detailScrollRef.value) detailScrollRef.value.scrollTop = 0;
  // 清空上一个类型的数据，避免转场期间显示旧数据
  songs.value = [];
  albums.value = [];
  if (ctx.value) {
    if (newType === 'user') {
      // 返回用户页：保留已加载的收藏/歌单避免闪现空态，后台静默刷新
      void loadUserModeData();
    } else {
      void loadData(1);
    }
  }
});

// 歌手 tab 切换时重新加载对应数据（恢复歌手状态期间抑制，数据已随状态恢复）
watch(artistActiveTab, () => {
  if (restoringArtistState) return;
  if (detailType.value === 'artist' && ctx.value) {
    // 清空上一个 tab 的数据，避免转场期间显示旧数据或加载失败时残留
    songs.value = [];
    albums.value = [];
    void loadData(1);
  }
});

// 进入歌手详情且尚无简介时，调用插件 getArtistInfo 拉取简介并写回（lx 源无简介接口，跳过）
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
    <!-- 返回按钮（固定在顶部，无边框无白条） -->
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

    <!-- 无数据 -->
    <div v-if="!ctx" class="flex-1 flex items-center justify-center text-black/30 dark:text-white/30">
      <p class="text-sm">详情数据不可用</p>
    </div>

    <!-- 初始加载（首次进入页面，数据还没到） -->
    <div v-else-if="!hasInitialLoad" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
        <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-sm">正在加载…</p>
      </div>
    </div>

    <!-- 详情内容：hasInitialLoad 后始终在 DOM 中，保证 Transition 动画生效 -->
    <div v-else class="flex-1 min-h-0 relative flex flex-col">
      <!-- 整页滚动容器：header 与歌曲列表一起滚动 -->
      <div ref="detailScrollRef" class="flex-1 min-h-0 overflow-y-auto custom-scrollbar relative">
      <Transition name="detail-slide" mode="out-in">
        <!-- 歌手详情 / 用户详情（排行榜"查看"进入，复用歌手页样式） -->
        <div v-if="detailType === 'artist' || detailType === 'user'" key="artist">
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

          <!-- 歌曲列表 / 专辑列表 tab（不使用 mode="out-in"，避免切换 tab 时内容空白） -->
          <div class="relative">
          <Transition name="tab-fade">
            <div v-if="artistActiveTab === 'songs'" key="songs">
              <SongTable
                :songs="currentSongs"
                :is-batch-mode="isBatchMode"
                :selected-paths="selectedPaths"
                :memory-scope-key="(isUserMode ? 'online-detail-user' : 'online-detail-artist') + '::' + detailMemoryKey"
                page-scroll-mode
                :scroll-container-ref="detailScrollRef"
                @play="handlePlaySong"
                @contextmenu="handleMySongContextMenu"
                @update:selectedPaths="selectedPaths = $event"
              />
            </div>

            <!-- 专辑列表 / 歌单列表 tab（共用歌手页黑胶卡片样式） -->
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

            <!-- 歌手详情简介 tab（单独页面展示，参考 QQ 音乐） -->
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

        <!-- 专辑详情 -->
        <div v-else-if="detailType === 'album'" key="album">
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
            <SongTable
              :songs="currentSongs"
              :is-batch-mode="isBatchMode"
              :selected-paths="selectedPaths"
              memory-scope-key="'online-detail-album::' + detailMemoryKey"
              page-scroll-mode
              :scroll-container-ref="detailScrollRef"
              @play="handlePlaySong"
              @contextmenu="handleMySongContextMenu"
              @update:selectedPaths="selectedPaths = $event"
            />
          </div>
        </div>

        <!-- 歌单详情 -->
        <div v-else-if="detailType === 'playlist'" key="playlist">
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
            <SongTable
              :songs="currentSongs"
              :is-batch-mode="isBatchMode"
              :selected-paths="selectedPaths"
              memory-scope-key="'online-detail-playlist::' + detailMemoryKey"
              page-scroll-mode
              :scroll-container-ref="detailScrollRef"
              @play="handlePlaySong"
              @contextmenu="handleMySongContextMenu"
              @update:selectedPaths="selectedPaths = $event"
            />
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
/* 加载指示器淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 歌手/专辑/歌单详情类型切换动画（进入从右滑入，离开向左滑出） */
.detail-slide-enter-active {
  transition: opacity 280ms cubic-bezier(0.25, 0.8, 0.25, 1), transform 280ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.detail-slide-leave-active {
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

/* 歌手页歌曲/专辑 tab 切换动画（不使用 mode="out-in"，离场元素绝对定位避免布局偏移） */
.tab-fade-enter-active {
  transition: opacity 240ms cubic-bezier(0.25, 0.8, 0.25, 1), transform 240ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.tab-fade-leave-active {
  position: absolute;
  width: 100%;
  top: 0;
  left: 0;
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
</style>
