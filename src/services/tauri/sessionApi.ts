/**
 * 播放会话 API — 与 Rust `src-tauri/src/player/session.rs` 一一对应
 *
 * 架构定位（务实组合，非纯单一事实源）：
 * - 运行时播放编排权威在前端（playerPlayback.ts / playbackCore）：
 *   音频解码、进度推进、切歌逻辑、UI 响应均由 JS 侧驱动。
 * - 持久化与多窗口共享权威在 Rust（session.rs）：
 *   会话状态写入 SQLite，副窗口通过 getPlaybackSession / 事件获取。
 * - 不要在 Rust 侧修改播放逻辑，Rust 仅负责存储和分发。
 *
 * 广播分频道：
 * - `playback:session-changed`：轻量载荷（不含 queueSongMeta），每次切歌/模式变更广播
 * - `playback:queue-meta-changed`：仅 queueSongMeta，仅在元数据变化时广播
 *
 * - 主窗口：切歌/队列变更时调用 `savePlaybackSession`，进度变化时调用 `updatePlaybackPosition`
 * - 副窗口：启动时调用 `getPlaybackSession` 获取当前状态（含完整 queueSongMeta），
 *   运行时监听 `playback:session-changed` + `playback:queue-meta-changed` 获取更新
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

/** `playback:session-changed` 事件载荷类型（轻量，不含 queueSongMeta） */
export type PlaybackSessionChangedPayload = PlaybackSessionData;

/** `playback:queue-meta-changed` 事件载荷类型（仅 queueSongMeta） */
export type PlaybackQueueMetaChangedPayload = Record<string, Song>;

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
