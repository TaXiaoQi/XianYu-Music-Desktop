<script setup lang="ts"> // 实现
// 底栏歌曲右键菜单：本地歌曲走本地导航/歌曲信息，在线歌曲走插件检索打开详情页。
// 面板外观与入场动画走 Footer 专属主题（无弹出过渡包裹，关闭即卸载）。
import { computed, ref, type Component } from 'vue';
import { useRouter } from 'vue-router'; // 实现
import { Disc3, FileText, Folder, Heart, Image, Info, Plus, UserRound, Video } from 'lucide-vue-next';

import { usePlayer } from '../../features/playback';
import { useHomeNavigation } from '../../composables/useHomeNavigation'; // 实现
import { useSongInfoDialog } from '../../composables/useSongInfoDialog'; // 实现
import { useToast } from '../../composables/toast'; // 实现
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog'; // 实现
import { useLibraryCollections } from '../../features/collections/useLibraryCollections'; // 实现
import { getSongAlbumKey, hasSongAlbumMetadata, resolvePrimaryArtistName } from '../../features/library/playerLibraryViewShared';
import { openOnlineDetail } from '../../features/onlineDetail/store';
import { getStoredPlugins, pluginArtistSearch, pluginAlbumSearch } from '../../services/domain/pluginEngine';
import { supportsMusicVideo } from '../../composables/useBilibiliVideoBackground';
import type { Song } from '../../types'; // 实现

import MenuSurface from './contextMenu/MenuSurface.vue';
import { FOOTER_SHEET } from './contextMenu/sheetChrome';
import { watchPointerAway } from './contextMenu/onPointerAway';

const props = defineProps<{ // 实现
  visible: boolean;
  x: number;
  y: number;
  song: Song | null;
  videoBackgroundRequested?: boolean;
  videoBackgroundLoading?: boolean;
}>();

const emit = defineEmits<{
  (ev: 'close'): void;
  (ev: 'change-lyrics'): void;
  (ev: 'toggle-video-background'): void;
}>();

const { openInFinder: revealFile } = usePlayer();
const { openAddToPlaylistDialog: requestPlaylistPicker } = useAddToPlaylistDialog();
const { openSongInfo: showDossier } = useSongInfoDialog();
const { showToast: flash } = useToast();
const { isFavorite: checkFav, toggleFavorite: flipFav } = useLibraryCollections();
const { openHomeArtist, openHomeAlbum } = useHomeNavigation(useRouter());

const sheet = ref<InstanceType<typeof MenuSurface> | null>(null);

// 可见面且按下点在面板外时关闭
watchPointerAway(
  (hit) => {
    const el = sheet.value?.shell;
    return !!props.visible && !!el && !el.contains(hit as Node);
  },
  () => emit('close'),
);

// 插件音源路径前缀
const REMOTE_SCHEMES = ['plugin://', 'lx://'];
const streamed = computed(() => REMOTE_SCHEMES.some((scheme) => (props.song?.path ?? '').startsWith(scheme)));
const videoCapable = computed(() => supportsMusicVideo(props.song));

type FooterCommand =
  | 'markFavorite'
  | 'pickPlaylist'
  | 'inspectArtist'
  | 'inspectAlbum'
  | 'songDossier'
  | 'swapCover'
  | 'swapLyrics'
  | 'flipVideoBg'
  | 'revealOnDisk';

interface FooterCommandRow {
  kind: 'command';
  id: FooterCommand;
  caption: string;
  glyph: Component;
}

interface FooterBreakRow {
  kind: 'break';
  id: string;
}

type FooterRow = FooterCommandRow | FooterBreakRow;

const cmd = (id: FooterCommand, caption: string, glyph: Component): FooterCommandRow =>
  ({ kind: 'command', id, caption, glyph });
const brk = (id: string): FooterBreakRow => ({ kind: 'break', id });

const rows = computed<FooterRow[]>(() => {
  const favOn = props.song ? checkFav(props.song) : false;
  const found: FooterRow[] = [
    cmd('markFavorite', favOn ? '取消收藏' : '收藏歌曲', Heart),
    cmd('pickPlaylist', '收藏到歌单', Plus),
    brk('cut-nav'),
    cmd('inspectArtist', '查看歌手', UserRound),
    cmd('inspectAlbum', '查看专辑', Disc3),
  ];

  // 在线歌曲没有本地文件维度
  if (!streamed.value) {
    found.push(cmd('songDossier', '查看歌曲信息', Info), cmd('swapCover', '修改歌曲封面', Image));
  }

  found.push(cmd('swapLyrics', '更改歌词 (LRC)', FileText));

  if (videoCapable.value) {
    found.push(cmd('flipVideoBg', props.videoBackgroundRequested ? '关闭背景视频' : '播放视频为背景', Video));
  }

  if (!streamed.value) {
    found.push(brk('cut-file'), cmd('revealOnDisk', '打开文件所在目录', Folder));
  }

  return found;
});

const locatePluginSource = (track: Song) => {
  const sourceId = track.plugin_id || track.rawData?.pluginId;
  if (!sourceId) {
    return null;
  }
  return getStoredPlugins().find((entry) => entry.id === sourceId) ?? null;
};

type DetailFlavor = 'artist' | 'album';

// 在线歌手/专辑共用一条检索通路，提示文案按 flavor 区分
const openWebDetail = async (flavor: DetailFlavor, track: Song) => {
  const forArtist = flavor === 'artist';
  const term = forArtist
    ? track.effective_artist_names?.[0] || track.artist_names?.[0] || track.artist || ''
    : track.album || '';

  if (!term || term === (forArtist ? '未知歌手' : '未知专辑')) {
    flash(forArtist ? '当前歌曲缺少歌手信息' : '当前歌曲缺少专辑信息', 'info');
    return;
  }

  if (track.path.startsWith('lx://')) {
    flash(forArtist ? '当前音源暂不支持查看歌手' : '当前音源暂不支持查看专辑', 'info');
    return;
  }

  const source = locatePluginSource(track);
  if (!source) {
    flash(forArtist ? '当前音源不支持查看歌手' : '当前音源不支持查看专辑', 'info');
    return;
  }

  try {
    if (forArtist) {
      const hits = await pluginArtistSearch(source, term, 1);
      if (hits.length === 0) {
        flash('未找到该歌手', 'info');
        return;
      }
      const hit = hits[0];
      openOnlineDetail({
        type: 'artist',
        title: hit.name,
        subtitle: hit.description || (hit.songCount ? `${hit.songCount} 首歌曲` : ''),
        description: hit.description || '',
        coverUrl: hit.avatarUrl,
        pluginSource: source,
        rawData: hit.rawData,
        platformId: hit.platformId || hit.id,
      });
      return;
    }

    const albums = await pluginAlbumSearch(source, term, 1);
    if (albums.length === 0) {
      flash('未找到该专辑', 'info');
      return;
    }
    const album = albums[0];
    openOnlineDetail({
      type: 'album',
      title: album.name,
      subtitle: album.artist,
      coverUrl: album.coverUrl,
      pluginSource: source,
      rawData: album.rawData,
      platformId: album.platformId || album.id,
    });
  } catch (err: any) {
    flash(`${forArtist ? '查看歌手失败' : '查看专辑失败'}: ${err?.message || err}`, 'error');
  }
};

const ACT: Record<FooterCommand, (track: Song) => void> = {
  markFavorite: (track) => flash(flipFav(track) ? '已收藏' : '已取消收藏', 'info'),
  pickPlaylist: (track) => requestPlaylistPicker(track.path, { songs: [track] }),
  inspectArtist: (track) => {
    if (streamed.value) {
      void openWebDetail('artist', track);
      return;
    }
    const name = resolvePrimaryArtistName(track);
    if (!name) {
      flash('当前歌曲缺少歌手信息', 'info');
      return;
    }
    void openHomeArtist(name);
  },
  inspectAlbum: (track) => {
    if (streamed.value) {
      void openWebDetail('album', track);
      return;
    }
    if (!hasSongAlbumMetadata(track)) {
      flash('当前歌曲缺少专辑信息', 'info');
      return;
    }
    void openHomeAlbum(getSongAlbumKey(track));
  },
  revealOnDisk: (track) => void revealFile(track.path),
  songDossier: (track) => showDossier(track),
  swapCover: (track) => showDossier(track, 'cover'),
  swapLyrics: () => emit('change-lyrics'),
  flipVideoBg: () => emit('toggle-video-background'),
};

const act = (id: FooterCommand) => {
  if (!props.song) {
    return;
  }
  ACT[id](props.song);
  emit('close'); // 实现
};
</script>

<template>
  <Teleport to="body"> 
    <MenuSurface
      :shown="visible"
      :at-x="x"
      :at-y="y"
      :chrome-class="FOOTER_SHEET"
      keep-metrics
    >
      <template v-for="row in rows" :key="row.id">
        <div v-if="row.kind === 'break'" class="my-1 h-px bg-gray-200/70 dark:bg-white/10"></div>
        <div
          v-else
          class="mx-1 px-3.5 py-2 rounded-lg cursor-pointer flex items-center group transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          @click="act(row.id)"
        >
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-white">
            <component :is="row.glyph" class="w-4 h-4" :stroke-width="1.8" />
          </div>
          <span class="min-w-0 flex-1 truncate">{{ row.caption }}</span>
        </div>
      </template>
    </MenuSurface>
  </Teleport>
</template>
