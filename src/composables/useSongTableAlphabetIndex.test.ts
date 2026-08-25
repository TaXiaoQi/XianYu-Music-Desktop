import { ref, type Ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FolderNode, Song } from '../types';
import { usePlaybackStore } from '../features/playback/store';
import { useSongTableAlphabetIndex } from './useSongTableAlphabetIndex';

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

const makeSong = (path: string): Song => ({
  path,
  name: path.split('/').pop() || 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
});

const mountAlphabetIndex = (currentViewMode: Ref<string>, routePath: Ref<string> = ref('/')) => {
  const songs = ref([makeSong('/music/demo.flac'), makeSong('/music/next.flac')]);
  const result = useSongTableAlphabetIndex({
    songs,
    scrollTop: ref(144),
    containerHeight: ref(600),
    containerRef: ref(null),
    rootRef: ref(null),
    routePath,
    currentViewMode,
    localSortMode: ref('title'),
    folderSortMode: ref('title'),
    activeRootPath: ref(null),
    currentFolderFilter: ref(''),
    folderTree: ref<FolderNode[]>([]),
    refreshFolder: async () => undefined,
    expandFolderPath: async () => undefined,
  });

  return {
    result,
    unmount: () => undefined,
  };
};

describe('useSongTableAlphabetIndex', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it.each(['playlist', 'artist', 'album'])(
    'shows scroll-to-top button in %s detail view after scrolling past the first row',
    (viewMode) => {
      const { result, unmount } = mountAlphabetIndex(ref(viewMode));

      expect(result.showScrollToTopButton.value).toBe(true);

      unmount();
    },
  );

  it.each(['playlist', 'artist', 'album'])(
    'keeps locate-current-song available in %s detail view when the current song is in the list',
    (viewMode) => {
      usePlaybackStore().currentSong = makeSong('/music/demo.flac');

      const { result, unmount } = mountAlphabetIndex(ref(viewMode));

      expect(result.canLocateCurrentSong.value).toBe(true);

      unmount();
    },
  );

  // 收藏/最近播放页复用 SongTable，但滚动控件此前被 `routePath === '/'` 挡住，
  // 需放宽到这两个页面也能显示
  it.each([
    ['favorites', '/favorites'],
    ['recent', '/recent'],
  ] as const)(
    'shows scroll-to-top button in %s page after scrolling past the first row',
    (viewMode, routePath) => {
      const { result, unmount } = mountAlphabetIndex(ref(viewMode), ref(routePath));

      expect(result.showScrollToTopButton.value).toBe(true);

      unmount();
    },
  );

  it.each([
    ['favorites', '/favorites'],
    ['recent', '/recent'],
  ] as const)(
    'keeps locate-current-song available in %s page when the current song is in the list',
    (viewMode, routePath) => {
      usePlaybackStore().currentSong = makeSong('/music/demo.flac');

      const { result, unmount } = mountAlphabetIndex(ref(viewMode), ref(routePath));

      expect(result.showLocateCurrentSongButton.value).toBe(true);
      expect(result.canLocateCurrentSong.value).toBe(true);

      unmount();
    },
  );

  // 每日推荐是首页 TAB（route '/'），复用 SongTable；此前 currentViewMode='dailyRecommend'
  // 不在回到顶部白名单，滚动后只有定位播放可显示、回到顶部被拦住，需一并纳入
  it('shows scroll-to-top button in the daily recommend list (home route) after scrolling past the first row', () => {
    const { result, unmount } = mountAlphabetIndex(ref('dailyRecommend'), ref('/'));

    expect(result.showScrollToTopButton.value).toBe(true);

    unmount();
  });

  // 在线搜索/详情页复用 SongTable，滚动控件需同样可用。
  // 这些页面 currentViewMode 保留进入前的页面状态（默认 statistics），不应成为显示障碍
  it.each([
    ['search', '/search'],
    ['online-detail', '/online-detail'],
  ] as const)(
    'shows scroll-to-top button in %s page after scrolling past the first row',
    (viewMode, routePath) => {
      const { result, unmount } = mountAlphabetIndex(ref('statistics'), ref(routePath));

      expect(result.showScrollToTopButton.value).toBe(true);

      unmount();
    },
  );

  it.each([
    ['search', '/search'],
    ['online-detail', '/online-detail'],
  ] as const)(
    'keeps locate-current-song available in %s page when the current song is in the list',
    (viewMode, routePath) => {
      usePlaybackStore().currentSong = makeSong('/music/demo.flac');

      const { result, unmount } = mountAlphabetIndex(ref('statistics'), ref(routePath));

      expect(result.showLocateCurrentSongButton.value).toBe(true);
      expect(result.canLocateCurrentSong.value).toBe(true);

      unmount();
    },
  );
});
