<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties, type ComponentPublicInstance } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { usePlayer } from '../../composables/player';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useToast } from '../../composables/toast';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { getSongAlbumKey, getSongArtistNames } from '../../features/library/playerLibraryViewShared';
import { useSongInfoDialog } from '../../composables/useSongInfoDialog';
import { isDownloadableOnlineSong } from '../../services/downloadService';
import { downloadToLocal } from '../../composables/useDownloadToLocal';
import type { Song } from '../../types';

type SongMenuAction =
  | 'play'
  | 'playNext'
  | 'addToQueueTail'
  | 'downloadToLocal'
  | 'addAlbumToQueueTail'
  | 'favorite'
  | 'addToPlaylist'
  | 'viewArtist'
  | 'viewAlbum'
  | 'openFolder'
  | 'viewSongInfo'
  | 'removeFromList'
  | 'deleteFromDisk';

type SongMenuEntry =
  | { type: 'divider'; key: string }
  | { type: 'action'; key: SongMenuAction; label: string; danger?: boolean };

type SongMenuRenderEntry =
  | ({ type: 'divider'; key: string; motionIndex: number })
  | ({ type: 'action'; key: SongMenuAction; label: string; danger?: boolean; motionIndex: number });

interface SongMenuIcon {
  fill?: boolean;
  viewBox?: string;
  paths: Array<{
    d: string;
    fillRule?: 'evenodd' | 'nonzero' | 'inherit';
    clipRule?: 'evenodd' | 'nonzero' | 'inherit';
  }>;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  song: Song | null;
  isPlaylistView: boolean;
  isFolderView?: boolean;
  isManagementMode?: boolean;
  isOnlineSearch?: boolean;
  /** 在线详情页容器类型：用于在歌手/专辑容器中隐藏"查看歌手/查看专辑" */
  onlineDetailType?: 'artist' | 'album' | 'playlist';
}>();

const emit = defineEmits(['close', 'add-to-playlist', 'delete-disk', 'view-online-artist', 'view-online-album']);

const route = useRoute();
const router = useRouter();
const { showToast } = useToast();
const { playSong, playNext, addSongToQueue, addAlbumToQueueTail, removeSongFromList, openInFinder, currentViewMode } = usePlayer();
const { removeFromPlaylist, isFavorite, toggleFavorite } = useLibraryCollections();
const { filterCondition } = usePlayerViewState();
const { openSongInfo } = useSongInfoDialog();
const { openHomeArtist, openHomeAlbum } = useHomeNavigation(router);

const menuRef = ref<HTMLElement | null>(null);
const viewArtistTriggerRef = ref<HTMLElement | null>(null);
const artistSubmenuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });
const artistSubmenuSize = ref({ width: 0, height: 0 });
const showArtistSubmenu = ref(false);

const showDeleteFromDisk = computed(() => Boolean(props.isFolderView && props.isManagementMode));

const menuIcons: Record<SongMenuAction, SongMenuIcon> = {
  play: {
    fill: true,
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M8 5.5v13l10.5-6.5z',
      },
    ],
  },
  playNext: {
    fill: true,
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M4.8 7.1c0-.95 1.06-1.52 1.86-1l5.04 3.36c.72.48.72 1.56 0 2.04L6.66 14.86c-.8.53-1.86-.05-1.86-1V7.1zm7.5 0c0-.95 1.06-1.52 1.86-1l5.04 3.36c.72.48.72 1.56 0 2.04l-5.04 3.36c-.8.53-1.86-.05-1.86-1V7.1z',
      },
    ],
  },
  addToQueueTail: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M5 7.5h14' },
      { d: 'M5 12h14' },
      { d: 'M5 16.5h14' },
    ],
  },
  downloadToLocal: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 4v11' },
      { d: 'M8 11l4 4 4-4' },
      { d: 'M5 19h14' },
    ],
  },
addAlbumToQueueTail: {
  fill: false,
  viewBox: '0 0 24 24',
  paths: [
    { d: 'M 2,12 a 5,5 0 1,0 10,0 a 5,5 0 1,0 -10,0' },
    { d: 'M 5.5,12 a 1.5,1.5 0 1,0 3,0 a 1.5,1.5 0 1,0 -3,0' },

    // 队列线条：轻微递增，整体不超过 x≈21.2
    { d: 'M14.75 8.5H19.25' },
    { d: 'M14.75 12H20.25' },
    { d: 'M14.75 15.5H21.25' },
  ],
},
  addToPlaylist: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 5.5v13' },
      { d: 'M5.5 12h13' },
    ],
  },
  favorite: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
    ],
  },
  viewArtist: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 11a3 3 0 100-6 3 3 0 000 6z' },
      { d: 'M6.5 18.5a5.5 5.5 0 0111 0' },
    ],
  },
  viewAlbum: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 18.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13z' },
      { d: 'M12 13.75a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z' },
    ],
  },
  openFolder: {
    fill: true,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M3.5 8.25A2.25 2.25 0 015.75 6h4.07c.48 0 .93.19 1.27.53l1.02 1.02c.34.34.79.53 1.27.53h4.87a2.25 2.25 0 012.25 2.25v5.42A2.25 2.25 0 0118.25 18H5.75A2.25 2.25 0 013.5 15.75v-7.5z' },
    ],
  },
  viewSongInfo: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 10.5v4.75' },
      { d: 'M12 8h.01' },
      { d: 'M12 19a7 7 0 100-14 7 7 0 000 14z' },
    ],
  },
  removeFromList: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M7 7l10 10' },
      { d: 'M17 7L7 17' },
    ],
  },
  deleteFromDisk: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M5 7h14' },
      { d: 'M9 7V5.75A1.75 1.75 0 0110.75 4h2.5A1.75 1.75 0 0115 5.75V7' },
      { d: 'M8 10.5v5.5' },
      { d: 'M12 10.5v5.5' },
      { d: 'M16 10.5v5.5' },
      { d: 'M6.5 7l.7 10.3A2 2 0 009.2 19h5.6a2 2 0 001.99-1.7L17.5 7' },
    ],
  },
};

const menuEntries = computed<SongMenuEntry[]>(() => {
  const online = props.isOnlineSearch;
  const isFavorited = props.song ? isFavorite(props.song) : false;
  const favoriteLabel = isFavorited ? '取消收藏' : '收藏歌曲';

  const entries: SongMenuEntry[] = [
    { type: 'action', key: 'play', label: '播放' },
    { type: 'action', key: 'playNext', label: '下一首播放' },
    { type: 'action', key: 'addToQueueTail', label: '添加到队尾' },
  ];

  // 在线搜索模式：在"添加到队尾"后追加"下载至本地"（仅对可下载的在线歌曲）
  if (online && props.song && isDownloadableOnlineSong(props.song)) {
    entries.push({ type: 'action', key: 'downloadToLocal', label: '下载至本地' });
  }

  // 在线搜索模式不显示"整张专辑添加到队尾"
  if (!online && props.song && hasAlbumMetadata(props.song)) {
    entries.push({ type: 'action', key: 'addAlbumToQueueTail', label: '整张专辑添加到队尾' });
  }

  if (online) {
    // 在线搜索模式：查看歌手、查看专辑，最后是添加到歌单
    // 歌手/专辑容器中隐藏"查看歌手/查看专辑"，歌单容器和搜索页显示完整菜单
    const hideViewNavigation = props.onlineDetailType === 'artist' || props.onlineDetailType === 'album';

    if (!hideViewNavigation) {
      entries.push(
        { type: 'divider', key: 'divider-primary' },
        { type: 'action', key: 'viewArtist', label: '查看歌手' },
        { type: 'action', key: 'viewAlbum', label: '查看专辑' },
      );
    }

    entries.push(
      { type: 'divider', key: 'divider-secondary' },
      { type: 'action', key: 'favorite', label: favoriteLabel },
      { type: 'action', key: 'addToPlaylist', label: '添加到歌单' },
    );
  } else {
    entries.push(
      { type: 'divider', key: 'divider-primary' },
      { type: 'action', key: 'favorite', label: favoriteLabel },
      { type: 'action', key: 'addToPlaylist', label: '添加到歌单' },
      { type: 'action', key: 'viewArtist', label: '查看歌手' },
      { type: 'action', key: 'viewAlbum', label: '查看专辑' },
      { type: 'divider', key: 'divider-secondary' },
      { type: 'action', key: 'openFolder', label: '打开文件所在目录' },
      { type: 'action', key: 'viewSongInfo', label: '查看歌曲信息' },
      { type: 'divider', key: 'divider-danger' },
      { type: 'action', key: 'removeFromList', label: '从列表移除' },
    );

    if (showDeleteFromDisk.value) {
      entries.push({ type: 'action', key: 'deleteFromDisk', label: '从本地移除', danger: true });
    }
  }

  return entries;
});

const renderEntries = computed<SongMenuRenderEntry[]>(() =>
  menuEntries.value.map((entry, motionIndex) => ({ ...entry, motionIndex })),
);

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      if (menuRef.value) {
        menuSize.value = {
          width: menuRef.value.offsetWidth,
          height: menuRef.value.offsetHeight,
        };
      }
      return;
    }

    menuSize.value = { width: 0, height: 0 };
    artistSubmenuSize.value = { width: 0, height: 0 };
    showArtistSubmenu.value = false;
  },
);

watch(showArtistSubmenu, async (visible) => {
  if (visible) {
    await nextTick();
    if (artistSubmenuRef.value) {
      artistSubmenuSize.value = {
        width: artistSubmenuRef.value.offsetWidth,
        height: artistSubmenuRef.value.offsetHeight,
      };
    }
    return;
  }

  artistSubmenuSize.value = { width: 0, height: 0 };
});

const menuStyle = computed<CSSProperties>(() => {
  if (!props.visible) {
    return {};
  }

  let top = props.y;
  let left = props.x;
  let verticalOrigin = 'top';
  let horizontalOrigin = 'left';

  if (top + menuSize.value.height > window.innerHeight) {
    top = props.y - menuSize.value.height;
    verticalOrigin = 'bottom';
  }

  if (left + menuSize.value.width > window.innerWidth) {
    left = props.x - menuSize.value.width;
    horizontalOrigin = 'right';
  }

  return {
    left: `${Math.max(8, left)}px`,
    top: `${Math.max(8, top)}px`,
    visibility: menuSize.value.height === 0 ? 'hidden' : 'visible',
    transformOrigin: `${horizontalOrigin} ${verticalOrigin}`,
  };
});

const handleGlobalClick = (event: MouseEvent) => {
  const target = event.target as Node;
  const clickedInsideMenu = Boolean(menuRef.value?.contains(target));
  const clickedInsideSubmenu = Boolean(artistSubmenuRef.value?.contains(target));

  if (props.visible && !clickedInsideMenu && !clickedInsideSubmenu) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleGlobalClick));
onUnmounted(() => window.removeEventListener('mousedown', handleGlobalClick));

const isMeaningfulMetadataValue = (value: string | undefined) => {
  const normalized = value?.trim() || '';
  return normalized !== '' && normalized.toLowerCase() !== 'unknown';
};

const normalizeArtistOptions = (artists: string[] = []) =>
  artists
    .map(name => name.trim())
    .filter(isMeaningfulMetadataValue)
    .filter((name, index, list) => list.indexOf(name) === index);

const resolveArtistSubmenuOptions = (song: Song) => {
  const effectiveArtists = normalizeArtistOptions(song.effective_artist_names);
  if (effectiveArtists.length > 1) {
    return effectiveArtists;
  }

  const artistNames = normalizeArtistOptions(song.artist_names);
  if (artistNames.length > 1) {
    return artistNames;
  }

  return [];
};

const resolvePrimaryArtistName = (song: Song) =>
  getSongArtistNames(song)
    .map(name => name.trim())
    .find(isMeaningfulMetadataValue) || '';

const artistSubmenuOptions = computed(() =>
  props.song ? resolveArtistSubmenuOptions(props.song) : [],
);

const hasArtistSubmenu = computed(() => artistSubmenuOptions.value.length > 1);

watch(artistSubmenuOptions, (options) => {
  if (options.length <= 1) {
    showArtistSubmenu.value = false;
  }
});

const hasArtistMetadata = (song: Song) =>
  Boolean(
    resolvePrimaryArtistName(song)
    || song.artist_names.some(isMeaningfulMetadataValue)
    || song.effective_artist_names.some(isMeaningfulMetadataValue),
  );

const hasAlbumMetadata = (song: Song) =>
  isMeaningfulMetadataValue(song.album)
  || (
    Boolean(song.album_key?.trim())
    && !song.album_key.trim().toLowerCase().startsWith('unknown::')
  );

const artistSubmenuStyle = computed<CSSProperties>(() => {
  if (!showArtistSubmenu.value || !viewArtistTriggerRef.value) {
    return {};
  }

  const triggerRect = viewArtistTriggerRef.value.getBoundingClientRect();
  let top = triggerRect.top - 6;
  let left = triggerRect.right + 8;
  let verticalOrigin = 'top';
  let horizontalOrigin = 'left';

  if (left + artistSubmenuSize.value.width > window.innerWidth) {
    left = triggerRect.left - artistSubmenuSize.value.width - 8;
    horizontalOrigin = 'right';
  }

  if (top + artistSubmenuSize.value.height > window.innerHeight) {
    top = window.innerHeight - artistSubmenuSize.value.height - 8;
    verticalOrigin = 'bottom';
  }

  return {
    left: `${Math.max(8, left)}px`,
    top: `${Math.max(8, top)}px`,
    visibility: artistSubmenuSize.value.height === 0 ? 'hidden' : 'visible',
    transformOrigin: `${horizontalOrigin} ${verticalOrigin}`,
  };
});

const closeArtistSubmenu = () => {
  showArtistSubmenu.value = false;
};

const openArtistSubmenu = () => {
  if (!hasArtistSubmenu.value) {
    showArtistSubmenu.value = false;
    return;
  }

  showArtistSubmenu.value = true;
};

const navigateToArtist = (artistName: string) => {
  if (!isMeaningfulMetadataValue(artistName)) {
    showToast('当前歌曲缺少歌手信息', 'info');
    return;
  }

  void openHomeArtist(artistName);
  emit('close');
};

const handleRemoveFromList = () => {
  if (!props.song) {
    return;
  }

  if (props.isPlaylistView) {
    removeFromPlaylist(filterCondition.value, props.song.path);
    return;
  }

  if (route.path === '/favorites' || route.path === '/recent' || currentViewMode.value === 'all') {
    void removeSongFromList(props.song);
    return;
  }

  showToast('当前页面暂不支持从列表移除', 'info');
};

const handleEntryMouseEnter = (action: SongMenuAction) => {
  if (action === 'viewArtist') {
    openArtistSubmenu();
    return;
  }

  closeArtistSubmenu();
};

/**
 * 下载至本地：复用共享下载逻辑（useDownloadToLocal），
 * 状态写入 download store，自动联动底栏下载 UI 动画。
 */
const handleDownloadToLocal = async (song: Song) => {
  await downloadToLocal(song);
};

const handleAction = (action: SongMenuAction) => {
  if (!props.song) {
    return;
  }

  switch (action) {
    case 'play':
      void playSong(props.song);
      break;
    case 'playNext':
      playNext(props.song);
      break;
    case 'addToQueueTail':
      addSongToQueue(props.song);
      break;
    case 'downloadToLocal':
      void handleDownloadToLocal(props.song);
      break;
    case 'addAlbumToQueueTail':
      addAlbumToQueueTail(props.song);
      break;
    case 'favorite':
      showToast(toggleFavorite(props.song) ? '已收藏' : '已取消收藏', 'info');
      break;
    case 'addToPlaylist':
      emit('add-to-playlist');
      break;
    case 'viewArtist':
      if (props.isOnlineSearch) {
        emit('view-online-artist', props.song);
        emit('close');
        return;
      }
      if (!hasArtistMetadata(props.song)) {
        showToast('当前歌曲缺少歌手信息', 'info');
        break;
      }
      if (hasArtistSubmenu.value) {
        openArtistSubmenu();
        return;
      }
      navigateToArtist(resolvePrimaryArtistName(props.song));
      return;
    case 'viewAlbum':
      if (props.isOnlineSearch) {
        emit('view-online-album', props.song);
        emit('close');
        return;
      }
      if (!hasAlbumMetadata(props.song)) {
        showToast('当前歌曲缺少专辑信息', 'info');
        break;
      }
      void openHomeAlbum(getSongAlbumKey(props.song));
      break;
    case 'openFolder':
      void openInFinder(props.song.path);
      break;
    case 'viewSongInfo':
      openSongInfo(props.song);
      break;
    case 'removeFromList':
      handleRemoveFromList();
      break;
    case 'deleteFromDisk':
      emit('delete-disk', props.song);
      break;
  }

  emit('close');
};

const setViewArtistTriggerRef = (element: Element | ComponentPublicInstance | null) => {
  if (element instanceof HTMLElement) {
    viewArtistTriggerRef.value = element;
    return;
  }

  viewArtistTriggerRef.value =
    element && '$el' in element && element.$el instanceof HTMLElement
      ? element.$el
      : null;
};
</script>

<template>
  <Teleport to="body">
    <Transition name="song-menu-pop" appear>
      <div
        v-if="visible"
        ref="menuRef"
        class="fixed z-[9999] min-w-[220px] select-none rounded-[18px] border border-white/65 bg-white/78 py-1.5 text-sm text-gray-700 shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72"
        :style="menuStyle"
        @contextmenu.prevent
      >
        <template v-for="entry in renderEntries" :key="entry.key">
          <div
            v-if="entry.type === 'divider'"
            class="song-menu-divider"
            :style="{ '--menu-item-delay': `${entry.motionIndex * 14}ms` }"
          ></div>
          <div
            v-else
            class="song-menu-item flex cursor-pointer items-center px-4 py-2.5 transition-colors"
            :class="entry.danger ? 'text-[#EC4141] hover:text-[#d73a3a]' : ''"
            :style="{ '--menu-item-delay': `${entry.motionIndex * 14}ms` }"
            :ref="entry.key === 'viewArtist' ? setViewArtistTriggerRef : undefined"
            @mouseenter="handleEntryMouseEnter(entry.key)"
            @click="handleAction(entry.key)"
          >
            <div class="mr-3 flex h-5 w-5 shrink-0 items-center justify-center text-[#6b778c]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                :viewBox="menuIcons[entry.key].viewBox || '0 0 24 24'"
                :fill="menuIcons[entry.key].fill ? 'currentColor' : 'none'"
                :stroke="menuIcons[entry.key].fill ? 'none' : 'currentColor'"
                :stroke-width="menuIcons[entry.key].fill ? undefined : '1.7'"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  v-for="(path, pathIndex) in menuIcons[entry.key].paths"
                  :key="`${entry.key}-${pathIndex}`"
                  :d="path.d"
                  :fill-rule="path.fillRule"
                  :clip-rule="path.clipRule"
                />
              </svg>
            </div>
            <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
            <div
              v-if="entry.key === 'viewArtist' && hasArtistSubmenu"
              class="ml-3 flex h-4 w-4 shrink-0 items-center justify-center text-[#8b97aa]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </div>
          </div>
        </template>
      </div>
    </Transition>

    <Transition name="song-menu-pop" appear>
      <div
        v-if="visible && showArtistSubmenu && hasArtistSubmenu"
        ref="artistSubmenuRef"
        class="fixed z-[10000] min-w-[200px] max-w-[280px] select-none rounded-[18px] border border-white/65 bg-white/78 py-1.5 text-sm text-gray-700 shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72"
        :style="artistSubmenuStyle"
        @contextmenu.prevent
      >
        <div
          v-for="artistName in artistSubmenuOptions"
          :key="artistName"
          class="song-menu-item flex cursor-pointer items-center px-4 py-2.5 transition-colors"
          @click="navigateToArtist(artistName)"
        >
          <span class="min-w-0 flex-1 truncate">{{ artistName }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.song-menu-item {
  margin: 0 0.375rem;
  border-radius: 12px;
}

.song-menu-item:hover {
  background: rgba(15, 23, 42, 0.055);
}

.song-menu-divider {
  height: 1px;
  margin: 0.34rem 0.85rem;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.34), rgba(148, 163, 184, 0));
}

.song-menu-pop-enter-active,
.song-menu-pop-leave-active {
  will-change: opacity, transform;
}

.song-menu-pop-enter-active {
  animation: song-menu-enter 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.song-menu-pop-leave-active {
  animation: song-menu-leave 140ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-menu-pop-enter-active .song-menu-item,
.song-menu-pop-enter-active .song-menu-divider {
  animation: song-menu-item-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--menu-item-delay, 0ms);
}

@keyframes song-menu-enter {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.965);
  }

  72% {
    opacity: 1;
    transform: translateY(-1px) scale(1.008);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes song-menu-leave {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  100% {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }
}

@keyframes song-menu-item-in {
  0% {
    opacity: 0;
    transform: translateY(6px);
  }

  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
