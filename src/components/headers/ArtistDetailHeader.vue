<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../features/library/store';
import { getDisplayCoverUrl } from '../../utils/coverProxy';
import type { ArtistTabId } from '../../utils/artistTabsOrder';
import ArtistBatchBar from './artistDetail/ArtistBatchBar.vue';
import ArtistBioBox from './artistDetail/ArtistBioBox.vue';
import ArtistHero from './artistDetail/ArtistHero.vue';
import ArtistTabsNav from './artistDetail/ArtistTabsNav.vue';
import AvatarWriteBackDialog from './artistDetail/AvatarWriteBackDialog.vue';
import { useArtistCover, gradientClassFor } from './artistDetail/useArtistCover';
import { useAvatarWriter } from './artistDetail/useAvatarWriter';
import { useHeroShrink } from './artistDetail/useHeroShrink';

const props = defineProps<{
  artistName: string;
  activeTab: ArtistTabId;
  isBatchMode: boolean;
  selectedCount?: number;
  totalSongCount?: number;
  songs?: any[];
  readOnly?: boolean;
  hasArtistDetail?: boolean;
  coverUrlOverride?: string;
  description?: string;
  rawData?: any;
  tabNameOverrides?: Partial<Record<ArtistTabId, string>>;
  scrollContainerRef?: HTMLElement | null;
}>();

const emit = defineEmits(['update:isBatchMode', 'update:activeTab', 'playAll', 'batchPlay', 'addToPlaylist', 'batchDelete', 'batchMove', 'selectAll']);

const everythingPicked = computed(() => {
  const total = props.totalSongCount ?? props.songs?.length ?? 0;
  return total > 0 && (props.selectedCount ?? 0) === total;
});

const libraryStore = useLibraryStore();

const artistEntry = computed(() =>
  libraryStore.artistCatalog.find(entry => entry.name === props.artistName),
);

// 只读（在线）模式下的外部封面：异步代理完成后回填
const overrideArtwork = ref('');
watch(() => props.coverUrlOverride, (raw) => {
  overrideArtwork.value = raw
    ? getDisplayCoverUrl(raw, ready => { overrideArtwork.value = ready; })
    : '';
}, { immediate: true });

const { coverUrl, resolving } = useArtistCover(() => props.artistName, () => props.songs);

const shownCover = computed(() => {
  if (props.readOnly && props.coverUrlOverride) return overrideArtwork.value;
  if (artistEntry.value?.avatarPath) return convertFileSrc(artistEntry.value.avatarPath);
  return coverUrl.value;
});

// 简介文案：优先显式 description，其次从原始数据字段中按优先级取值
const bioText = computed(() => {
  const explicit = (props.description || '').trim();
  if (explicit) return explicit;
  const raw: any = props.rawData;
  if (raw && typeof raw === 'object') {
    const candidate =
      raw.artistDesc || raw.artist_intro || raw.intro || raw.briefDesc
      || raw.description || raw.desc || '';
    return candidate.trim();
  }
  return '';
});

const {
  saving: avatarSaving,
  dialogOpen: askWriteBack,
  task: tagTask,
  pickNewAvatar,
  confirmWriteBack,
  confirmAppOnly,
} = useAvatarWriter(() => artistEntry.value);

const scrollBox = computed(() => props.scrollContainerRef ?? null);
const {
  avatarSize,
  infoHeight,
  nameSize,
  nameLine,
  nameGap,
  btnGap,
  bioOpacity,
  bioMaxHeight,
} = useHeroShrink(scrollBox);

const fallbackGradient = computed(() => gradientClassFor(props.artistName));
</script>

<template>
  <div class="px-8 shrink-0 select-none flex flex-col pt-6 pb-0 h-auto justify-start border-b border-black/5 dark:border-white/5 relative z-20 w-full bg-transparent">
    <ArtistBatchBar
      v-if="isBatchMode"
      :everything-picked="everythingPicked"
      @toggle-all="emit('selectAll')"
      @collect="emit('addToPlaylist')"
      @remove="emit('batchDelete')"
      @finish="emit('update:isBatchMode', false)"
    />

    <ArtistHero
      v-else
      :artist-name="artistName"
      :cover="shownCover"
      :loading="resolving"
      :gradient="fallbackGradient"
      :editable="!readOnly"
      :saving="avatarSaving"
      :tag-task="tagTask"
      :size="avatarSize"
      :info-height="infoHeight"
      :name-size="nameSize"
      :name-line="nameLine"
      :name-gap="nameGap"
      :btn-gap="btnGap"
      @pick="pickNewAvatar"
      @play-all="emit('playAll')"
      @manage="emit('update:isBatchMode', true)"
    />

    <ArtistBioBox
      v-if="bioText && !(readOnly && hasArtistDetail)"
      :text="bioText"
      :opacity="bioOpacity"
      :max-height="bioMaxHeight"
    />

    <ArtistTabsNav
      :active-tab="activeTab"
      :read-only="readOnly"
      :has-detail="hasArtistDetail"
      :name-overrides="tabNameOverrides"
      @activate="emit('update:activeTab', $event)"
    />

    <AvatarWriteBackDialog
      v-if="askWriteBack"
      @write-back="confirmWriteBack"
      @save-local="confirmAppOnly"
      @close="askWriteBack = false"
    />
  </div>
</template>
