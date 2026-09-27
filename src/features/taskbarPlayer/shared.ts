// 任务栏迷你播放器跨窗口共享契约：事件名、存储键、窗口尺寸常量与载荷类型。
// 主窗口与任务栏窗口两侧均引用本文件，导出名保持稳定。
import type { Song } from '../../types';

// —— 跨窗口事件与存储常量（字符串值被双方逐字匹配，不可改动） ——

export const
  /** 任务栏播放器窗口的唯一 label */
  TASKBAR_PLAYER_WINDOW_LABEL = 'taskbar-player',
  /** 主窗口 → 任务栏窗口：全量状态推送 */
  TASKBAR_PLAYER_STATE_EVENT = 'taskbar-player:state',
  /** 任务栏窗口 → 主窗口：状态已渲染完成 */
  TASKBAR_PLAYER_STATE_APPLIED_EVENT = 'taskbar-player:state-applied',
  /** 任务栏窗口 → 主窗口：用户触发的控制指令 */
  TASKBAR_PLAYER_ACTION_EVENT = 'taskbar-player:action',
  /** 任务栏窗口 → 主窗口：请求一份全量状态 */
  TASKBAR_PLAYER_REQUEST_STATE_EVENT = 'taskbar-player:request-state',
  /** 任务栏窗口 → 主窗口：就绪通知 */
  TASKBAR_PLAYER_READY_EVENT = 'taskbar-player:ready',
  /** 主窗口 → 任务栏窗口：可见性切换 */
  TASKBAR_PLAYER_VISIBILITY_EVENT = 'taskbar-player:visibility',
  /** 窗口拖拽位置广播 */
  TASKBAR_PLAYER_DRAG_EVENT = 'taskbar-player:drag',
  /** 记忆窗口横向位置的存储键 */
  TASKBAR_PLAYER_POSITION_X_KEY = 'taskbar_player_window_position_x';

/** 任务栏窗口固定尺寸（逻辑像素） */
export const
  TASKBAR_PLAYER_WINDOW_WIDTH = 320,
  TASKBAR_PLAYER_WINDOW_HEIGHT = 40;

/** 主窗口推送给任务栏窗口的播放状态 */
export interface TaskbarPlayerStatePayload {
  currentSong: Song | null; coverUrl: string;
  isPlaying: boolean; isDarkTheme: boolean;
}

/** 任务栏窗口用户可触发的全部动作 */
export type TaskbarPlayerAction =
  | { type: 'toggle-play' | 'prev-song' | 'next-song' | 'close' };
