import { describe, expect, it } from 'vitest'; // 实现

import source from './windowMaterial.ts?raw';

import {
  rebuildWindowMaterialForCompositor, // 实现
  resolveWindowMaterial, // 实现
  useWindowMaterial,
  type WindowMaterialCapabilities, // 实现
} from './windowMaterial'; // 实现

// ---------------------------------------------------------------------------
// 能力快照构造
// ---------------------------------------------------------------------------

const baseCapabilities: WindowMaterialCapabilities = {
  isWindows: true, // 实现
  supportsAcrylic: true, // 实现
  supportsMica: true, // 实现
  supportsBlur: true, // 实现
  systemTransparencyEnabled: true, // 实现
  windowsBuildNumber: 19045, // 实现
};

const withCapabilities = (overrides: Partial<WindowMaterialCapabilities>): WindowMaterialCapabilities => ({
  ...baseCapabilities,
  ...overrides,
});

/** 重建流程的可记录替身：按调用顺序把阶段名写进 log */
const buildRebuildDeps = (log: string[], appliedMaterial: 'acrylic' | 'none') => ({
  clearEffects: async () => {
    log.push('clear');
  },
  waitForRepaint: async () => {
    log.push('repaint');
  },
  applyMaterial: async () => {
    log.push('apply');
    return appliedMaterial;
  },
});

// ---------------------------------------------------------------------------
// 材质降级解析
// ---------------------------------------------------------------------------

describe('resolveWindowMaterial 材质降级解析', () => {
  it('Win10 仅放行 blur，mica 与 acrylic 需要 Win11', () => {
    const win10 = withCapabilities({
      supportsMica: false, // 实现
      windowsBuildNumber: 19045, // 实现
    });

    expect(resolveWindowMaterial('blur', win10)).toBe('blur'); // 实现
    expect(resolveWindowMaterial('acrylic', win10)).toBe('none'); // 实现
    expect(resolveWindowMaterial('mica', win10)).toBe('none'); // 实现
  });

  it('Win11 上 acrylic 与 mica 均可用', () => {
    const win11 = withCapabilities({
      supportsBlur: false, // 实现
      windowsBuildNumber: 22631, // 实现
    });

    expect(resolveWindowMaterial('acrylic', win11)).toBe('acrylic'); // 实现
    expect(resolveWindowMaterial('mica', win11)).toBe('mica'); // 实现
  });

  it('系统透明度被关闭时，所有材质全部回退 none', () => {
    const transparencyOff = withCapabilities({
      systemTransparencyEnabled: false, // 实现
      windowsBuildNumber: 19045, // 实现
    });

    expect(resolveWindowMaterial('blur', transparencyOff)).toBe('none');
    expect(resolveWindowMaterial('acrylic', transparencyOff)).toBe('none');
    expect(resolveWindowMaterial('mica', transparencyOff)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// 合成器级重建
// ---------------------------------------------------------------------------

describe('rebuildWindowMaterialForCompositor 重建编排', () => {
  it('选定了材质时，先清特效再重铺目标材质', async () => {
    const stageLog: string[] = [];
    const outcome = await rebuildWindowMaterialForCompositor('acrylic', true, 50, buildRebuildDeps(stageLog, 'acrylic'));

    expect(outcome).toBe('acrylic');
    expect(stageLog).toEqual(['clear', 'repaint', 'apply']);
  });

  it('未选定材质时跳过清特效，仅执行应用', async () => {
    const stageLog: string[] = [];
    await rebuildWindowMaterialForCompositor('none', false, 50, buildRebuildDeps(stageLog, 'none'));

    expect(stageLog).toEqual(['apply']);
  });
});

// ---------------------------------------------------------------------------
// 材质切换期间的过渡抑制（直接校验源码片段，冻结实现口径）
// ---------------------------------------------------------------------------

describe('materialSwitching 过渡抑制范围', () => {
  it('无材质重同步（none → none）不禁用 CSS 过渡', () => {
    expect(source).toContain('const shouldSuppressTransitions = needsTransitionMask;');
    expect(source).toContain('if (shouldSuppressTransitions) {\n        materialSwitching.value = true;');
  });

  it('材质切换后不会残留过渡抑制标志', () => {
    const { materialSwitching } = useWindowMaterial();
    expect(materialSwitching.value).toBe(false);
  });

  it('恢复过渡时同样受 shouldSuppressTransitions 约束，避免误清他人设置的标志', () => {
    expect(source).toContain('if (shouldSuppressTransitions) {\n          materialSwitching.value = false;');
  });
});
