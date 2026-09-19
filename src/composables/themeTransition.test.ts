import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyDarkClassWithTransition,
  resetThemeTransitionState,
  THEME_TRANSITION_DURATION,
} from './themeTransition';

const createClassList = () => {
  const classes = new Set<string>();
  return {
    add: (name: string) => classes.add(name),
    remove: (name: string) => classes.delete(name),
    contains: (name: string) => classes.has(name),
  };
};

const createDoc = (options: { startupPaint?: boolean } = {}) => {
  const attributes = new Set<string>();
  if (options.startupPaint) {
    attributes.add('data-xianyu-startup-paint');
  }

  return {
    documentElement: {
      classList: createClassList(),
      hasAttribute: (name: string) => attributes.has(name),
    },
  } as unknown as Document;
};

const setReducedMotion = (reduce: boolean) => {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
    }),
  });
};

describe('themeTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('首次应用直接切换，不挂过渡类', () => {
    const doc = createDoc();
    resetThemeTransitionState(doc);

    applyDarkClassWithTransition(true, doc);

    expect(doc.documentElement.classList.contains('dark')).toBe(true);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);
  });

  it('后续切换会挂过渡类，并在动画结束后摘除', () => {
    const doc = createDoc();
    resetThemeTransitionState(doc);

    applyDarkClassWithTransition(false, doc);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);

    applyDarkClassWithTransition(true, doc);
    expect(doc.documentElement.classList.contains('dark')).toBe(true);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(true);

    vi.advanceTimersByTime(THEME_TRANSITION_DURATION);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);
    expect(doc.documentElement.classList.contains('dark')).toBe(true);
  });

  it('目标状态与当前一致时不触发过渡', () => {
    const doc = createDoc();
    resetThemeTransitionState(doc);

    applyDarkClassWithTransition(true, doc);
    applyDarkClassWithTransition(true, doc);

    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);
  });

  it('启动上色标记仍在时不触发过渡', () => {
    const doc = createDoc({ startupPaint: true });
    resetThemeTransitionState(doc);

    applyDarkClassWithTransition(false, doc);
    applyDarkClassWithTransition(true, doc);

    expect(doc.documentElement.classList.contains('dark')).toBe(true);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);
  });

  it('系统开启减少动效时不触发过渡', () => {
    setReducedMotion(true);
    const doc = createDoc();
    resetThemeTransitionState(doc);

    applyDarkClassWithTransition(false, doc);
    applyDarkClassWithTransition(true, doc);

    expect(doc.documentElement.classList.contains('dark')).toBe(true);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);
  });

  it('连续快速切换时不会被前一次的清理提前摘掉过渡类', () => {
    const doc = createDoc();
    resetThemeTransitionState(doc);
    applyDarkClassWithTransition(false, doc);

    applyDarkClassWithTransition(true, doc);
    vi.advanceTimersByTime(THEME_TRANSITION_DURATION - 100);

    applyDarkClassWithTransition(false, doc);
    vi.advanceTimersByTime(100);

    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(true);

    vi.advanceTimersByTime(THEME_TRANSITION_DURATION);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);
  });
});
