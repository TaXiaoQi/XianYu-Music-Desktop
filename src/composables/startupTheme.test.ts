import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyPersistedStartupTheme } from './startupTheme';
import { shouldApplyStartupThemePaint } from './startupTheme';

const PERSISTED_SETTINGS_KEY = 'player_settings';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

// ---------------------------------------------------------------------------
// 伪 DOM 设施：node 环境下手工搭出 document / localStorage / window 的最小面
// ---------------------------------------------------------------------------

const buildStyleDeck = () => {
  const cssVariables = new Map<string, string>();
  return {
    backgroundColor: '',
    setProperty: (token: string, resolved: string) => {
      cssVariables.set(token, resolved);
    },
    getPropertyValue: (token: string) => cssVariables.get(token) ?? '',
  };
};

const buildClassToggle = () => {
  const members = new Set<string>();
  return {
    toggle: (token: string, on: boolean) => {
      if (on) members.add(token);
      else members.delete(token);
    },
    contains: (token: string) => members.has(token),
  };
};

const buildRootElement = () => {
  const flagNames = new Set<string>();
  return {
    classList: buildClassToggle(),
    style: buildStyleDeck(),
    setAttribute: (name: string) => flagNames.add(name),
    removeAttribute: (name: string) => flagNames.delete(name),
    hasAttribute: (name: string) => flagNames.has(name),
  };
};

/** 安装一套全新的伪 document + localStorage，返回引用供断言取值 */
const mountFakeDocument = () => {
  const root = buildRootElement();
  const bodyNode = { style: buildStyleDeck() };
  Object.defineProperty(globalThis, 'document', {
    value: { documentElement: root, body: bodyNode },
    configurable: true,
  });

  const kv = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      clear: () => kv.clear(),
      getItem: (key: string) => kv.get(key) ?? null,
      setItem: (key: string, value: string) => void kv.set(key, value),
    },
    configurable: true,
  });

  return { root, bodyNode };
};

/** 安装 matchMedia 桩并返回 spy，用于断言系统暗色查询串 */
const installSystemPreference = (osPrefersDark: boolean) => {
  const mediaQuerySpy = vi.fn().mockReturnValue({
    matches: osPrefersDark,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  Object.defineProperty(globalThis, 'window', {
    value: { matchMedia: mediaQuerySpy },
    configurable: true,
  });
  return mediaQuerySpy;
};

/** 以 settings store 的落盘格式写入持久化主题配置 */
const seedPersistedTheme = (themePayload: Record<string, unknown>) => {
  localStorage.setItem(PERSISTED_SETTINGS_KEY, JSON.stringify({ theme: themePayload }));
};

// ---------------------------------------------------------------------------
// 断言取值辅助
// ---------------------------------------------------------------------------

const rootElement = () => document.documentElement;
const rootFlags = () => rootElement().classList;
const rootPaint = () => rootElement().style;
const bodyPaint = () => document.body.style;

beforeEach(() => {
  mountFakeDocument();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
});

describe('startupTheme 首帧补绘', () => {
  it('持久化主题为暗色时，挂载前写入暗色类与暗色底色', () => {
    seedPersistedTheme({ mode: 'dark', windowMaterial: 'acrylic' });

    applyPersistedStartupTheme();

    expect(rootFlags().contains('dark')).toBe(true);
    expect(rootPaint().backgroundColor).toBe('#262626');
    expect(bodyPaint().backgroundColor).toBe('#262626');
  });

  it('持久化主题为亮色时，保持亮色底色且不加暗色类', () => {
    seedPersistedTheme({ mode: 'light', windowMaterial: 'acrylic' });

    applyPersistedStartupTheme();

    expect(rootFlags().contains('dark')).toBe(false);
    expect(rootPaint().backgroundColor).toBe('#fafafa');
    expect(bodyPaint().backgroundColor).toBe('#fafafa');
  });

  it('挂载前即恢复持久化的主题色 CSS 变量', () => {
    seedPersistedTheme({ mode: 'light', accentColor: '#3b82f6' });

    applyPersistedStartupTheme();

    expect(rootPaint().getPropertyValue('--theme-color')).toBe('#3B82F6');
    expect(rootPaint().getPropertyValue('--theme-color-rgb')).toBe('59 130 246');
  });

  it('mode 为 system 且系统偏好暗色时，按暗色补绘', () => {
    const mediaQuerySpy = installSystemPreference(true);
    seedPersistedTheme({ mode: 'system' });

    applyPersistedStartupTheme();

    expect(mediaQuerySpy).toHaveBeenCalledWith(SYSTEM_DARK_QUERY);
    expect(rootFlags().contains('dark')).toBe(true);
    expect(rootPaint().backgroundColor).toBe('#262626');
  });

  it('mode 为 system 且系统偏好亮色时，按亮色补绘', () => {
    const mediaQuerySpy = installSystemPreference(false);
    seedPersistedTheme({ mode: 'system' });

    applyPersistedStartupTheme();

    expect(mediaQuerySpy).toHaveBeenCalledWith(SYSTEM_DARK_QUERY);
    expect(rootFlags().contains('dark')).toBe(false);
    expect(rootPaint().backgroundColor).toBe('#fafafa');
  });

  it('透明辅助窗口不做首帧补绘，仅主窗口放行', () => {
    expect(shouldApplyStartupThemePaint('main')).toBe(true);
    expect(shouldApplyStartupThemePaint('desktop-lyrics')).toBe(false);
    expect(shouldApplyStartupThemePaint('mini-player')).toBe(false);
    expect(shouldApplyStartupThemePaint('tray-menu')).toBe(false);
  });
});
