import { ref } from 'vue';
import type { Song } from '../types';

const isSongInfoVisible = ref(false);
const currentSongInfo = ref<Song | null>(null);

export function useSongInfoDialog() {
  const openSongInfo = (song: Song) => {
    currentSongInfo.value = song;
    isSongInfoVisible.value = true;
  };

  const closeSongInfo = () => {
    isSongInfoVisible.value = false;
    // 延迟清理对象以保持关闭动画过渡的平滑性
    setTimeout(() => {
      currentSongInfo.value = null;
    }, 300);
  };

  return {
    isSongInfoVisible,
    currentSongInfo,
    openSongInfo,
    closeSongInfo,
  };
}
