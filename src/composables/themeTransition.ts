/**
 * 深浅色切换的渐变过渡
 *
 * 背景：主题切换只是在 <html> 上增删 `dark` class，所有 Tailwind `dark:`
 * 变体会在同一帧内翻转，视觉上是"硬切"。
 *
 * 做法：切换前给 <html> 挂上 `theme-transitioning`，由 style.css 里的规则
 * 为颜色类属性（background-color / color / border-color 等）临时开启过渡，
 * 动画结束后再摘掉。只在切换瞬间生效，避免常驻的全局 transition 影响
 * 其它交互动画的响应速度。
 *
 * 不做过渡的三种情况：
 * 1. 首次应用（启动时）—— 启动本就要求首帧直接是最终配色，不能有淡入
 * 2. 目标状态与当前一致 —— 无变化不必动画
 * 3. 用户在系统里开启了"减少动态效果"
 */

const TRANSITION_CLASS = 'theme-transitioning';
const STARTUP_PAINT_ATTRIBUTE = 'data-xianyu-startup-paint';

/** 与 style.css 中的 transition-duration 保持一致 */
export const THEME_TRANSITION_DURATION = 320;

/** 每个 document 只跳过一次动画（首次应用），之后的切换都走过渡 */
const initializedDocuments = new WeakSet<Document>();
const pendingCleanups = new WeakMap<Document, ReturnType<typeof setTimeout>>();

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * 应用深浅色 class，并在需要时附带渐变过渡。
 *
 * @param isDark 目标是否为深色
 * @param doc 目标文档，默认当前文档（副窗口各有自己的 document）
 */
export function applyDarkClassWithTransition(isDark: boolean, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return;

  const root = doc.documentElement;
  if (!root) return;

  const wasDark = root.classList.contains('dark');
  const isFirstApply = !initializedDocuments.has(doc);
  initializedDocuments.add(doc);

  const setClass = () => {
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  };

  // 启动阶段的首帧上色标记仍在时不做动画（部分测试/宿主的 documentElement
  // 是精简 stub，没有 hasAttribute，这里容错处理）
  const hasStartupPaint = typeof root.hasAttribute === 'function'
    && root.hasAttribute(STARTUP_PAINT_ATTRIBUTE);

  // 启动首帧、状态未变、或用户要求减少动效时，直接切换不做过渡
  const skipAnimation = isFirstApply
    || wasDark === isDark
    || hasStartupPaint
    || prefersReducedMotion();

  if (skipAnimation) {
    setClass();
    return;
  }

  // 连续快速切换时重置计时器，避免前一次的清理提前摘掉过渡类
  const pending = pendingCleanups.get(doc);
  if (pending) {
    clearTimeout(pending);
    pendingCleanups.delete(doc);
  }

  root.classList.add(TRANSITION_CLASS);
  setClass();

  const timer = setTimeout(() => {
    pendingCleanups.delete(doc);
    root.classList.remove(TRANSITION_CLASS);
  }, THEME_TRANSITION_DURATION);

  pendingCleanups.set(doc, timer);
}

/** 测试用：重置"首次应用"记录与待清理计时器 */
export function resetThemeTransitionState(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return;
  initializedDocuments.delete(doc);
  const pending = pendingCleanups.get(doc);
  if (pending) {
    clearTimeout(pending);
    pendingCleanups.delete(doc);
  }
}
