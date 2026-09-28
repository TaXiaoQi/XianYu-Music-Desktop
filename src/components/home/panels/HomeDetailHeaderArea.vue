<script setup lang="ts">
import { computed } from 'vue';

import type { Song } from '../../../types';
import ArtistDetailHeader from '../../headers/ArtistDetailHeader.vue';
import AlbumDetailHeader from '../../headers/AlbumDetailHeader.vue';

type ArtistTabKey = 'songs' | 'albums' | 'details';

interface HomeDetailHeaderProps {
  mode: string;
  batchMode: boolean;
  artistTab: ArtistTabKey;
  artistName: string;
  albumTitle: string;
  albumArtistName: string;
  songs: Song[];
  selectedCount: number;
  scrollArea: HTMLElement | null;
}

const props = defineProps<HomeDetailHeaderProps>();

const emit = defineEmits<{
  (e: 'update:batchMode', value: boolean): void;
  (e: 'update:artistTab', value: ArtistTabKey): void;
  (e: 'playAll'): void;
  (e: 'batchPlay'): void;
  (e: 'addToPlaylist'): void;
  (e: 'batchDelete'): void;
  (e: 'batchMove'): void;
}>();

const batchSwitch = computed<boolean>({
  get() {
    return props.batchMode;
  },
  set(next) {
    emit('update:batchMode', next);
  },
});

const tabSwitch = computed<ArtistTabKey>({
  get() {
    return props.artistTab;
  },
  set(next) {
    emit('update:artistTab', next);
  },
});
</script>

<template>
  <ArtistDetailHeader
    v-if="props.mode === 'artist'"
    v-model:isBatchMode="batchSwitch"
    v-model:activeTab="tabSwitch"
    :artistName="props.artistName"
    :songs="props.songs"
    :selectedCount="props.selectedCount"
    :scrollContainerRef="props.scrollArea"
    @playAll="emit('playAll')"
    @batchPlay="emit('batchPlay')"
    @addToPlaylist="emit('addToPlaylist')"
    @batchDelete="emit('batchDelete')"
    @batchMove="emit('batchMove')"
  />

  <AlbumDetailHeader
    v-else-if="props.mode === 'album'"
    v-model:isBatchMode="batchSwitch"
    :albumName="props.albumTitle"
    :albumArtist="props.albumArtistName"
    :songs="props.songs"
    :selectedCount="props.selectedCount"
    :scrollContainerRef="props.scrollArea"
    @playAll="emit('playAll')"
    @batchPlay="emit('batchPlay')"
    @addToPlaylist="emit('addToPlaylist')"
    @batchDelete="emit('batchDelete')"
    @batchMove="emit('batchMove')"
  />
</template>
