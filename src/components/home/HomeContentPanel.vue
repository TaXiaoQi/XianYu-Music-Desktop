<script setup lang="ts">
import { computed, defineAsyncComponent, shallowRef } from 'vue';
import { useRouter } from 'vue-router';

import type { Song } from '../../types';
import { default as SongTable } from '../song-list/SongTable.vue';
import HomeDetailHeaderArea from './panels/HomeDetailHeaderArea.vue';
import HomeDiscoverArea from './panels/HomeDiscoverArea.vue';
import HomeArtistAlbumArea from './panels/HomeArtistAlbumArea.vue';

const MasterPanel = defineAsyncComponent(() => import('../song-list/MasterPanel.vue'));

type ArtistTabKey = 'songs' | 'albums' | 'details';
type DiscoverTabKey = 'statistics' | 'leaderboard' | 'dailyRecommend' | 'topLists';

interface ArtistAlbumItem { key: string; name: string; count: number; artist: string; firstSongPath: string }

interface HomePanelProps {
  localViewMode: string;
  isBatchMode: boolean;
  isManagementMode: boolean;
  artistActiveTab: ArtistTabKey;
  localFilterCondition: string;
  songTableMemoryScopeKey: string;
  localSongList: Song[];
  localSongPaths?: string[];
  resolveSongByPath?: (path: string) => Song | null;
  selectedCount: number;
  selectedAlbumSong: Song | null;
  artistAlbumList: ArtistAlbumItem[];
  coverCache: Map<string, string>;
  loadingSet: Set<string>;
  selectedPaths: Set<string>;
  setSongTableRef?: (instance: any | null) => void;
}

const panelProps = defineProps<HomePanelProps>();

interface HomePanelEmits {
  (e: 'update:isBatchMode', value: boolean): void;
  (e: 'update:artistActiveTab', value: ArtistTabKey): void;
  (e: 'update:selectedPaths', value: Set<string>): void;
  (e: 'playAll'): void;
  (e: 'batchPlay'): void;
  (e: 'showAddToPlaylist'): void;
  (e: 'batchDelete'): void;
  (e: 'batchMove'): void;
  (e: 'playSong', song: Song): void;
  (e: 'contextMenuSong', nativeEvent: MouseEvent, song: Song): void;
  (e: 'tableDragStart', ...args: any[]): void;
  (e: 'artistAlbumClick', albumKey: string): void;
}

const emitEvent = defineEmits<HomePanelEmits>();

const DISCOVER_PAGES: readonly string[] = ['statistics', 'leaderboard', 'dailyRecommend', 'topLists'];

const showingDiscoverPage = computed(() => DISCOVER_PAGES.includes(panelProps.localViewMode));
const artistViewActive = computed(() => panelProps.localViewMode === 'artist');
const albumViewActive = computed(() => panelProps.localViewMode === 'album');
const artistSubPageShown = computed(
  () => artistViewActive.value
    && (panelProps.artistActiveTab === 'albums' || panelProps.artistActiveTab === 'details'),
);
const albumGridShown = computed(
  () => artistViewActive.value && panelProps.artistActiveTab === 'albums',
);
const songListingShown = computed(() => !showingDiscoverPage.value && !artistSubPageShown.value);

const router = useRouter();

const switchDiscoverPage = (next: DiscoverTabKey) => {
  if (panelProps.localViewMode === next) return;
  void router.replace({
    path: '/',
    query: next === 'statistics' ? {} : { view: next },
  });
};

const tableInstance = shallowRef<any>(null);

const attachTableInstance = (instance: unknown) => {
  tableInstance.value = instance;
  panelProps.setSongTableRef?.((instance ?? null) as any);
};

const tableScrollArea = computed<HTMLElement | null>(() => tableInstance.value?.containerRef ?? null);

const forwardTableContextMenu = (nativeEvent: MouseEvent, song: Song) => {
  emitEvent('contextMenuSong', nativeEvent, song);
};

const forwardTableDragStart = (...args: any[]) => {
  emitEvent('tableDragStart', ...args);
};

const detailHeaderBindings = computed(() => ({
  mode: panelProps.localViewMode,
  batchMode: panelProps.isBatchMode,
  artistTab: panelProps.artistActiveTab,
  artistName: panelProps.localFilterCondition || 'Unknown Artist',
  albumTitle: panelProps.selectedAlbumSong?.album || 'Unknown Album',
  albumArtistName:
    panelProps.selectedAlbumSong?.album_artist
    || panelProps.selectedAlbumSong?.artist
    || 'Unknown Artist',
  songs: panelProps.localSongList,
  selectedCount: panelProps.selectedCount,
  scrollArea: tableScrollArea.value,
}));

const detailHeaderListeners = {
  'update:batchMode': (value: boolean) => emitEvent('update:isBatchMode', value),
  'update:artistTab': (value: ArtistTabKey) => emitEvent('update:artistActiveTab', value),
  playAll: () => emitEvent('playAll'),
  batchPlay: () => emitEvent('batchPlay'),
  addToPlaylist: () => emitEvent('showAddToPlaylist'),
  batchDelete: () => emitEvent('batchDelete'),
  batchMove: () => emitEvent('batchMove'),
};
</script>

<template>
  <div class="relative flex min-w-0 flex-1 overflow-hidden">
    <MasterPanel
      v-if="panelProps.localViewMode === 'folder'"
      :is-management-mode="panelProps.isManagementMode"
    />

    <section class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
      <HomeDetailHeaderArea
        v-if="artistViewActive || albumViewActive"
        v-bind="detailHeaderBindings"
        v-on="detailHeaderListeners"
      />

      <HomeDiscoverArea
        v-if="showingDiscoverPage"
        :active-page="panelProps.localViewMode"
        @switch-page="switchDiscoverPage"
      />

      <SongTable
        v-if="songListingShown"
        :ref="attachTableInstance"
        :songs="panelProps.localSongList"
        :song-paths="panelProps.localViewMode === 'playlist' ? panelProps.localSongPaths : undefined"
        :resolve-song-by-path="panelProps.localViewMode === 'playlist' ? panelProps.resolveSongByPath : undefined"
        :isBatchMode="panelProps.isBatchMode"
        :selectedPaths="panelProps.selectedPaths"
        :memory-scope-key="panelProps.songTableMemoryScopeKey"
        :download-completed-as-local="true"
        class="min-h-0"
        @play="emitEvent('playSong', $event)"
        @contextmenu="forwardTableContextMenu"
        @update:selectedPaths="emitEvent('update:selectedPaths', $event)"
        @drag-start="forwardTableDragStart"
      />

      <HomeArtistAlbumArea
        v-if="artistSubPageShown"
        :show-grid="albumGridShown"
        :albums="panelProps.artistAlbumList"
        :cover-map="panelProps.coverCache"
        :loading-set="panelProps.loadingSet"
        @open-album="emitEvent('artistAlbumClick', $event)"
      />
    </section>
  </div>
</template>
