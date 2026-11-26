/**
 * 「打开本地音频文件时默认使用 mini 小窗」的判定核心（纯函数，便于单测）。
 *
 * 语义边界：
 * - 仅认 open 来源——即系统「用弦予打开」文件关联 / 单实例 argv 转发；
 * - 拖放（drop）始终留在主窗处理：用户明明把文件拖进了主窗，
 *   再把主窗藏起来换小窗会违背直觉；
 * - 至少要有 1 个音频路径；
 * - 开关关闭时一律走主窗（现有行为）。
 */

export type MiniOpenPathSource = 'open' | 'drop';

export interface MiniOpenDecisionInput {
  /** 外部路径来源；缺失视为非 open（如未来新增来源默认不进小窗） */
  source?: MiniOpenPathSource;
  /** 本批要交给播放的音频路径数量 */
  pathCount: number;
  /** 设置项 settings.openLocalAudioInMiniWindow 的当前值 */
  enabled: boolean;
}

export function shouldUseMiniForOpen(input: MiniOpenDecisionInput): boolean {
  if (!input.enabled) {
    return false;
  }
  if (input.source !== 'open') {
    return false;
  }
  return input.pathCount > 0;
}