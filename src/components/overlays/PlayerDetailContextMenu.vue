<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch, computed, type CSSProperties } from 'vue';
import { useRouter } from 'vue-router';

import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useSongInfoDialog } from '../../composables/useSongInfoDialog';
import { useToast } from '../../composables/toast';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { getSongAlbumKey, hasSongAlbumMetadata, resolvePrimaryArtistName } from '../../features/library/playerLibraryViewShared';
import { useOnlineDetailStore } from '../../features/onlineDetail/store';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { getStoredPlugins, pluginArtistSearch, pluginAlbumSearch } from '../../services/pluginEngine';
import { isBilibiliPluginSong } from '../../composables/useBilibiliVideoBackground';
import type { Song } from '../../types';

type DetailMenuAction =
  | 'viewArtist'
  | 'viewAlbum'
  | 'viewSongInfo'
  | 'changeCover'
  | 'changeLyrics'
  | 'toggleVideoBackground'
  | 'addToPlaylist';

interface MenuEntry {
  key: DetailMenuAction;
  label: string;
  icon: { viewBox: string; fill: boolean; paths: { d: string }[] };
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  song: Song | null;
  videoBackgroundRequested?: boolean;
  videoBackgroundLoading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'change-lyrics'): void;
  (e: 'toggle-video-background'): void;
}>();

const router = useRouter();
const { showToast } = useToast();
const { openSongInfo } = useSongInfoDialog();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const { openHomeArtist, openHomeAlbum } = useHomeNavigation(router);
const onlineDetailStore = useOnlineDetailStore();
const { closePlayerDetail } = usePlaybackController();

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });

/** 是否为在线歌曲（plugin:// 或 lx://） */
const isOnlineSong = computed(() => {
  const path = props.song?.path ?? '';
  return path.startsWith('plugin://') || path.startsWith('lx://');
});
const isBilibiliSong = computed(() => isBilibiliPluginSong(props.song));

/** 图标定义 */
const menuIcons: Record<DetailMenuAction, MenuEntry['icon']> = {
  viewArtist: {
    viewBox: '0 0 24 24',
    fill: false,
    paths: [
      { d: 'M12 11a3 3 0 100-6 3 3 0 000 6z' },
      { d: 'M6.5 18.5a5.5 5.5 0 0111 0' },
    ],
  },
  viewAlbum: {
    viewBox: '0 0 24 24',
    fill: false,
    paths: [
      { d: 'M12 18.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13z' },
      { d: 'M12 13.75a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z' },
    ],
  },
  viewSongInfo: {
    viewBox: '0 0 24 24',
    fill: false,
    paths: [
      { d: 'M12 10.5v4.75' },
      { d: 'M12 8h.01' },
      { d: 'M12 19a7 7 0 100-14 7 7 0 000 14z' },
    ],
  },
  changeCover: {
    viewBox: '0 0 24 24',
    fill: false,
    paths: [
      { d: 'M4 5.5h16a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0120 18.5H4A1.5 1.5 0 012.5 17V7A1.5 1.5 0 014 5.5z' },
      { d: 'M8 11.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z' },
      { d: 'M3.5 16.5l4.2-4.2a1 1 0 011.4 0l2.4 2.4a1 1 0 001.4 0l1.6-1.6a1 1 0 011.4 0l4.2 4.2' },
    ],
  },
  changeLyrics: {
    viewBox: '0 0 24 24',
    fill: false,
    paths: [
      { d: 'M7 5.5h10' },
      { d: 'M7 9.5h7' },
      { d: 'M7 13.5h5' },
      { d: 'M15.5 13.5l3 3' },
      { d: 'M18.5 13.5l-3 3' },
      { d: 'M5 3.5h14a1.5 1.5 0 011.5 1.5v14A1.5 1.5 0 0119 20.5H5A1.5 1.5 0 013.5 19V5A1.5 1.5 0 015 3.5z' },
    ],
  },
  toggleVideoBackground: {
    viewBox: '0 0 24 24',
    fill: false,
    paths: [
      { d: 'M4 6.5A1.5 1.5 0 015.5 5h9A1.5 1.5 0 0116 6.5v11a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 014 17.5z' },
      { d: 'M16 9l4-2v10l-4-2' },
      { d: props.videoBackgroundRequested ? 'M8.5 9h3v6h-3z' : 'M8.5 8.5l4.5 3.5-4.5 3.5z' },
    ],
  },
  addToPlaylist: {
    viewBox: '0 0 24 24',
    fill: false,
    paths: [
      { d: 'M12 5.5v13' },
      { d: 'M5.5 12h13' },
    ],
  },
};

/** 菜单项：歌手/专辑 → 歌曲信息(仅本地) → 更改歌词 → 分隔线 → 添加到歌单 */
const menuEntries = computed<MenuEntry[]>(() => {
  const entries: MenuEntry[] = [];

  entries.push(
    {
      key: 'viewArtist',
      label: '查看歌手',
      icon: menuIcons.viewArtist,
    },
    {
      key: 'viewAlbum',
      label: '查看专辑',
      icon: menuIcons.viewAlbum,
    },
  );

  // 本地歌曲才显示"查看歌曲信息"和"修改歌曲封面"，在线歌曲屏蔽
  if (!isOnlineSong.value) {
    entries.push({
      key: 'viewSongInfo',
      label: '查看歌曲信息',
      icon: menuIcons.viewSongInfo,
    });
    entries.push({
      key: 'changeCover',
      label: '修改歌曲封面',
      icon: menuIcons.changeCover,
    });
  }

  entries.push({
    key: 'changeLyrics',
    label: '更改歌词 (LRC)',
    icon: menuIcons.changeLyrics,
  });

  if (isBilibiliSong.value) {
    entries.push({
      key: 'toggleVideoBackground',
      label: props.videoBackgroundRequested ? '关闭背景视频' : '播放视频为背景',
      icon: menuIcons.toggleVideoBackground,
    });
  }

  // 添加到歌单放置在最后
  entries.push({
    key: 'addToPlaylist',
    label: '添加到歌单',
    icon: menuIcons.addToPlaylist,
  });

  return entries;
});

/** 分隔线位置：在歌词操作后（与添加到歌单组分隔） */
const dividerAfterKeys = computed(() => new Set<DetailMenuAction>(['changeLyrics']));

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
  },
  { immediate: true },
);

const menuStyle = computed<CSSProperties>(() => {
  if (!props.visible) return {};

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
  if (props.visible && !menuRef.value?.contains(target)) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleGlobalClick));
onUnmounted(() => window.removeEventListener('mousedown', handleGlobalClick));

/** 在线歌曲：通过 plugin_id 查找 PluginSource */
const resolvePluginSource = (song: Song) => {
  const pluginId = song.plugin_id || song.rawData?.pluginId;
  if (!pluginId) return null;
  return getStoredPlugins().find(p => p.id === pluginId) ?? null;
};

/** 在线歌曲查看歌手：搜索歌手后跳转到在线详情页 */
const handleOnlineViewArtist = async (song: Song) => {
  const artistName = song.effective_artist_names?.[0]
    || song.artist_names?.[0]
    || song.artist
    || '';
  if (!artistName || artistName === '未知歌手') {
    showToast('当前歌曲缺少歌手信息', 'info');
    return;
  }

  // LX 音源暂不支持歌手详情页
  if (song.path.startsWith('lx://')) {
    showToast('当前音源暂不支持查看歌手', 'info');
    return;
  }

  const pluginSource = resolvePluginSource(song);
  if (!pluginSource) {
    showToast('当前音源不支持查看歌手', 'info');
    return;
  }

  try {
    const results = await pluginArtistSearch(pluginSource, artistName, 1);
    if (results.length === 0) {
      showToast('未找到该歌手', 'info');
      return;
    }
    const artist = results[0];
    onlineDetailStore.setContext({
      type: 'artist',
      title: artist.name,
      subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
      coverUrl: artist.avatarUrl,
      pluginSource,
      rawData: artist.rawData,
    });
    closePlayerDetail();
    void router.push({ path: '/online-detail', query: { type: 'artist' } });
  } catch (e: any) {
    showToast(`查看歌手失败: ${e?.message || e}`, 'error');
  }
};

/** 在线歌曲查看专辑：搜索专辑后跳转到在线详情页 */
const handleOnlineViewAlbum = async (song: Song) => {
  const albumName = song.album || '';
  if (!albumName || albumName === '未知专辑') {
    showToast('当前歌曲缺少专辑信息', 'info');
    return;
  }

  // LX 音源暂不支持专辑详情页
  if (song.path.startsWith('lx://')) {
    showToast('当前音源暂不支持查看专辑', 'info');
    return;
  }

  const pluginSource = resolvePluginSource(song);
  if (!pluginSource) {
    showToast('当前音源不支持查看专辑', 'info');
    return;
  }

  try {
    const results = await pluginAlbumSearch(pluginSource, albumName, 1);
    if (results.length === 0) {
      showToast('未找到该专辑', 'info');
      return;
    }
    const album = results[0];
    onlineDetailStore.setContext({
      type: 'album',
      title: album.name,
      subtitle: album.artist,
      coverUrl: album.coverUrl,
      pluginSource,
      rawData: album.rawData,
    });
    closePlayerDetail();
    void router.push({ path: '/online-detail', query: { type: 'album' } });
  } catch (e: any) {
    showToast(`查看专辑失败: ${e?.message || e}`, 'error');
  }
};

const handleAction = (action: DetailMenuAction) => {
  if (!props.song) return;

  switch (action) {
    case 'viewArtist':
      if (isOnlineSong.value) {
        void handleOnlineViewArtist(props.song);
      } else {
        const artistName = resolvePrimaryArtistName(props.song);
        if (!artistName) {
          showToast('当前歌曲缺少歌手信息', 'info');
          break;
        }
        closePlayerDetail();
        void openHomeArtist(artistName);
      }
      break;
    case 'viewAlbum':
      if (isOnlineSong.value) {
        void handleOnlineViewAlbum(props.song);
      } else {
        if (!hasSongAlbumMetadata(props.song)) {
          showToast('当前歌曲缺少专辑信息', 'info');
          break;
        }
        closePlayerDetail();
        void openHomeAlbum(getSongAlbumKey(props.song));
      }
      break;
    case 'viewSongInfo':
      openSongInfo(props.song);
      break;
    case 'changeCover':
      openSongInfo(props.song, 'cover');
      break;
    case 'changeLyrics':
      emit('change-lyrics');
      break;
    case 'toggleVideoBackground':
      emit('toggle-video-background');
      break;
    case 'addToPlaylist':
      openAddToPlaylistDialog(props.song.path, { songs: [props.song] });
      break;
  }

  emit('close');
};
</script>

<template>
  <Teleport to="body">
    <Transition name="player-detail-menu-pop" appear>
      <div
        v-if="visible"
        ref="menuRef"
        class="fixed z-[9999] min-w-[220px] select-none rounded-[18px] border border-white/65 bg-white/78 py-1.5 text-sm text-gray-700 shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72"
        :style="menuStyle"
        @contextmenu.prevent
      >
        <template v-for="(entry, index) in menuEntries" :key="entry.key">
          <!-- 分隔线：在 changeLyrics 后（封面/字幕组与歌手/专辑组分隔）和 addToPlaylist 前 -->
          <div
            v-if="index > 0 && dividerAfterKeys.has(menuEntries[index - 1].key)"
            class="player-detail-menu-divider"
            :style="{ '--menu-item-delay': `${index * 14}ms` }"
          ></div>
          <div
            class="player-detail-menu-item flex cursor-pointer items-center px-4 py-2.5 transition-colors"
            :style="{ '--menu-item-delay': `${index * 14}ms` }"
            @click="handleAction(entry.key)"
          >
            <div class="mr-3 flex h-5 w-5 shrink-0 items-center justify-center text-[#6b778c]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                :viewBox="entry.icon.viewBox"
                :fill="entry.icon.fill ? 'currentColor' : 'none'"
                :stroke="entry.icon.fill ? 'none' : 'currentColor'"
                :stroke-width="entry.icon.fill ? undefined : '1.7'"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path v-for="(p, i) in entry.icon.paths" :key="i" :d="p.d" />
              </svg>
            </div>
            <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.player-detail-menu-item {
  margin: 0 0.375rem;
  border-radius: 12px;
}

.player-detail-menu-item:hover {
  background: rgba(15, 23, 42, 0.055);
}

.player-detail-menu-divider {
  height: 1px;
  margin: 0.34rem 0.85rem;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.34), rgba(148, 163, 184, 0));
}

.player-detail-menu-pop-enter-active {
  will-change: opacity, transform;
  animation: player-detail-menu-enter 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.player-detail-menu-pop-leave-active {
  will-change: opacity, transform;
  animation: player-detail-menu-leave 140ms cubic-bezier(0.4, 0, 0.2, 1);
}

.player-detail-menu-pop-enter-active .player-detail-menu-item,
.player-detail-menu-pop-enter-active .player-detail-menu-divider {
  animation: player-detail-menu-item-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--menu-item-delay, 0ms);
}

@keyframes player-detail-menu-enter {
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

@keyframes player-detail-menu-leave {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }
}

@keyframes player-detail-menu-item-in {
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
