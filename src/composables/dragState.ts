import { reactive, ref } from 'vue';
import type { Song } from '../types';

export type DragSessionType = 'song' | 'playlist' | 'folder' | 'artist' | 'album';

export interface DragSessionState {
  active: boolean;
  showGhost: boolean;
  type: DragSessionType;
  songs: Song[];
  data: any;
  mouseX: number;
  mouseY: number;
  targetFolder: { name: string; path: string } | null;
  targetPlaylist: { id: string; name: string } | null;
  insertIndex: number;
  sortLineTop: number;
}

export const dragSession = reactive<DragSessionState>({
  active: false,
  showGhost: false,
  type: 'song',
  songs: [],
  data: null,
  mouseX: 0,
  mouseY: 0,
  targetFolder: null,
  targetPlaylist: null,
  insertIndex: -1,
  sortLineTop: -1,
});

/**
 * 当弹窗（如添加歌单弹窗）需要拦截全局拖放事件时设为 true，
 * useExternalPathBridge 会跳过处理，避免冲突。
 */
export const modalDragInterceptActive = ref(false);
