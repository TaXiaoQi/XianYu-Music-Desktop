// 「打开本地音频文件时默认使用 mini 小窗」判定矩阵：
// 只有 open 来源（文件关联/单实例 argv）+ 开关开启 + 至少 1 个音频路径才进小窗。
import { describe, expect, it } from 'vitest';

import { shouldUseMiniForOpen } from './openLocalAudioInMini';

describe('shouldUseMiniForOpen', () => {
  it('open 来源 + 开关开启 + 有音频路径 → 进小窗', () => {
    expect(
      shouldUseMiniForOpen({ source: 'open', pathCount: 1, enabled: true }),
    ).toBe(true);
    expect(
      shouldUseMiniForOpen({ source: 'open', pathCount: 3, enabled: true }),
    ).toBe(true);
  });

  it('开关关闭 → 走主窗（保持现状行为）', () => {
    expect(
      shouldUseMiniForOpen({ source: 'open', pathCount: 1, enabled: false }),
    ).toBe(false);
  });

  it('拖放来源 → 始终留在主窗（不因拖进来而藏窗）', () => {
    expect(
      shouldUseMiniForOpen({ source: 'drop', pathCount: 1, enabled: true }),
    ).toBe(false);
  });

  it('来源缺失或空批次 → 不进小窗', () => {
    expect(shouldUseMiniForOpen({ pathCount: 1, enabled: true })).toBe(false);
    expect(
      shouldUseMiniForOpen({ source: 'open', pathCount: 0, enabled: true }),
    ).toBe(false);
  });
});