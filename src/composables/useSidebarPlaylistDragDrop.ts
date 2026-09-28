import { onMounted, onUnmounted, ref } from 'vue';
import type { Ref } from 'vue';

import type { Playlist } from '../types';

type DragKind = 'song' | 'playlist' | 'folder' | 'artist' | 'album';

interface PlaylistDragSession {
  active: boolean,
  type: DragKind,
  data: any,
}

interface PlaylistDragDropInputs {
  playlists: Ref<Playlist[]>,
  dragSession: PlaylistDragSession,
  reorderPlaylists: (fromIndex: number, toIndex: number) => void,
}

type PointerSeed = {
  x: number; y: number; index: number; playlist: Playlist;
};

/** 位移是否已越过拖拽触发阈值 */
const exceedsDragThreshold = (event: PointerEvent, seed: PointerSeed) => {
  const dx = event.clientX - seed.x;
  const dy = event.clientY - seed.y;
  return Math.sqrt(dx * dx + dy * dy) > 5;
};

export function useSidebarPlaylistDragDrop(inputs: PlaylistDragDropInputs) {
  const { playlists, dragSession, reorderPlaylists } = inputs;

  const dragOverId: Ref<string | null> = ref(null);
  const dragPosition: Ref<'top' | 'bottom' | null> = ref(null);
  let pointerSeed: PointerSeed | null = null;

  const beginPointerTracking = (event: PointerEvent, index: number, playlist: Playlist) => {
    const isNonPrimaryMousePress = event.pointerType === 'mouse' && event.button !== 0;
    if (isNonPrimaryMousePress) return;
    pointerSeed = { index, playlist, x: event.clientX, y: event.clientY };
  };

  const startPlaylistDrag = (event: PointerEvent) => {
    if (dragSession.active || !pointerSeed) {
      return;
    }

    if (event.pointerType !== 'mouse') { event.preventDefault(); }

    if (!exceedsDragThreshold(event, pointerSeed)) {
      return;
    }

    Object.assign(dragSession, {
      active: true,
      type: 'playlist',
      data: { index: pointerSeed.index, id: pointerSeed.playlist.id, name: pointerSeed.playlist.name },
    });
  };

  const releasePlaylistDrag = () => {
    pointerSeed = null;
    if (dragSession.type !== 'playlist') {
      return;
    }

    Object.assign(dragSession, { active: false, type: 'song', data: null });
    dragOverId.value = dragPosition.value = null;
  };

  /** 依据悬停位置换算重排下标；位置无变化时返回 null */
  const resolveReorderIndices = (): [number, number] | null => {
    const seed = pointerSeed;
    const hoverId = dragOverId.value;
    if (!seed || !hoverId) {
      return null;
    }

    const hoverIndex = playlists.value.findIndex(playlist => playlist.id === hoverId);
    if (hoverIndex === -1) {
      return null;
    }

    let targetIndex = hoverIndex;
    if (dragPosition.value === 'bottom') { targetIndex += 1; }
    if (seed.index < targetIndex) { targetIndex -= 1; }

    return seed.index === targetIndex ? null : [seed.index, targetIndex];
  };

  const finishPointerSession = (cancelled = false) => {
    const pendingReorder = !cancelled && dragSession.active && dragSession.type === 'playlist'
      ? resolveReorderIndices()
      : null;

    if (pendingReorder) {
      reorderPlaylists(pendingReorder[0], pendingReorder[1]);
    }

    releasePlaylistDrag();
  };

  const trackGlobalPointerMove = (event: PointerEvent) => startPlaylistDrag(event);
  const settleGlobalPointerUp = () => finishPointerSession(false);
  const abortGlobalPointerCancel = () => finishPointerSession(true);

  const trackPlaylistHover = (event: PointerEvent, playlistId: string) => {
    if (!(dragSession.type === 'playlist' && dragSession.active)) {
      return;
    }

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const verticalCenter = rect.top + rect.height / 2;

    dragOverId.value = playlistId;
    dragPosition.value = event.clientY < verticalCenter ? 'top' : 'bottom';
  };

  onMounted(() => {
    window.addEventListener('pointermove', trackGlobalPointerMove);
    window.addEventListener('pointerup', settleGlobalPointerUp);
    window.addEventListener('pointercancel', abortGlobalPointerCancel);
  });

  onUnmounted(() => {
    window.removeEventListener('pointermove', trackGlobalPointerMove);
    window.removeEventListener('pointerup', settleGlobalPointerUp);
    window.removeEventListener('pointercancel', abortGlobalPointerCancel);
  });

  return {
    dragOverId,
    dragPosition,
    handlePointerDown: beginPointerTracking,
    handleItemPointerMove: trackPlaylistHover,
  };
}
