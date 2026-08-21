<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import type { Song } from '../../types';
import type { HomeDiscoverTab } from './HomeDiscoverTabs.vue';
import StatisticsPage from '../statistics/StatisticsPage.vue';
import DailyRecommend from '../../views/DailyRecommend.vue';
import TopLists from '../../views/TopLists.vue';

const AlbumDetailHeader = defineAsyncComponent(() => import('../headers/AlbumDetailHeader.vue'));
const ArtistDetailHeader = defineAsyncComponent(() => import('../headers/ArtistDetailHeader.vue'));
const MasterPanel = defineAsyncComponent(() => import('../song-list/MasterPanel.vue'));
const SongTable = defineAsyncComponent(() => import('../song-list/SongTable.vue'));
const HomeDiscoverTabs = defineAsyncComponent(() => import('./HomeDiscoverTabs.vue'));
const ArtistAlbumGrid = defineAsyncComponent(() => import('./ArtistAlbumGrid.vue'));
const HomeEmptyState = defineAsyncComponent(() => import('./HomeEmptyState.vue'));

interface ArtistAlbumItem {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

interface Props {
  localViewMode: string;
  isBatchMode: boolean;
  isManagementMode: boolean;
  artistActiveTab: 'songs' | 'albums' | 'details';
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

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:isBatchMode', value: boolean): void;
  (event: 'update:artistActiveTab', value: 'songs' | 'albums' | 'details'): void;
  (event: 'update:selectedPaths', value: Set<string>): void;
  (event: 'playAll'): void;
  (event: 'batchPlay'): void;
  (event: 'showAddToPlaylist'): void;
  (event: 'batchDelete'): void;
  (event: 'batchMove'): void;
  (event: 'playSong', song: Song): void;
  (event: 'contextMenuSong', nativeEvent: MouseEvent, song: Song): void;
  (event: 'tableDragStart', ...args: any[]): void;
  (event: 'artistAlbumClick', albumKey: string): void;
}>();

const isBatchModeModel = computed({
  get: () => props.isBatchMode,
  set: (value: boolean) => emit('update:isBatchMode', value),
});

const artistActiveTabModel = computed({
  get: () => props.artistActiveTab,
  set: (value: 'songs' | 'albums' | 'details') => emit('update:artistActiveTab', value),
});

const localSongTableRef = ref<any>(null);

watch(localSongTableRef, value => {
  props.setSongTableRef?.(value);
}, { immediate: true });

/** 歌曲列表滚动容器：驱动歌手/专辑详情头部的滚动缩小封面效果 */
const songTableScrollContainer = computed(() => localSongTableRef.value?.containerRef ?? null);

onBeforeUnmount(() => {
  props.setSongTableRef?.(null);
});

const handleSongContextMenu = (...args: [MouseEvent, Song]) => {
  emit('contextMenuSong', args[0], args[1]);
};

const handleTableDragStart = (...args: any[]) => {
  emit('tableDragStart', ...args);
};

const router = useRouter();

/** 发现区（统计 / 每日推荐 / 音源榜单）：首页顶部 TAB 切换的三种内容视图 */
const isDiscoverMode = computed(() =>
  ['statistics', 'dailyRecommend', 'topLists'].includes(props.localViewMode),
);

/** TAB 切换：走路由 query，由 useHomeRouteSync 双向同步回 currentViewMode */
const handleDiscoverTabChange = (tab: HomeDiscoverTab) => {
  if (props.localViewMode === tab) return;
  void router.replace({
    path: '/',
    query: tab === 'statistics' ? {} : { view: tab },
  });
};
</script>

<template>
  <div class="flex-1 flex overflow-hidden relative min-w-0">
    <MasterPanel
      v-if="localViewMode === 'folder'"
      :isManagementMode="isManagementMode"
    />

    <section class="flex-1 min-w-0 min-h-0 flex flex-col overflow-x-hidden relative">
      <ArtistDetailHeader
        v-if="localViewMode === 'artist'"
        v-model:isBatchMode="isBatchModeModel"
        v-model:activeTab="artistActiveTabModel"
        :artistName="localFilterCondition || 'Unknown Artist'"
        :songs="localSongList"
        :selectedCount="selectedCount"
        :scrollContainerRef="songTableScrollContainer"
        @playAll="$emit('playAll')"
        @batchPlay="$emit('batchPlay')"
        @addToPlaylist="$emit('showAddToPlaylist')"
        @batchDelete="$emit('batchDelete')"
        @batchMove="$emit('batchMove')"
      />

      <AlbumDetailHeader
        v-else-if="localViewMode === 'album'"
        v-model:isBatchMode="isBatchModeModel"
        :albumName="selectedAlbumSong?.album || 'Unknown Album'"
        :albumArtist="selectedAlbumSong?.album_artist || selectedAlbumSong?.artist || 'Unknown Artist'"
        :songs="localSongList"
        :selectedCount="selectedCount"
        :scrollContainerRef="songTableScrollContainer"
        @playAll="$emit('playAll')"
        @batchPlay="$emit('batchPlay')"
        @addToPlaylist="$emit('showAddToPlaylist')"
        @batchDelete="$emit('batchDelete')"
        @batchMove="$emit('batchMove')"
      />

      <!-- 发现区：顶部 TAB（统计 / 每日推荐 / 音源榜单）。
           KeepAlive 缓存三个视图：切 TAB 仅 deactivate/activate，不重新挂载，
           列表状态与滚动位置保留，避免每次切换都出现加载动画像"整页刷新" -->
      <div v-if="isDiscoverMode" class="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        <HomeDiscoverTabs :active-mode="localViewMode" @change="handleDiscoverTabChange" />
        <!-- 发现区 TAB 切换：复用全局 page-fade（与侧边栏路由切换同一套动效，
     opacity 0.3s ease + 自上而下/从下往上的 6px 位移），三视图统一 -->
<Transition name="page-fade" mode="out-in">
          <KeepAlive>
            <StatisticsPage v-if="localViewMode === 'statistics'" key="statistics" class="flex-1 min-h-0" />
            <DailyRecommend v-else-if="localViewMode === 'dailyRecommend'" key="dailyRecommend" class="flex-1 min-h-0" />
            <TopLists v-else-if="localViewMode === 'topLists'" key="topLists" class="flex-1 min-h-0" />
          </KeepAlive>
        </Transition>
      </div>

      <Transition v-else name="tab-slide">
        <ArtistAlbumGrid
          v-if="localViewMode === 'artist' && artistActiveTab === 'albums'"
          :albums="artistAlbumList"
          :coverCache="coverCache"
          :loadingSet="loadingSet"
          @openAlbum="$emit('artistAlbumClick', $event)"
        />

        <HomeEmptyState
          v-else-if="localViewMode === 'artist' && artistActiveTab === 'details'"
          message="Artist details coming soon"
          icon-path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />

        <SongTable
          v-else
          ref="localSongTableRef"
          :songs="localSongList"
          :song-paths="localViewMode === 'playlist' ? localSongPaths : undefined"
          :resolve-song-by-path="localViewMode === 'playlist' ? resolveSongByPath : undefined"
          :isBatchMode="isBatchMode"
          :selectedPaths="selectedPaths"
          :memoryScopeKey="songTableMemoryScopeKey"
          :download-completed-as-local="true"
          class="min-h-0"
          @play="$emit('playSong', $event)"
          @contextmenu="handleSongContextMenu"
          @update:selectedPaths="$emit('update:selectedPaths', $event)"
          @drag-start="handleTableDragStart"
        />
      </Transition>
    </section>
  </div>
</template>

<style scoped>
.tab-slide-enter-active,
.tab-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.tab-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.tab-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
