<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';

import type { Song, PluginSearchResult } from '../types';
import { useOnlineDetailStore, type OnlineDetailType } from '../features/onlineDetail/store';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryStore } from '../features/library/store';
import { useToast } from '../composables/toast';
import {
  pluginGetArtistWorks,
  pluginGetArtistAlbums,
  pluginGetAlbumSongs,
  pluginGetPlaylistDetail,
  pluginGetMusicInfo,
  pluginGetLyric,
  pluginGetCover,
} from '../services/pluginEngine';
import type { PluginAlbumResult } from '../services/pluginEngine';

import ArtistDetailHeader from '../components/headers/ArtistDetailHeader.vue';
import AlbumDetailHeader from '../components/headers/AlbumDetailHeader.vue';
import DetailHeader from '../components/headers/DetailHeader.vue';
import OnlineSongList from '../components/song-list/OnlineSongList.vue';
import { type ArtistTabId } from '../utils/artistTabsOrder';

const route = useRoute();
const router = useRouter();
const { showToast } = useToast();
const { playSong, clearQueue, addSongsToQueue } = usePlaybackController();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const libraryStore = useLibraryStore();
const onlineDetailStore = useOnlineDetailStore();

const detailType = computed<OnlineDetailType>(() => (route.query.type as OnlineDetailType) || 'artist');
const ctx = computed(() => onlineDetailStore.context);

const loading = ref(false);
const songs = ref<PluginSearchResult[]>([]);
const albums = ref<PluginAlbumResult[]>([]);
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const artistActiveTab = ref<ArtistTabId>('songs');

const title = computed(() => ctx.value?.title || '');
const subtitle = computed(() => ctx.value?.subtitle || '');
const coverUrl = computed(() => ctx.value?.coverUrl || '');

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

  // 时长：优先用 item.duration（已由 parseDuration 提取为毫秒）；
  // 为空时尝试从 rawData 的 dt / duration / interval 字段提取
  let durationMs = item.duration || 0;
  if ((!durationMs || durationMs <= 0) && item.rawData) {
    const raw = item.rawData;
    const rawDur = raw.dt || raw.duration || raw.interval;
    if (rawDur) {
      // parseDuration 逻辑：数字 > 1000 视为毫秒，否则视为秒并 ×1000
      durationMs = typeof rawDur === 'number'
        ? (rawDur > 1000 ? rawDur : rawDur * 1000)
        : 0;
      if (!durationMs && typeof rawDur === 'string') {
        const parts = rawDur.split(':');
        if (parts.length >= 2) {
          durationMs = (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
        }
      }
    }
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
    source_type: 'remote',
    remote_source_id: `plugin://${item.platform}/${item.id}`,
    rawData: item,
  } as any;
}

const songList = computed<Song[]>(() => songs.value.map(mfResultToSong));

async function loadData(page = 1) {
  if (!ctx.value) return;
  loading.value = true;
  try {
    const { pluginSource, rawData, type } = ctx.value;

    if (type === 'artist') {
      // 歌手详情：同时加载歌曲和专辑
      if (artistActiveTab.value === 'songs') {
        const results = await pluginGetArtistWorks(pluginSource, rawData, page);
        if (page === 1) songs.value = results;
        else songs.value = [...songs.value, ...results];
      } else if (artistActiveTab.value === 'albums') {
        const albumResults = await pluginGetArtistAlbums(pluginSource, rawData, page);
        if (page === 1) albums.value = albumResults;
        else albums.value = [...albums.value, ...albumResults];
      }
    } else if (type === 'album') {
      const results = await pluginGetAlbumSongs(pluginSource, rawData, page);
      if (page === 1) songs.value = results;
      else songs.value = [...songs.value, ...results];
    } else if (type === 'playlist') {
      const results = await pluginGetPlaylistDetail(pluginSource, rawData, page);
      if (page === 1) songs.value = results;
      else songs.value = [...songs.value, ...results];
    }
  } catch (e: any) {
    showToast(`加载失败: ${e?.message || e}`, 'error');
  } finally {
    loading.value = false;
  }
}

async function handlePlaySong(song: Song) {
  if (!ctx.value) return;
  const mfItem = (song as any).rawData as PluginSearchResult | undefined;
  if (!mfItem) return;

  try {
    const musicInfo = await pluginGetMusicInfo(ctx.value.pluginSource, mfItem, 'standard');
    if (!musicInfo?.url) {
      showToast('无法获取播放URL', 'error');
      return;
    }

    const playableSong: Song = {
      ...song,
      path: musicInfo.url,
      remote_source_id: musicInfo.url,
      cover_thumb_path: song.cover_thumb_path || musicInfo.coverUrl || '',
    } as any;

    if (musicInfo.lyric) {
      (playableSong as any).lyrics_raw = musicInfo.lyric;
      if (musicInfo.tlyric) {
        (playableSong as any).lyrics_raw += '\n[offset:0]\n' + musicInfo.tlyric;
      }
    }

    if (!(playableSong as any).lyrics_raw) {
      try {
        const lyricData = await pluginGetLyric(ctx.value.pluginSource, mfItem);
        if (lyricData?.lyric) {
          (playableSong as any).lyrics_raw = lyricData.lyric;
          if (lyricData.tlyric) {
            (playableSong as any).lyrics_raw += '\n[offset:0]\n' + lyricData.tlyric;
          }
        }
      } catch { /* ignore */ }
    }

    if (!playableSong.cover_thumb_path) {
      try {
        const cover = await pluginGetCover(ctx.value.pluginSource, mfItem);
        if (cover) playableSong.cover_thumb_path = cover;
      } catch { /* ignore */ }
    }

    void playSong(playableSong, { insertAfterCurrent: true });
  } catch (e: any) {
    showToast(`播放失败: ${e?.message || e}`, 'error');
  }
}

/** 全部播放：清空队列 → 加入全部歌曲 → 播放第一首（播放时才拉取直链） */
async function handlePlayAll() {
  if (!ctx.value || songList.value.length === 0) {
    showToast('暂无可播放的歌曲', 'info');
    return;
  }

  // 清空当前播放队列，加入全部歌曲（保留 rawData，播放时由 playSong 解析 plugin:// URL）
  await clearQueue();
  addSongsToQueue(songList.value);

  // 播放第一首：playSong 内部会解析 plugin:// 协议并拉取直链、歌词、封面
  await playSong(songList.value[0], { preserveQueue: true });
}

/** 收藏至歌单：调用原有引擎的收藏到歌单逻辑和 UI */
function handleAddToPlaylist() {
  if (songList.value.length === 0) {
    showToast('暂无可收藏的歌曲', 'info');
    return;
  }

  // 将在线歌曲元信息缓存到 extraSongPool，确保歌单中能正确显示
  for (const song of songList.value) {
    libraryStore.setExtraSong(song);
  }

  // 调用原有的收藏到歌单对话框，同时传入完整 Song 对象用于持久化
  const songPaths = songList.value.map(s => s.path);
  openAddToPlaylistDialog(songPaths, { songs: songList.value });
}

function handleContextMenu(_e: MouseEvent, _song: Song) {
  // 右键菜单暂不处理
}

/** 点击歌手详情中的专辑，导航到在线专辑详情 */
function handleAlbumClick(album: PluginAlbumResult) {
  if (!ctx.value) return;
  // 使用带历史的上下文设置，保存当前歌手上下文
  onlineDetailStore.setContextWithHistory({
    type: 'album',
    title: album.name,
    subtitle: album.artist,
    coverUrl: album.coverUrl,
    pluginSource: ctx.value.pluginSource,
    rawData: album.rawData,
    sourceSearchType: 'artist', // 标记来源为歌手详情
  });
  artistActiveTab.value = 'songs'; // 重置 tab
  void router.push({ path: '/online-detail', query: { type: 'album' } });
}

function handleBack() {
  // 如果有上一个上下文（从歌手详情进入专辑），直接 router.back
  if (onlineDetailStore.hasPreviousContext()) {
    void router.back();
  } else {
    // 返回搜索页，设置 pendingSearchType 以恢复搜索 tab
    const sourceType = ctx.value?.sourceSearchType || detailType.value;
    onlineDetailStore.setPendingSearchType(sourceType);
    void router.back();
  }
}

onMounted(() => {
  if (!ctx.value) {
    showToast('详情数据不可用，请从搜索页进入', 'info');
    void router.replace('/search');
    return;
  }
  void loadData(1);
});

// 路由 type 变化时：尝试恢复上下文并重新加载
watch(detailType, (newType) => {
  // 如果上下文类型与路由类型不匹配，尝试恢复上一个上下文
  if (ctx.value && ctx.value.type !== newType) {
    onlineDetailStore.restorePreviousContext();
  }
  if (ctx.value) void loadData(1);
});

// 歌手 tab 切换时重新加载对应数据
watch(artistActiveTab, () => {
  if (detailType.value === 'artist' && ctx.value) {
    void loadData(1);
  }
});
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
        返回搜索
      </button>
    </div>

    <!-- 加载中 -->
    <div v-if="loading && songs.length === 0 && (detailType !== 'artist' || artistActiveTab !== 'albums' || albums.length === 0)" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
        <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-sm">正在加载…</p>
      </div>
    </div>

    <!-- 无数据 -->
    <div v-else-if="!ctx" class="flex-1 flex items-center justify-center text-black/30 dark:text-white/30">
      <p class="text-sm">详情数据不可用</p>
    </div>

    <!-- 详情内容：整个区域可滚动 -->
    <div v-else class="flex-1 overflow-y-auto custom-scrollbar">
      <!-- 歌手详情 -->
      <template v-if="detailType === 'artist'">
        <ArtistDetailHeader
          v-model:isBatchMode="isBatchMode"
          v-model:activeTab="artistActiveTab"
          :artistName="title"
          :songs="songList"
          :selectedCount="selectedPaths.size"
          :readOnly="true"
          :coverUrlOverride="coverUrl"
          @playAll="handlePlaySong(songList[0])"
        />

        <!-- 歌曲列表 tab -->
        <OnlineSongList
          v-if="artistActiveTab === 'songs'"
          :songs="songList"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
        />

        <!-- 专辑列表 tab -->
        <div v-else-if="artistActiveTab === 'albums'" class="p-4 md:p-6 lg:p-8">
          <div v-if="albums.length > 0" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10">
            <div
              v-for="album in albums"
              :key="album.id"
              class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5"
              @click="handleAlbumClick(album)"
            >
              <div class="relative w-full aspect-square mb-3 mt-4">
                <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
                  <img
                    v-if="album.coverUrl"
                    :src="album.coverUrl"
                    class="w-full h-full object-cover rounded-sm"
                    alt=""
                    loading="lazy"
                    @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'"
                  />
                  <div
                    v-if="!album.coverUrl"
                    class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
                  >
                    {{ album.name ? album.name.charAt(0).toUpperCase() : 'A' }}
                  </div>
                </div>
              </div>
              <div class="flex flex-col items-start px-1 z-20">
                <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">
                  {{ album.name }}
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 opacity-80">
                  {{ album.artist }}
                </p>
              </div>
            </div>
          </div>
          <div v-else class="flex flex-col items-center justify-center py-20 text-black/30 dark:text-white/30">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <p class="text-sm">暂无专辑</p>
          </div>
        </div>
      </template>

      <!-- 专辑详情 -->
      <template v-else-if="detailType === 'album'">
        <AlbumDetailHeader
          v-model:isBatchMode="isBatchMode"
          :albumName="title"
          :albumArtist="subtitle"
          :songs="songList"
          :selectedCount="selectedPaths.size"
          :readOnly="true"
          :coverUrlOverride="coverUrl"
          @playAll="handlePlayAll"
          @addToPlaylist="handleAddToPlaylist"
        />
        <OnlineSongList
          :songs="songList"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
        />
      </template>

      <!-- 歌单详情 -->
      <template v-else-if="detailType === 'playlist'">
        <DetailHeader
          :title="title"
          :subtitle="subtitle"
          :songs="songList"
          :isBatchMode="isBatchMode"
          :selectedCount="selectedPaths.size"
          :readOnly="true"
          :coverUrlOverride="coverUrl"
          @playAll="handlePlayAll"
          @openAddToPlaylist="handleAddToPlaylist"
        />
        <OnlineSongList
          :songs="songList"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
        />
      </template>
    </div>
  </div>
</template>
