import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { Song } from '../types';
import { useCollectionsActions } from '../features/collections/useCollectionsActions';
import { useFileImport } from './useFileImport';
import { useLibrarySync } from '../features/library/useLibrarySync';
import { usePlaybackActions } from '../features/playback/usePlaybackActions';
import { useWindowActions } from './useWindowActions';

// —— 测试夹具 ——

// 示例歌曲：字段取值属于行为规格，保持原样
const demoSong = {
  path: '/music/demo.flac', name: 'demo.flac',
  title: 'Demo', artist: 'Artist',
  artist_names: ['Artist'], effective_artist_names: ['Artist'],
  album: 'Album', album_artist: 'Artist', album_key: 'Album::Artist',
  is_various_artists_album: false, collapse_artist_credits: false,
  duration: 120,
} satisfies Song;

// 每次调用生成全新的空 spy，避免用例之间互相污染
const freshMock = () => vi.fn();

describe('playerActions：动作转发到运行时服务', () => {
  it('播放与窗口动作被转发到对应实现', async () => {
    const playSong = freshMock();
    const nextSong = freshMock();
    const toggleAlwaysOnTop = freshMock();
    const toggleQueue = freshMock();

    const playback = usePlaybackActions({
      currentSong: ref(demoSong), playMode: ref(1),
      getPlayerPlayback() {
        return {
          playSong, pauseSong: freshMock(), togglePlay: freshMock(),
          seekTo: freshMock(), playAt: freshMock(), handleSeek: freshMock(), stepSeek: freshMock(),
        };
      },
      getPlayerQueue() {
        return {
          toggleMode: freshMock(), playNext: freshMock(), nextSong,
          prevSong: freshMock(), clearQueue: freshMock(), removeSongFromQueue: freshMock(),
          addSongToQueue: freshMock(), addSongsToQueue: freshMock(),
        };
      },
      playerUiShell: {
        handleVolume: freshMock(), handleVolumeWheel: freshMock(), toggleMute: freshMock(),
        togglePlaylist: freshMock(), toggleMiniPlaylist: freshMock(), closeMiniPlaylist: freshMock(),
        handleScan: freshMock(), removeSongFromList: freshMock(),
      },
    });
    const windowApi = useWindowActions({
      playerUiShell: { toggleAlwaysOnTop, togglePlayerDetail: freshMock(), toggleQueue },
    });

    playback.handleAutoNext();
    windowApi.toggleAlwaysOnTop(true);
    windowApi.toggleQueue();

    expect(playSong).toHaveBeenCalledWith(demoSong, { forceReplay: true });
    expect(nextSong).not.toHaveBeenCalled();
    expect(toggleAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(toggleQueue).toHaveBeenCalledTimes(1);
  });

  it('收藏、媒体库与导入动作被转发到对应实现', () => {
    const createPlaylist = freshMock();
    const scanLibrary = freshMock();
    const addFoldersFromStructure = freshMock();

    const collections = useCollectionsActions({
      playerPlaylist: {
        createPlaylist, deletePlaylist: freshMock(), addToPlaylist: freshMock(),
        removeFromPlaylist: freshMock(), addSongsToPlaylist: freshMock(), viewPlaylist: freshMock(),
        getSongsFromPlaylist: vi.fn(() => []), openAddToPlaylistDialog: freshMock(),
      },
    });
    const library = useLibrarySync({
      fetchLibraryFolders: freshMock(), addLibraryFolder: freshMock(), addLibraryFolderLinked: freshMock(),
      removeLibraryFolder: freshMock(), removeLibraryFolderLinked: freshMock(), handleExternalPaths: freshMock(),
      scanLibrary, addLibraryFolderPath: freshMock(),
      refreshFolder: freshMock(), refreshAllFolders: freshMock(),
    });
    const importer = useFileImport({
      addFolder: freshMock(), addFoldersFromStructure,
      getSongsInFolder: vi.fn(() => [demoSong]), clearLocalMusic: freshMock(),
    });

    collections.createPlaylist('Daily Mix', [demoSong.path]);
    library.scanLibrary();
    importer.addFoldersFromStructure();

    expect(createPlaylist).toHaveBeenCalledWith('Daily Mix', [demoSong.path]);
    expect(scanLibrary).toHaveBeenCalledTimes(1);
    expect(addFoldersFromStructure).toHaveBeenCalledTimes(1);
  });
});
