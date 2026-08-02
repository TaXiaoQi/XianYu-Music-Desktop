import { ref } from 'vue';
import type { Song } from '../types';

export type SongInfoDialogAction = 'default' | 'cover' | 'lyrics';

const isSongInfoVisible = ref(false);
const currentSongInfo = ref<Song | null>(null);
const songInfoInitialAction = ref<SongInfoDialogAction>('default');

export function useSongInfoDialog() {
  const openSongInfo = (song: Song, initialAction: SongInfoDialogAction = 'default') => {
    currentSongInfo.value = song;
    songInfoInitialAction.value = initialAction;
    isSongInfoVisible.value = true;
  };

  const closeSongInfo = () => {
    isSongInfoVisible.value = false;
    // 延迟清理对象以保持关闭动画过渡的平滑性
    setTimeout(() => {
      currentSongInfo.value = null;
      songInfoInitialAction.value = 'default';
    }, 300);
  };

  return {
    isSongInfoVisible,
    currentSongInfo,
    songInfoInitialAction,
    openSongInfo,
    closeSongInfo,
  };
}
