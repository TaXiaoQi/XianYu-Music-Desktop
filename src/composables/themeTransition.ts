
const TRANSITION_CLASS = 'theme-transitioning';
const STARTUP_PAINT_ATTRIBUTE = 'data-xianyu-startup-paint';

export const THEME_TRANSITION_DURATION = 320;

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

  const hasStartupPaint = typeof root.hasAttribute === 'function'
    && root.hasAttribute(STARTUP_PAINT_ATTRIBUTE);

  const skipAnimation = isFirstApply
    || wasDark === isDark
    || hasStartupPaint
    || prefersReducedMotion();

  if (skipAnimation) {
    setClass();
    return;
  }

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

export function resetThemeTransitionState(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return;
  initializedDocuments.delete(doc);
  const pending = pendingCleanups.get(doc);
  if (pending) {
    clearTimeout(pending);
    pendingCleanups.delete(doc);
  }
}
