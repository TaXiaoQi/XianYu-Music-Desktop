/**
 * 行级 seek 的同步排布工具。
 *
 * 点击歌词行跳播时，渲染器需要一次性完成「冻结手动滚轮 → 归零偏移 →
 * 以 seek 语义刷新时间 → 对齐目标行 → 同步重排 → 落位」的整套动作，
 * 这里把这个时序收敛成单一入口，避免调用方各自拼装导致状态残留。
 */

export interface WordLyricSeekLayoutTarget {
  resetScroll: () => void;
  suspendScrollForSeek?: () => void;
  setCurrentTime: (time: number, isSeek?: boolean) => void;
  alignScrollToSeekTarget?: (lineIndex?: number) => void;
  calcLayout: (sync?: boolean) => Promise<void> | void;
  update: (delta?: number) => void;
}

/**
 * 把播放位置同步到指定行：
 * 1. 暂停滚轮（两帧后恢复），避免 seek 过程中用户输入搅动布局；
 * 2. 清掉手动滚动偏移与计时器；
 * 3. 以 seek 模式写入时间（活动行与布局同步重算）；
 * 4. 显式指定对齐行（起播未唱对行头，唱过则对下一行）；
 * 5. 同步重排并立即落位一帧。
 */
export function syncWordLyricSeekLayout(
  player: WordLyricSeekLayoutTarget,
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

/** 行首毫秒时间 + 歌词音频延迟 → 实际 seek 的秒数，负值钳到 0。 */
export function getPlaybackSeekSecondsForLyricLine(lineStartTimeMs: number, audioDelaySeconds: number) {
  return Math.max(0, lineStartTimeMs / 1000 + audioDelaySeconds);
}
