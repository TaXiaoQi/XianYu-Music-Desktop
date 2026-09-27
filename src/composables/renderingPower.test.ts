import { describe, expect, it } from 'vitest';

import type { MainWindowRenderingSnapshot } from './renderingPower';
import { resolveMainWindowLowPower } from './renderingPower';

// 基准快照：主窗口处于前台、可见、未最小化、非迷你模式的正常状态
const baseSnapshot = (): MainWindowRenderingSnapshot => ({
  documentHidden: false, windowFocused: true,
  windowVisible: true, windowMinimized: false,
  miniMode: false,
});

interface LowPowerCase {
  /** 用例说明（同时作为测试标题插值） */
  label: string;
  /** 在基准快照之上叠加的字段 */
  patch: Partial<MainWindowRenderingSnapshot>;
  /** 期望的低功耗判定结果 */
  expected: boolean;
}

// 覆盖五种状态组合的判定矩阵
const judgeCases: LowPowerCase[] = [
  { label: '前台且可见时保持全功率渲染', patch: {}, expected: false },
  { label: '窗口不可见时进入低功耗', patch: { windowVisible: false }, expected: true },
  { label: '窗口最小化时进入低功耗', patch: { windowMinimized: true }, expected: true },
  { label: '迷你模式下进入低功耗', patch: { miniMode: true }, expected: true },
  { label: '可见但未聚焦时仍保持全功率', patch: { windowFocused: false }, expected: false },
  { label: '页面被隐藏（切后台）时进入低功耗', patch: { documentHidden: true }, expected: true },
];

describe('resolveMainWindowLowPower', () => {
  it.each(judgeCases)('$label', ({ patch, expected }) => {
    expect(resolveMainWindowLowPower({ ...baseSnapshot(), ...patch })).toBe(expected);
  });

  it('documentHidden 参与判定（c15549ff 起：切后台自动暂停并降功率渲染）', () => {
    const hiddenInBackground = { ...baseSnapshot(), documentHidden: true };
    expect(resolveMainWindowLowPower(hiddenInBackground)).toBe(true);
  });
});
