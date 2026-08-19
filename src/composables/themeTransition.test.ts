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

/** 构造一个最小 document stub，可选带启动上色标记 */
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

    // 首次应用建立基线（浅色）
    applyDarkClassWithTransition(false, doc);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);

    // 真正的切换：浅 -> 深
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

    // 第一次的清理还差 100ms，此时再切一次
    applyDarkClassWithTransition(false, doc);
    vi.advanceTimersByTime(100);

    // 旧计时器已被重置，过渡类应该还在
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(true);

    vi.advanceTimersByTime(THEME_TRANSITION_DURATION);
    expect(doc.documentElement.classList.contains('theme-transitioning')).toBe(false);
  });
});
