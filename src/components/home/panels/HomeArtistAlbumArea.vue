<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

interface ArtistAlbumEntry {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

interface HomeArtistAlbumAreaProps {
  showGrid: boolean;
  albums: ArtistAlbumEntry[];
  coverMap: Map<string, string>;
  loadingSet: Set<string>;
}

const props = defineProps<HomeArtistAlbumAreaProps>();

const emit = defineEmits<{
  (e: 'openAlbum', albumKey: string): void;
}>();

const ArtistAlbumGrid = defineAsyncComponent(() => import('../ArtistAlbumGrid.vue'));
const HomeEmptyState = defineAsyncComponent(() => import('../HomeEmptyState.vue'));
</script>

<template>
  <Transition name="artist-subpage-swap">
    <ArtistAlbumGrid
      v-if="props.showGrid"
      :albums="props.albums"
      :coverCache="props.coverMap"
      :loadingSet="props.loadingSet"
      @openAlbum="emit('openAlbum', $event)"
    />

    <HomeEmptyState
      v-else
      message="Artist details coming soon"
      icon-path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </Transition>
</template>

<style scoped>
.artist-subpage-swap-enter-active,
.artist-subpage-swap-leave-active {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.artist-subpage-swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.artist-subpage-swap-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
