export interface AmlSeekLayoutTarget {
  resetScroll: () => void;
  suspendScrollForSeek?: () => void;
  setCurrentTime: (time: number, isSeek?: boolean) => void;
  alignScrollToSeekTarget?: (lineIndex?: number) => void;
  calcLayout: (sync?: boolean) => Promise<void> | void;
  update: (delta?: number) => void;
}

export function syncAmlLyricSeekLayout(
  player: AmlSeekLayoutTarget,
  timeMs: number,
  lineIndex?: number,
) {
  const targetTimeMs = Math.max(0, Math.trunc(timeMs));

  player.suspendScrollForSeek?.();
  player.resetScroll();
  player.setCurrentTime(targetTimeMs, true);
  player.alignScrollToSeekTarget?.(lineIndex);
  void player.calcLayout(true);
  player.update(0);
}

export function getPlaybackSeekSecondsForAmlLine(lineStartTimeMs: number, audioDelaySeconds: number) {
  return Math.max(0, lineStartTimeMs / 1000 + audioDelaySeconds);
}
