import { ref, reactive } from 'vue';
import { type Song } from '../types';

// 一次拖拽可以指向的实体类别（歌曲 / 歌单 / 文件夹 / 歌手 / 专辑）
export type DragSessionType = 'album' | 'artist' | 'folder' | 'playlist' | 'song';

// 悬停落点载体：文件夹按路径标识，歌单按 id 标识
type DragHoverFolder = { name: string; path: string };
type DragHoverPlaylist = { id: string; name: string };

// 一场进行中的拖拽会话：指针坐标、幽灵层显隐、候选歌曲、落点与插入线位置
export type DragSessionState = {
  active: boolean; showGhost: boolean; type: DragSessionType; songs: Song[]; data: any;
  mouseX: number; mouseY: number; insertIndex: number; sortLineTop: number;
  targetFolder: DragHoverFolder | null; targetPlaylist: DragHoverPlaylist | null;
};

export const dragSession = reactive<DragSessionState>({ active: false, showGhost: false, type: 'song',
  songs: [], data: null, mouseX: 0, mouseY: 0, targetFolder: null, targetPlaylist: null,
  insertIndex: -1, sortLineTop: -1,
});

// 弹窗覆盖期间拦截外部路径拖放的全局开关
export const modalDragInterceptActive = ref<boolean>(false);
