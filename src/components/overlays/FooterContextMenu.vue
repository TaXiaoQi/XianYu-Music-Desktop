<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick, type Component } from 'vue';
import { useRouter } from 'vue-router';
import { Disc3, FileText, Folder, Heart, Image, Info, Plus, UserRound, Video } from 'lucide-vue-next';

import { usePlayer } from '../../features/playback';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useSongInfoDialog } from '../../composables/useSongInfoDialog';
import { useToast } from '../../composables/toast';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { getSongAlbumKey, hasSongAlbumMetadata, resolvePrimaryArtistName } from '../../features/library/playerLibraryViewShared';
import { openOnlineDetail } from '../../features/onlineDetail/store';
import { getStoredPlugins, pluginArtistSearch, pluginAlbumSearch } from '../../services/domain/pluginEngine';
import { supportsMusicVideo } from '../../composables/useBilibiliVideoBackground';
import type { Song } from '../../types';

type FooterMenuAction =
  | 'favorite'
  | 'addToPlaylist'
  | 'viewArtist'
  | 'viewAlbum'
  | 'viewSongInfo'
  | 'changeCover'
  | 'changeLyrics'
  | 'toggleVideoBackground'
  | 'openFolder';

type FooterMenuEntry =
  | { type: 'divider'; key: string }
  | { type: 'action'; key: FooterMenuAction; label: string; icon: Component };

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

const { openInFinder } = usePlayer();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const { openSongInfo } = useSongInfoDialog();
const { showToast } = useToast();
const { isFavorite, toggleFavorite } = useLibraryCollections();
const router = useRouter();
const { openHomeArtist, openHomeAlbum } = useHomeNavigation(router);

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });

/** 是否为在线歌曲（plugin:// 或 lx://） */
const isOnlineSong = computed(() => {
  const path = props.song?.path ?? '';
  return path.startsWith('plugin://') || path.startsWith('lx://');
});

const isBilibiliSong = computed(() => supportsMusicVideo(props.song));

const menuEntries = computed<FooterMenuEntry[]>(() => {
  const isFavorited = props.song ? isFavorite(props.song) : false;
  const favoriteLabel = isFavorited ? '取消收藏' : '收藏歌曲';

  const entries: FooterMenuEntry[] = [
    { type: 'action', key: 'favorite', label: favoriteLabel, icon: Heart },
    { type: 'action', key: 'addToPlaylist', label: '收藏到歌单', icon: Plus },
    { type: 'divider', key: 'divider-1' },
    { type: 'action', key: 'viewArtist', label: '查看歌手', icon: UserRound },
    { type: 'action', key: 'viewAlbum', label: '查看专辑', icon: Disc3 },
  ];

  // 本地歌曲才显示"查看歌曲信息"和"修改歌曲封面"
  if (!isOnlineSong.value) {
    entries.push(
      { type: 'action', key: 'viewSongInfo', label: '查看歌曲信息', icon: Info },
      { type: 'action', key: 'changeCover', label: '修改歌曲封面', icon: Image },
    );
  }

  // 更改歌词 (LRC)
  entries.push({ type: 'action', key: 'changeLyrics', label: '更改歌词 (LRC)', icon: FileText });

  // 播放视频为背景
  if (isBilibiliSong.value) {
    entries.push({
      type: 'action',
      key: 'toggleVideoBackground',
      label: props.videoBackgroundRequested ? '关闭背景视频' : '播放视频为背景',
      icon: Video,
    });
  }

  // 打开文件所在目录 (仅本地)
  if (!isOnlineSong.value) {
    entries.push(
      { type: 'divider', key: 'divider-file' },
      { type: 'action', key: 'openFolder', label: '打开文件所在目录', icon: Folder },
    );
  }

  return entries;
});

watch(
  () => props.visible,
  async (newVal) => {
    if (newVal) {
      await nextTick();
      if (menuRef.value) {
        menuSize.value = {
          width: menuRef.value.offsetWidth,
          height: menuRef.value.offsetHeight,
        };
      }
    }
  },
  { immediate: true },
);

const menuStyle = computed(() => {
  if (!props.visible) return {};

  let top = props.y;
  let left = props.x;

  if (top + menuSize.value.height > window.innerHeight) {
    top = props.y - menuSize.value.height;
  }

  if (left + menuSize.value.width > window.innerWidth) {
    left = props.x - menuSize.value.width;
  }

  top = Math.max(8, top);
  left = Math.max(8, left);

  return {
    left: `${left}px`,
    top: `${top}px`,
    visibility: (menuSize.value.height === 0 ? 'hidden' : 'visible') as any,
  };
});

const handleGlobalClick = (e: MouseEvent) => {
  if (props.visible && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleGlobalClick));
onUnmounted(() => window.removeEventListener('mousedown', handleGlobalClick));

/** 在线歌曲：通过 plugin_id 查找 PluginSource */
const resolvePluginSource = (song: Song) => {
  const pluginId = song.plugin_id || song.rawData?.pluginId;
  if (!pluginId) return null;
  return getStoredPlugins().find((p) => p.id === pluginId) ?? null;
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
    openOnlineDetail({
      type: 'artist',
      title: artist.name,
      subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
      description: artist.description || '',
      coverUrl: artist.avatarUrl,
      pluginSource,
      rawData: artist.rawData,
      platformId: artist.platformId || artist.id,
    });
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
    openOnlineDetail({
      type: 'album',
      title: album.name,
      subtitle: album.artist,
      coverUrl: album.coverUrl,
      pluginSource,
      rawData: album.rawData,
      platformId: album.platformId || album.id,
    });
  } catch (e: any) {
    showToast(`查看专辑失败: ${e?.message || e}`, 'error');
  }
};

const handleAction = (action: FooterMenuAction) => {
  if (!props.song) return;

  switch (action) {
    case 'favorite':
      showToast(toggleFavorite(props.song) ? '已收藏' : '已取消收藏', 'info');
      break;
    case 'addToPlaylist':
      openAddToPlaylistDialog(props.song.path, { songs: [props.song] });
      break;
    case 'viewArtist':
      if (isOnlineSong.value) {
        void handleOnlineViewArtist(props.song);
      } else {
        const artistName = resolvePrimaryArtistName(props.song);
        if (!artistName) {
          showToast('当前歌曲缺少歌手信息', 'info');
          break;
        }
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
        void openHomeAlbum(getSongAlbumKey(props.song));
      }
      break;
    case 'openFolder':
      void openInFinder(props.song.path);
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
  }

  emit('close');
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="fixed z-[9999] min-w-[210px] select-none rounded-[16px] border border-gray-200/60 dark:border-white/10 bg-white/88 dark:bg-[#1e1e20]/90 py-1.5 text-sm text-gray-700 dark:text-gray-200 shadow-xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-75"
      :style="menuStyle"
      @contextmenu.prevent
    >
      <template v-for="entry in menuEntries" :key="entry.key">
        <div
          v-if="entry.type === 'divider'"
          class="my-1 h-px bg-gray-200/70 dark:bg-white/10"
        ></div>
        <div
          v-else
          @click="handleAction(entry.key)"
          class="mx-1 px-3.5 py-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg cursor-pointer flex items-center group transition-colors"
        >
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-white">
            <component :is="entry.icon" class="w-4 h-4" :stroke-width="1.8" />
          </div>
          <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>
