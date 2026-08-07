/**
 * 播放会话 API — 与 Rust `src-tauri/src/player/session.rs` 一一对应
 *
 * Rust 作为播放会话的单一事实源（single source of truth），前端通过此服务
 * 读写会话状态，替代原先的 Pinia + localStorage 方案。
 *
 * - 主窗口：切歌/队列变更时调用 `savePlaybackSession`，进度变化时调用 `updatePlaybackPosition`
 * - 副窗口：启动时调用 `getPlaybackSession` 获取当前状态，监听 `playback:session-changed` 事件获取更新
 * - 应用退出/定时：调用 `flushPlaybackSession` 强制持久化
 */

import { tauriInvoke } from './invoke';
import type { Song, QualityKey } from '../../types';

/** 播放会话数据（与 Rust `PlaybackSessionData` 一一对应，camelCase） */
export interface PlaybackSessionData {
  currentSongPath: string | null;
  playQueuePaths: string[];
  sourceSongPaths: string[];
  playMode: number;
  volume: number;
  currentPositionSecs: number;
  isPlaying: boolean;
  sessionQualityOverride: string | null;
  /** 队列中在线歌曲的元数据（path → Song 对象） */
  queueSongMeta: Record<string, Song>;
  updatedAt: number;
}

/** `playback:session-changed` 事件载荷类型 */
export type PlaybackSessionChangedPayload = PlaybackSessionData;

/** 构建 PlaybackSessionData（从 Pinia store 状态提取） */
export function buildSessionData(params: {
  currentSongPath: string | null;
  playQueuePaths: string[];
  sourceSongPaths: string[];
  playMode: number;
  volume: number;
  currentPositionSecs: number;
  isPlaying: boolean;
  sessionQualityOverride: QualityKey | null;
  queueSongMeta: Record<string, Song>;
}): PlaybackSessionData {
  return {
    currentSongPath: params.currentSongPath,
    playQueuePaths: params.playQueuePaths,
    sourceSongPaths: params.sourceSongPaths,
    playMode: params.playMode,
    volume: params.volume,
    currentPositionSecs: params.currentPositionSecs,
    isPlaying: params.isPlaying,
    sessionQualityOverride: params.sessionQualityOverride,
    queueSongMeta: params.queueSongMeta,
    updatedAt: Date.now(),
  };
}

export const sessionApi = {
  /** 保存完整播放会话状态（切歌/队列变更时调用） */
  savePlaybackSession: (session: PlaybackSessionData): Promise<void> =>
    tauriInvoke('save_playback_session', { session }),

  /** 从 SQLite 加载播放会话状态（主窗口启动恢复时调用） */
  loadPlaybackSession: (): Promise<PlaybackSessionData> =>
    tauriInvoke('load_playback_session'),

  /** 获取当前播放会话状态（副窗口启动时调用，从内存读取） */
  getPlaybackSession: (): Promise<PlaybackSessionData> =>
    tauriInvoke('get_playback_session'),

  /** 高频更新播放进度（仅内存 + 防抖写 SQLite） */
  updatePlaybackPosition: (positionSecs: number, isPlaying: boolean): Promise<void> =>
    tauriInvoke('update_playback_position', { positionSecs, isPlaying }),

  /** 强制持久化到 SQLite（定时/退出时调用） */
  flushPlaybackSession: (): Promise<void> =>
    tauriInvoke('flush_playback_session'),
};
