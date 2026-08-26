import type {PreviewClipInfo} from './onlineFailover';
import {isOnlineStreamPath} from './onlineFailover';

/**
 * 播放计时与停滞判定域。
 *
 * 抽离自 playerPlayback 的纯逻辑：进度事件载荷类型、低功耗刷新间隔、试听流/完整流的
 * 结束位置计算，以及「后端进度停滞视为播放结束」的判定。全部为纯函数，便于独立单测。
 */

/** Rust 后端发射的播放进度事件载荷 */
export interface PlaybackProgressPayload {
  /** 当前播放位置（秒） */
  position: number;
  /** 音频总时长（秒），0 表示未知 */
  duration: number;
  /** 是否正在播放 */
  is_playing: boolean;
}

/** 主窗口低功耗模式下的进度刷新间隔（毫秒） */
export const LOW_POWER_PROGRESS_UPDATE_MS = 1000;

export interface StallAutoNextInput {
  /** 当前歌曲 */
  song: { path: string; duration: number };
  /** 后端推送的最新原始进度 */
  rawTime: number;
  /** 上一次原始进度 */
  lastRawProgress: number;
  /** 当前累计停滞轮次（该函数返回新值） */
  stalledProgressTicks: number;
  /** 试听映射；试听流的结束位置以片段时长为准 */
  activePreviewClip: PreviewClipInfo | null;
}

export interface StallAutoNextResult {
  /** 更新后的停滞轮次 */
  stalledProgressTicks: number;
  /** 是否判定为播放结束，应触发下一首 */
  shouldAutoAdvance: boolean;
}

/**
 * 播放结束兜底检测：后端进度连续多轮停滞且已播放过则视为结束。
 * - duration 未知：直接视为结束
 * - duration 已知：仅当进度已接近 duration（相差 ≤3s）时视为结束，避免中段缓冲误判
 *；同时也弥补 metadata 时长略大于实际音频时长导致 currentTime 被 reanchor 拉回、
 *   永远到不了 duration 的问题。
 * - 在线歌（流式下载）拖动进度条或中途缓冲时后端进度可能停滞数秒才恢复，
 *   故在线歌放宽停滞阈值，避免缓冲被误判为播放结束而自动切下一首。
 */
export function evaluateStallAutoNext(input: StallAutoNextInput): StallAutoNextResult {
  const { song, rawTime, lastRawProgress, stalledProgressTicks, activePreviewClip } = input;

  if (rawTime <= 0 || Math.abs(rawTime - lastRawProgress) >= 0.05) {
    return { stalledProgressTicks: 0, shouldAutoAdvance: false };
  }

  const ticks = stalledProgressTicks + 1;
  const unknownDuration = !song.duration || song.duration <= 0;
  // 试听流的结束位置以片段时长为准（rawTime 是片段内进度）
  const nearEnd = activePreviewClip
    ? rawTime >= activePreviewClip.duration - 3
    : song.duration > 0 && rawTime >= song.duration - 3;
  const requiredStalledTicks = isOnlineStreamPath(song.path) ? 12 : 4;

  if (ticks >= requiredStalledTicks && (unknownDuration || nearEnd)) {
    return { stalledProgressTicks: 0, shouldAutoAdvance: true };
  }
  return { stalledProgressTicks: ticks, shouldAutoAdvance: false };
}