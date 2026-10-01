import { squareAbsoluteUrl } from './themeSquare';

/**
 * 桌面端本地主题库（对齐移动端 ThemeLibraryState 语义）：
 * 文件导入与主题中心下载的包都落库；「我的下载」= source==='square' 的子集。
 * 无 activeId——桌面端"应用"即写入设置，库只负责留存与二次应用。
 */
export interface LibraryThemeEntry {
  /** 唯一键：square-<服务端id> / file-<时间戳随机> */
  key: string;
  source: 'file' | 'square';
  /** 广场来源的服务端主题 id（去重与「我的下载」标记依据） */
  squareId?: number;
  name: string;
  author: string;
  /** 展示用预览图（已绝对化；文件导入可能为空） */
  preview: string;
  /** 完整 v2 主题包（广场来源已在下载时把资源 URL 绝对化） */
  raw: unknown;
  addedAt: string;
}

const PACKS_KEY = 'xianyu_desktop_theme_packs_v1';

function loadPacks(): LibraryThemeEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PACKS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LibraryThemeEntry =>
        !!item && typeof item === 'object' && typeof (item as LibraryThemeEntry).key === 'string' &&
        typeof (item as LibraryThemeEntry).name === 'string' &&
        ((item as LibraryThemeEntry).raw ?? null) !== null,
    );
  } catch {
    return [];
  }
}

function persistPacks(list: LibraryThemeEntry[]): void {
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(list));
  } catch {
    // 容量不足时放弃持久化，保留内存态（本次会话仍可用）。
  }
}

export function listLibraryThemes(): LibraryThemeEntry[] {
  return loadPacks();
}

/** 入库：广场来源按 squareId 去重覆盖，文件导入始终新增。返回入库后的条目。 */
export function addLibraryTheme(input: Omit<LibraryThemeEntry, 'key' | 'addedAt'>): LibraryThemeEntry {
  const key = input.source === 'square' && typeof input.squareId === 'number'
    ? `square-${input.squareId}`
    : `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: LibraryThemeEntry = { ...input, key, addedAt: new Date().toISOString() };
  persistPacks([entry, ...loadPacks().filter((item) => item.key !== key)]);
  return entry;
}

export function removeLibraryTheme(key: string): void {
  persistPacks(loadPacks().filter((item) => item.key !== key));
}

/** 卡片预览图绝对化（文件导入的相对/绝对/data: 地址同规则处理）。 */
export function libraryPreview(url: string): string {
  return squareAbsoluteUrl(url || '');
}
