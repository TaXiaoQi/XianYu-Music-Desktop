/** 空闲判定的纯逻辑，单独放这里便于单测（不依赖 DOM 与 Pinia） */

export interface IdleDecisionParams {
  /** 最后一次应用内活动的时间戳（ms） */
  lastActivityMs: number;
  /** 当前时间戳（ms） */
  nowMs: number;
  /** 空闲阈值（分钟） */
  idleMinutes: number;
  /** 只有正在播放时才需要为空闲收尾 */
  isPlaying: boolean;
}

/**
 * 是否应当因空闲而触发收尾。
 * - 暂停状态不触发（人离开且没在放歌，没有要停的东西）
 * - 时钟回拨（nowMs < lastActivityMs）时不触发
 */
export function shouldFireIdle(params: IdleDecisionParams): boolean {
  const { lastActivityMs, nowMs, idleMinutes, isPlaying } = params;
  if (!isPlaying) return false;
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) return false;

  const idleMs = nowMs - lastActivityMs;
  if (idleMs < 0) return false;

  return idleMs >= idleMinutes * 60_000;
}

/** 剩余时间显示：秒 → mm:ss，超过一小时则 h:mm:ss */
export function formatRemaining(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}
