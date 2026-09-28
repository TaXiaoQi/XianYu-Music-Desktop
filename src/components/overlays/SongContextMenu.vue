<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, type ComponentPublicInstance } from 'vue';
import { useRoute } from 'vue-router';
import { useRouter } from 'vue-router';

import { usePlayer } from '../../features/playback';
import { launchFlyingCover } from '../../composables/useFlyingCover';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useToast } from '../../composables/toast';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import {
  getSongAlbumKey,
  hasSongAlbumMetadata,
  hasSongArtistMetadata,
  isMeaningfulMetadataValue,
  resolveArtistSubmenuOptions,
  resolvePrimaryArtistName,
} from '../../features/library/playerLibraryViewShared';
import { useSongInfoDialog } from '../../composables/useSongInfoDialog';
import { isDownloadableOnlineSong } from '../../services/domain/downloadService';
import { useDownloadDialog } from '../../composables/useDownloadDialog';
import { useCollectionsStore } from '../../features/collections/store';
import { songToSyncPayload } from '../../services/domain/playlistSync';
import {
  addCloudKeepSongs,
  addLocalOnlySongs,
  addPendingDeletedSongs,
} from '../../services/domain/playlistSongSyncState';
import type { SyncDeleteScope } from './SyncDeleteScopeModal.vue';
import type { Song as SongEntity } from '../../types';

import CtxRow from './contextMenu/CtxRow.vue';
import GlyphIcon from './contextMenu/GlyphIcon.vue';
import MenuSurface from './contextMenu/MenuSurface.vue';
import { GLASS_SHEET, GLASS_SHEET_WIDE } from './contextMenu/sheetChrome';
import { rowLag } from './contextMenu/motion';
import { planSongMenu, songGlyphs, type SongMenuCommand } from './contextMenu/songMenuPlan';
import { watchPointerAway } from './contextMenu/onPointerAway';

/**
 * 歌曲右键菜单。条目由 songMenuPlan 数据驱动编排，图标经 GlyphIcon 渲染，
 * 定位/动效由 MenuSurface 承担；本组件保留动作分发、艺术家子菜单与
 * 已同步歌单的删除范围弹窗。对外 props/emits 契约与旧版完全一致。
 */

interface RankUserBrief {
  username: string;
  nickname: string;
  avatar?: string;
}

const props = defineProps<{
  visible: boolean;
  song: SongEntity | null;
  x: number;
  y: number;
  isPlaylistView: boolean;
  isFolderView?: boolean;
  isManagementMode?: boolean;
  isOnlineSearch?: boolean;
  onlineDetailType?: 'artist' | 'album' | 'playlist' | 'user';
  resolvedFilePath?: string;
  leaderboardEntry?: RankUserBrief | null;
}>();

const emit = defineEmits(['close', 'add-to-playlist', 'delete-disk', 'view-online-artist', 'view-online-album', 'view-leaderboard-user']);

const activeRoute = useRoute();
const { showToast: flash } = useToast();
const {
  playSong: startTrack,
  playNext: queueUpNext,
  addSongToQueue: appendTrack,
  addAlbumToQueueTail: appendWholeAlbum,
  removeSongFromList: ejectTrack,
  openInFinder: revealFile,
  currentViewMode: libraryScope,
} = usePlayer();
const {
  removeFromPlaylist: pruneFromPlaylist,
  isFavorite: checkFavorite,
  toggleFavorite: flipFavorite,
} = useLibraryCollections();
const { filterCondition } = usePlayerViewState();
const { openSongInfo: showDossier } = useSongInfoDialog();
const { openHomeArtist, openHomeAlbum } = useHomeNavigation(useRouter());
const { openDownloadDialog } = useDownloadDialog();

// ==================== 菜单编排与外壳 ====================
const mainSheet = ref<InstanceType<typeof MenuSurface> | null>(null);
const subSheet = ref<InstanceType<typeof MenuSurface> | null>(null);
const triggerEl = ref<HTMLElement | null>(null);
const submenuOpen = ref(false);

// “从本地移除”只在文件夹管理态出现
const wipeVisible = computed(() => Boolean(props.isFolderView && props.isManagementMode));

const stagedRows = computed(() =>
  planSongMenu({
    rankMode: Boolean(props.leaderboardEntry),
    webSource: Boolean(props.isOnlineSearch),
    insidePlaylist: props.isPlaylistView,
    wipeUnlocked: wipeVisible.value,
    detailPage: props.onlineDetailType,
    favorited: props.song ? checkFavorite(props.song) : false,
    downloadable: Boolean(props.isOnlineSearch) && !!props.song && isDownloadableOnlineSong(props.song),
    wholeAlbumQueable: !props.isOnlineSearch && !props.isPlaylistView && !!props.song && hasSongAlbumMetadata(props.song),
  }).map((row, seq) => ({ ...row, seq })),
);

// ==================== 艺术家子菜单 ====================
const artistChoices = computed(() => (props.song ? resolveArtistSubmenuOptions(props.song) : []));
const multiArtist = computed(() => artistChoices.value.length > 1);

watch(artistChoices, (choices) => {
  if (choices.length <= 1) {
    submenuOpen.value = false;
  }
});

watch(
  () => props.visible,
  (on) => {
    if (!on) {
      submenuOpen.value = false;
    }
  },
  { immediate: true },
);

const foldArtists = () => {
  submenuOpen.value = false;
};

const spreadArtists = () => {
  if (!multiArtist.value) {
    foldArtists();
    return;
  }
  submenuOpen.value = true;
};

// 悬停换页：.artist 行展开子菜单，其余行收起
const onRoam = (id: SongMenuCommand) => {
  if (id === 'inspectArtist') {
    spreadArtists();
    return;
  }
  foldArtists();
};

// 记录 .artist 行的 DOM，供子菜单停靠定位
const grabTrigger = (node: Element | ComponentPublicInstance | null) => {
  const exposed = node as { body?: HTMLElement | null } | null;
  triggerEl.value = exposed && exposed.body instanceof HTMLElement ? exposed.body : null;
};

const jumpToArtist = (artistName: string) => {
  if (!isMeaningfulMetadataValue(artistName)) {
    flash('当前歌曲缺少歌手信息', 'info');
    return;
  }

  void openHomeArtist(artistName);
  emit('close');
};

// ==================== 从列表移除（含云端同步范围选择） ====================
const ScopePickerDialog = defineAsyncComponent(() => import('./SyncDeleteScopeModal.vue'));

const scopeDialogOpen = ref(false);
const pendingWipe = ref<{ playlistId: string; path: string; cloudId: string; payloadJson: string } | null>(null);

const removeFromCurrentList = () => {
  if (!props.song) {
    return;
  }

  // 歌单视图：已同步云端的歌单先弹窗确认删除范围
  if (props.isPlaylistView) {
    const collectionsStore = useCollectionsStore();
    const playlist = collectionsStore.getPlaylistById(filterCondition.value);
    const cloudId = playlist?.cloudId || '';
    if (playlist && cloudId) {
      pendingWipe.value = {
        playlistId: filterCondition.value,
        path: props.song.path,
        cloudId,
        payloadJson: JSON.stringify(songToSyncPayload(props.song)),
      };
      scopeDialogOpen.value = true;
      return;
    }
    pruneFromPlaylist(filterCondition.value, props.song.path);
    return;
  }

  // 收藏 / 最近播放 / 全部歌曲视图直接出列
  if (activeRoute.path === '/favorites' || activeRoute.path === '/recent' || libraryScope.value === 'all') {
    void ejectTrack(props.song);
    return;
  }

  flash('当前页面暂不支持从列表移除', 'info');
};

// 从歌单的歌曲数组中剔除指定曲目：仍有剩余则保留数组，否则整个字段清空
const stripPlaylistEntry = (playlist: { songs?: Array<{ path: string }> }, removedPath: string) => {
  const kept = playlist.songs;
  if (!kept?.length) {
    return;
  }
  const rest = kept.filter((entry) => entry.path !== removedPath);
  if (rest.length !== kept.length) {
    playlist.songs = rest.length > 0 ? rest : undefined;
  }
};

const settleRemoveScope = (scope: SyncDeleteScope) => {
  const staged = pendingWipe.value;
  scopeDialogOpen.value = false;
  pendingWipe.value = null;
  if (!staged) {
    return;
  }

  const collectionsStore = useCollectionsStore();
  const playlist = collectionsStore.getPlaylistById(staged.playlistId);
  if (!playlist) {
    return;
  }

  if (scope === 'local') {
    // 本地移除，云端保留
    addCloudKeepSongs(staged.cloudId, [{ path: staged.path, payloadJson: staged.payloadJson }]);
    pruneFromPlaylist(staged.playlistId, staged.path);
    stripPlaylistEntry(playlist, staged.path);
  } else if (scope === 'all') {
    // 本地与云端一并删除
    addPendingDeletedSongs(staged.cloudId, [staged.path]);
    pruneFromPlaylist(staged.playlistId, staged.path);
    stripPlaylistEntry(playlist, staged.path);
  } else {
    // 云端删除，本地保留
    addLocalOnlySongs(staged.cloudId, [staged.path]);
  }
};

// ==================== 动作分发 ====================
type Verdict = 'seal' | 'linger';

const COMMANDS: Record<SongMenuCommand, (track: SongEntity) => Verdict> = {
  startNow: (track) => {
    // 在线封面直接交给飞行动画，本地封面由动画自行解析
    const webCover = track.cover_thumb_path && /^https?:\/\//.test(track.cover_thumb_path)
      ? track.cover_thumb_path
      : '';
    void launchFlyingCover(track.path, webCover);
    void startTrack(track);
    return 'seal';
  },
  queueNext: (track) => {
    queueUpNext(track);
    return 'seal';
  },
  queueLast: (track) => {
    appendTrack(track);
    return 'seal';
  },
  fetchLocal: (track) => {
    void openDownloadDialog(track);
    return 'seal';
  },
  queueWholeAlbum: (track) => {
    appendWholeAlbum(track);
    return 'seal';
  },
  markFavorite: (track) => {
    flash(flipFavorite(track) ? '已收藏' : '已取消收藏', 'info');
    return 'seal';
  },
  pickPlaylist: () => {
    emit('add-to-playlist');
    return 'seal';
  },
  inspectArtist: (track) => {
    if (props.isOnlineSearch) {
      emit('view-online-artist', track);
      emit('close');
      return 'linger';
    }
    if (!hasSongArtistMetadata(track)) {
      flash('当前歌曲缺少歌手信息', 'info');
      return 'seal';
    }
    if (multiArtist.value) {
      spreadArtists();
      return 'linger';
    }
    jumpToArtist(resolvePrimaryArtistName(track));
    return 'linger';
  },
  inspectAlbum: (track) => {
    if (props.isOnlineSearch) {
      emit('view-online-album', track);
      emit('close');
      return 'linger';
    }
    if (!hasSongAlbumMetadata(track)) {
      flash('当前歌曲缺少专辑信息', 'info');
      return 'seal';
    }
    void openHomeAlbum(getSongAlbumKey(track));
    return 'seal';
  },
  revealOnDisk: (track) => {
    void revealFile(props.resolvedFilePath ?? track.path);
    return 'seal';
  },
  songDossier: (track) => {
    showDossier(props.resolvedFilePath ? { ...track, path: props.resolvedFilePath } : track);
    return 'seal';
  },
  ejectFromList: () => {
    removeFromCurrentList();
    return 'seal';
  },
  purgeOnDisk: (track) => {
    emit('delete-disk', track);
    return 'seal';
  },
  peekRankUser: () => 'seal',
};

const runCommand = (id: SongMenuCommand) => {
  if (id === 'peekRankUser') {
    emit('view-leaderboard-user');
    emit('close');
    return;
  }

  if (!props.song) {
    return;
  }

  if (COMMANDS[id](props.song) === 'seal') {
    emit('close');
  }
};

// 主菜单与子菜单之外的按下视为关闭请求
watchPointerAway(
  (hit) =>
    props.visible &&
    ![mainSheet.value?.shell, subSheet.value?.shell].some((el) => el?.contains(hit as Node)),
  () => emit('close'),
);
</script>

<template>
  <Teleport to="body">
    <MenuSurface
      ref="mainSheet"
      :shown="visible"
      :at-x="x"
      :at-y="y"
      pop-name="ctx-pop"
      :chrome-class="GLASS_SHEET"
    >
      <template v-for="row in stagedRows" :key="row.id">
        <div v-if="row.kind === 'break'" class="ctx-sep" :style="rowLag(row.seq)"></div>
        <CtxRow
          v-else
          :ref="row.id === 'inspectArtist' ? grabTrigger : undefined"
          :caption="row.caption"
          :alert="row.alert"
          :alert-drift="row.alert"
          :step="row.seq"
          lead-class="shrink-0 text-[#6b778c]"
          @roam="onRoam(row.id)"
          @pick="runCommand(row.id)"
        >
          <template #lead>
            <GlyphIcon :shape="songGlyphs[row.id]" />
          </template>
          <template v-if="row.id === 'inspectArtist' && multiArtist" #tail>
            <div class="ml-3 flex h-4 w-4 shrink-0 items-center justify-center text-[#8b97aa]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </div>
          </template>
        </CtxRow>
      </template>
    </MenuSurface>

    <!-- 多歌手子菜单：停靠在触发行旁 -->
    <MenuSurface
      ref="subSheet"
      :shown="visible && submenuOpen && multiArtist"
      :at-x="x"
      :at-y="y"
      :docked-to="triggerEl"
      pop-name="ctx-pop"
      :chrome-class="GLASS_SHEET_WIDE"
    >
      <CtxRow
        v-for="artistName in artistChoices"
        :key="artistName"
        :caption="artistName"
        @pick="jumpToArtist(artistName)"
      />
    </MenuSurface>

    <!-- 已同步歌单的删除范围选择 -->
    <ScopePickerDialog
      :visible="scopeDialogOpen"
      :title="'歌曲已同步到云端'"
      :description="'请选择删除范围'"
      can-delete-cloud
      @scope="settleRemoveScope"
      @cancel="scopeDialogOpen = false"
    />
  </Teleport>
</template>
