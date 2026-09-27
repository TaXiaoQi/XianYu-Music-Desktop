import { ref, type Ref } from 'vue';

import type { Playlist } from '../types';

interface UseSidebarPlaylistSelectionOptions {
  playlists: Ref<Playlist[]>;
  currentViewMode: Ref<string>;
  filterCondition: Ref<string>;
  openHomePlaylist: (playlistId: string) => Promise<unknown> | unknown;
}

export function useSidebarPlaylistSelection(options: UseSidebarPlaylistSelectionOptions) {
  const { playlists, currentViewMode, filterCondition, openHomePlaylist } = options;

  // 已选中的歌单 id 集合；lastSelectedPlaylistId 是 Shift 连选的锚点
  const selectedPlaylistIds = ref(new Set<string>());
  const lastSelectedPlaylistId = ref(null) as Ref<string | null>;

  /** 清空已选并只保留指定歌单，同时把它记为新的锚点 */
  const selectSinglePlaylist = (id: string): void => {
    const selection = selectedPlaylistIds.value;
    selection.clear();
    selection.add(id);
    lastSelectedPlaylistId.value = id;
  };

  const ensurePlaylistSelected = (id: string): void => {
    const alreadySelected = selectedPlaylistIds.value.has(id);
    if (alreadySelected) {
      return;
    }
    selectSinglePlaylist(id);
  };

  /** Shift 连选：以锚点为起点把区间内的歌单全部加入选中；返回是否已按连选处理 */
  const applyRangeSelection = (event: MouseEvent, id: string): boolean => {
    if (!event.shiftKey || !lastSelectedPlaylistId.value) {
      return false;
    }

    const items = playlists.value;
    const anchorIndex = items.findIndex((playlist) => playlist.id === lastSelectedPlaylistId.value);
    const targetIndex = items.findIndex((playlist) => playlist.id === id);
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [from, to] =
        anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      for (let cursor = from; cursor <= to; cursor += 1) {
        selectedPlaylistIds.value.add(items[cursor].id);
      }
    }
    return true;
  };

  /** Ctrl/Cmd 点选：翻转目标歌单的选中态并更新锚点；返回是否已按多选处理 */
  const applyModifierToggle = (event: MouseEvent, id: string): boolean => {
    if (!event.ctrlKey && !event.metaKey) {
      return false;
    }

    const selection = selectedPlaylistIds.value;
    if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
    lastSelectedPlaylistId.value = id;
    return true;
  };

  const handlePlaylistClick = (event: MouseEvent, id: string): void => {
    event?.stopPropagation();
    void openHomePlaylist(id);

    if (!event) {
      return;
    }
    if (applyRangeSelection(event, id) || applyModifierToggle(event, id)) {
      return;
    }
    selectSinglePlaylist(id);
  };

  const handleBackgroundClick = (event?: MouseEvent): void => {
    event?.stopPropagation();
    const activePlaylistId =
      currentViewMode.value === 'playlist' ? filterCondition.value : '';
    if (activePlaylistId) {
      selectSinglePlaylist(activePlaylistId);
    }
  };

  return { selectedPlaylistIds, lastSelectedPlaylistId, ensurePlaylistSelected, handlePlaylistClick, handleBackgroundClick };
}
