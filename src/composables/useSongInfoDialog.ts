import { type Ref, ref } from 'vue';
import type { Song as TrackRecord } from '../types';

/**
 * 曲目详情弹窗的全局单例状态。
 * 关闭后需要等淡出动画播完再释放曲目数据，否则收起过程中封面会突然消失。
 */
export type SongInfoDialogAction = 'default' | 'cover' | 'lyrics';

/** 弹窗淡出动画时长（毫秒），曲目引用在该延时之后才允许清空 */
const PANEL_EXIT_ANIMATION_MS = 300;

const panelTrack = ref<TrackRecord | null>(null);
const panelShown = ref(false);
const panelEntryTab = ref<SongInfoDialogAction>('default');

function presentTrackPanel(track: TrackRecord, entryTab: SongInfoDialogAction = 'default') {
  panelTrack.value = track;
  panelEntryTab.value = entryTab;
  panelShown.value = true;
}

function dismissTrackPanel() {
  panelShown.value = false;
  window.setTimeout(() => {
    panelTrack.value = null;
    panelEntryTab.value = 'default';
  }, PANEL_EXIT_ANIMATION_MS);
}

/** 详情弹窗暴露给视图层的状态与开合动作 */
export interface SongInfoDialogApi {
  isSongInfoVisible: Ref<boolean>;
  currentSongInfo: Ref<TrackRecord | null>;
  songInfoInitialAction: Ref<SongInfoDialogAction>;
  openSongInfo: (song: TrackRecord, initialAction?: SongInfoDialogAction) => void;
  closeSongInfo: () => void;
}

export function useSongInfoDialog(): SongInfoDialogApi {
  return {
    isSongInfoVisible: panelShown,
    currentSongInfo: panelTrack,
    songInfoInitialAction: panelEntryTab,
    openSongInfo: presentTrackPanel,
    closeSongInfo: dismissTrackPanel,
  };
}
