import { describe, expect, it } from 'vitest';

import source from './windowMaterial.ts?raw';

import {
  rebuildWindowMaterialForCompositor,
  resolveWindowMaterial,
  useWindowMaterial,
  type WindowMaterialCapabilities,
} from './windowMaterial';

const createCapabilities = (
  patch: Partial<WindowMaterialCapabilities>,
): WindowMaterialCapabilities => ({
  isWindows: true,
  supportsAcrylic: true,
  supportsMica: true,
  supportsBlur: true,
  systemTransparencyEnabled: true,
  windowsBuildNumber: 19045,
  ...patch,
});

describe('window material resolver', () => {
  it('allows blur on Windows 10 while keeping acrylic and mica on Windows 11 only', () => {
    const win10 = createCapabilities({
      supportsMica: false,
      windowsBuildNumber: 19045,
    });

    expect(resolveWindowMaterial('blur', win10)).toBe('blur');
    expect(resolveWindowMaterial('acrylic', win10)).toBe('none');
    expect(resolveWindowMaterial('mica', win10)).toBe('none');
  });

  it('keeps acrylic and mica available on Windows 11', () => {
    const win11 = createCapabilities({
      supportsBlur: false,
      windowsBuildNumber: 22631,
    });

    expect(resolveWindowMaterial('acrylic', win11)).toBe('acrylic');
    expect(resolveWindowMaterial('mica', win11)).toBe('mica');
  });

  it('blocks all window materials when system transparency is disabled', () => {
    const capabilities = createCapabilities({
      systemTransparencyEnabled: false,
      windowsBuildNumber: 19045,
    });

    expect(resolveWindowMaterial('blur', capabilities)).toBe('none');
    expect(resolveWindowMaterial('acrylic', capabilities)).toBe('none');
    expect(resolveWindowMaterial('mica', capabilities)).toBe('none');
  });

  it('rebuilds a selected material by clearing effects before reapplying it', async () => {
    const calls: string[] = [];
    const result = await rebuildWindowMaterialForCompositor('acrylic', true, 50, {
      clearEffects: async () => {
        calls.push('clear');
      },
      waitForRepaint: async () => {
        calls.push('repaint');
      },
      applyMaterial: async () => {
        calls.push('apply');
        return 'acrylic';
      },
    });

    expect(result).toBe('acrylic');
    expect(calls).toEqual(['clear', 'repaint', 'apply']);
  });

  it('does not clear effects when no window material is selected', async () => {
    const calls: string[] = [];
    await rebuildWindowMaterialForCompositor('none', false, 50, {
      clearEffects: async () => {
        calls.push('clear');
      },
      waitForRepaint: async () => {
        calls.push('repaint');
      },
      applyMaterial: async () => {
        calls.push('apply');
        return 'none';
      },
    });

    expect(calls).toEqual(['apply']);
  });
});

describe('materialSwitching 过渡抑制范围', () => {
  it('无材质重同步（none → none）不禁用 CSS 过渡', () => {
    // 深浅色切换与窗口聚焦都会以 none → none 走一遍 applyWindowMaterial。
    // 若此时置 materialSwitching=true，MainShell 的
    // `.material-switching * { transition: none !important }`
    // 会掐掉整棵树的过渡，主题渐变将永远不生效。
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
