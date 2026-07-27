<template>
  <div class="flex flex-col h-full">
    <!-- 搜索结果头部 -->
    <div class="px-6 shrink-0 select-none flex flex-col pt-2 pb-3 h-auto justify-center">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 pb-1 min-w-0">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white truncate">
            搜索结果
          </h2>
          <span v-if="searchQuery.trim()" class="text-sm text-gray-500 dark:text-gray-400 truncate">
            “{{ searchQuery }}” · {{ localSongList.length }} 首
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="localSongList.length > 0"
            @click="handlePlayAll"
            class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
            title="播放全部"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 5.5v13l10-6.5-10-6.5Z" />
            </svg>
          </button>
          <button
            v-if="localSongList.length > 0"
            @click="handleAddAllToQueue"
            class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
            title="全部添加至播放列表"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.5 6H17" />
              <path d="M3.5 12H14" />
              <path d="M3.5 18H11" />
              <path d="M18 14v6" />
              <path d="M15 17h6" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 搜索结果列表 -->
    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden">
        <SongTable
          v-if="localSongList.length > 0"
          ref="songTableRef"
          :songs="localSongList"
          :isBatchMode="false"
          :selectedPaths="selectedPaths"
          memoryScopeKey="search-view"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
          @update:selectedPaths="selectedPaths = $event"
        />
        <div v-else class="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-600">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p class="text-base font-medium">
            {{ searchQuery.trim() ? `没有找到与“${searchQuery}”相关的歌曲` : '在上方搜索框输入关键词' }}
          </p>
        </div>
      </section>
    </div>

    <DragGhost />

    <SongContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="false"
      @close="showContextMenu = false"
      @add-to-playlist="openAddToPlaylistSelection"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Song } from '../types';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';

import SongTable from '../components/song-list/SongTable.vue';
import DragGhost from '../components/common/DragGhost.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';

const { canonicalSongs, searchQuery } = usePlayerLibraryView();
const { playSong, addSongsToQueue } = usePlaybackController();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();

// 根据搜索关键词过滤全库歌曲
const localSongList = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return [];
  return canonicalSongs.value.filter(song => {
    const title = (song.title || song.name || '').toLowerCase();
    const artist = (song.artist || '').toLowerCase();
    const album = (song.album || '').toLowerCase();
    return title.includes(query) || artist.includes(query) || album.includes(query);
  });
});

const selectedPaths = ref<Set<string>>(new Set());
const songTableRef = ref<any>(null);
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

const handlePlayAll = () => {
  if (localSongList.value.length > 0) {
    void playSong(localSongList.value[0], { insertAfterCurrent: true });
  }
};

const handlePlaySong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
};

const handleAddAllToQueue = () => {
  addSongsToQueue(localSongList.value);
};

const openAddToPlaylistSelection = () => {
  const songPaths = contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : [];
  openAddToPlaylistDialog(songPaths);
};

const handleContextMenu = (e: MouseEvent, song: Song) => {
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};
</script>
