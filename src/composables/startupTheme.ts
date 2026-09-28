// 首帧主题引导：在 Vue 应用挂载之前，把持久化的主题色与明暗基调直接刷到
// document 上，避免冷启动时出现一次错误底色的闪烁。这个阶段 pinia 还没有
// 初始化，因此这里直接解析 localStorage 中的 settings 快照，而不经过 store。
import {
  applyThemeColorToDocument,
  DEFAULT_THEME_COLOR,
  normalizeThemeColor,
} from '../utils/themeColor';

/** settings store 落盘使用的 localStorage 键，启动阶段必须与 store 侧保持一致 */
const PERSISTED_SETTINGS_STORAGE_KEY = 'player_settings';

/** 深浅两套首帧底色：与暗色/亮色面板背景保持一致，覆盖 index.html 的默认底色 */
const FIRST_PAINT_TONE = {
  dark: '#262626',
  light: '#fafafa',
} as const;

/** 首帧补绘完成标记，挂在 <html> 上，等 Vue 渲染就绪后由 clearStartupThemePaint 摘除 */
const ROOT_PAINT_FLAG = 'data-xianyu-startup-paint';

/** Tailwind 暗色模式开关类名 */
const ROOT_DARK_CLASS = 'dark';

/** 仅主窗口需要首帧补绘；桌面歌词、迷你播放器等透明窗口必须跳过 */
const MAIN_WINDOW_LABEL = 'main';

/** matchMedia 查询串：mode 为 system 时的暗色判定依据 */
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/** 启动阶段只关心 settings JSON 的这几个字段，其余内容一律忽略 */
interface StartupThemeSnapshot {
  mode?: unknown;
  accentColor?: unknown;
  customBackground?: {
    foregroundStyle?: unknown;
  };
}

interface StartupSettingsSnapshot {
  theme?: StartupThemeSnapshot;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 读取并校验持久化 settings；缺存储、解析失败或结构异常时按「无持久化」处理 */
function readStartupSettingsSnapshot(): StartupSettingsSnapshot | null {
  if (typeof localStorage === 'undefined') return null;

  const serialized = localStorage.getItem(PERSISTED_SETTINGS_STORAGE_KEY);
  if (!serialized) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    parsed = null;
  }

  return isPlainRecord(parsed) ? (parsed as StartupSettingsSnapshot) : null;
}

/** 查询操作系统的暗色偏好；无法查询（SSR / 环境缺失）时视为亮色 */
function systemColorSchemePrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/**
 * 依据持久化的 mode 推导首帧是否按暗色渲染：
 * - dark：直接暗色
 * - system：查询操作系统偏好
 * - custom：跟随自定义背景的前景明暗（前景为 light 时界面按暗色呈现）
 * - 其余（light / 未知历史取值）：亮色
 */
function snapshotImpliesDarkTheme(snapshot: StartupSettingsSnapshot | null): boolean {
  const theme = snapshot?.theme;
  if (typeof theme !== 'object' || theme === null) {
    return false;
  }

  switch (theme.mode) {
    case 'dark': return true;
    case 'system': return systemColorSchemePrefersDark();
    case 'custom': return theme.customBackground?.foregroundStyle === 'light';
    default: return false;
  }
}

/** 首帧底色取值：暗色面板与亮色面板各有一份固化色值 */
function firstPaintToneFor(isDark: boolean): string {
  return FIRST_PAINT_TONE[isDark ? 'dark' : 'light'];
}

/** 仅恢复主题色 CSS 变量，不处理明暗基调（供任意窗口的无闪烁取色入口调用） */
export function applyPersistedThemeColor() {
  const snapshot = readStartupSettingsSnapshot();
  return applyThemeColorToDocument(normalizeThemeColor(snapshot?.theme?.accentColor, DEFAULT_THEME_COLOR));
}

/** 主窗口才做首帧补绘；label 缺失（如首包阶段）视同主窗口 */
export function shouldApplyStartupThemePaint(windowLabel: string | null | undefined) {
  if (windowLabel) {
    return windowLabel === MAIN_WINDOW_LABEL;
  }
  return true;
}

/** 挂载前把持久化主题色与明暗基调一次性刷到 document，消除首帧闪烁 */
export function applyPersistedStartupTheme() {
  if (typeof document === 'undefined') return;

  const snapshot = readStartupSettingsSnapshot();
  applyThemeColorToDocument(normalizeThemeColor(snapshot?.theme?.accentColor, DEFAULT_THEME_COLOR));

  const isDark = snapshotImpliesDarkTheme(snapshot);
  const paintTone = firstPaintToneFor(isDark);

  document.documentElement.classList.toggle(ROOT_DARK_CLASS, isDark);
  document.documentElement.style.backgroundColor = paintTone;
  if (document.body) document.body.style.backgroundColor = paintTone;

  document.documentElement.setAttribute(ROOT_PAINT_FLAG, 'true');
}

/** Vue 首屏渲染就绪后摘除首帧补绘，把背景控制权交还给正常渲染链路 */
export function clearStartupThemePaint() {
  if (typeof document === 'undefined') return;
  if (!document.documentElement.hasAttribute(ROOT_PAINT_FLAG)) return;

  document.documentElement.style.backgroundColor = '';
  if (document.body) document.body.style.backgroundColor = '';
  document.documentElement.removeAttribute(ROOT_PAINT_FLAG);
}
