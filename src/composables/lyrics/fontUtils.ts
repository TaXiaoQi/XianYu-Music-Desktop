/**
 * 歌词字体工具：预设 → CSS font-family 解析、导入字体注册、系统字体枚举。
 */

import { ref, type Ref } from 'vue';
import { lyricsApi } from '../../services/tauri/lyricsApi';
import type {
  ImportedLyricsFont,
} from '../../types';
import { escapeFontFamilyName, extractPrimaryFontFamily, LYRICS_FONT_OPTIONS, normalizeCustomFontName, normalizeLyricsFontPreset, type LyricsFontOption } from './constants';

/* ==================== 预设 → font-family ==================== */

/** 单个 FontFace 的加载预算（毫秒）：超时先放行，避免损坏字体卡住 UI。 */
const FONT_LOAD_BUDGET_MS = 1200;

/** 内置预设的头部族名集合（小写），用于从系统字体列表里剔除同名项。 */
const builtinFamilySet: ReadonlySet<string> = (() => {
  const collected = new Set<string>();
  for (const option of LYRICS_FONT_OPTIONS) {
    const primary = extractPrimaryFontFamily(option.fontFamily).toLocaleLowerCase();
    if (primary !== '') {
      collected.add(primary);
    }
  }
  return collected;
})();

export function getLyricsFontFamily(preset: string): string {
  for (const option of LYRICS_FONT_OPTIONS) {
    if (option.value === preset) {
      return option.fontFamily;
    }
  }
  // 未登记的预设一律视为自定义字体名：加引号后挂上兜底字体栈。
  return `${escapeFontFamilyName(normalizeLyricsFontPreset(preset))}, system-ui, sans-serif`;
}

/** 族名 → 带引号并挂 system-ui 兜底的 CSS font-family。 */
function quotedFamilyWithFallback(family: string): string {
  return `${escapeFontFamilyName(family)}, system-ui, sans-serif`;
}

export function buildImportedLyricsFontOptions(fonts: ImportedLyricsFont[]): LyricsFontOption[] {
  const options: LyricsFontOption[] = [];
  for (const { family, name } of fonts) {
    options.push({
      value: family,
      label: name,
      fontFamily: quotedFamilyWithFallback(family),
      isImported: true,
    });
  }
  return options;
}

/* ==================== 导入字体注册 ==================== */

/** 注册成功后自增，通知依赖方刷新字体选项。 */
export const importedLyricsFontsRevision: Ref<number> = ref(0);

function bumpRevision(): void {
  importedLyricsFontsRevision.value = importedLyricsFontsRevision.value + 1;
}

/** 挂载 @font-face 的样式节点（惰性创建）。 */
let importedFontStyleNode: HTMLStyleElement | null = null;

/** 注册批次号：异步注册期间若来了新请求，旧批次结果整体作废。 */
let registrationBatch = 0;

/** 已成功挂到 document.fonts 的 FontFace，按族名记录。 */
const mountedFontFaces = new Map<string, FontFace>();

async function readFontPayload(font: ImportedLyricsFont): Promise<string | null> {
  try {
    return await lyricsApi.readLyricsFontDataUrl(font.filePath);
  } catch (readError) {
    console.warn('Imported lyrics font data unavailable:', font.name, readError);
    return null; // 读取失败按“无该字体”处理
  }
}

async function mountFontFace(font: ImportedLyricsFont, payloadUrl: string): Promise<FontFace | null> {
  if (typeof FontFace === 'undefined') {
    return null; // 非 DOM 环境直接放弃
  }
  try {
    const face = new FontFace(font.family, `url(${JSON.stringify(payloadUrl)})`, { display: 'swap' });
    const loadOutcome = face.load()
      .then(() => face)
      .catch((loadError) => {
        console.warn('Imported lyrics FontFace failed to load:', font.name, loadError);
        return null;
      });
    const budget = new Promise<FontFace | null>((resolve) => {
      setTimeout(() => resolve(face), FONT_LOAD_BUDGET_MS);
    });
    // 加载与预算赛跑：超时也放行已创建的 FontFace，让浏览器自行回退。
    return await Promise.race([loadOutcome, budget]);
  } catch (setupError) {
    console.warn('Imported lyrics FontFace cannot be created:', font.name, setupError);
    return null;
  }
}

/** 把本模块登记的 FontFace 全部从 document.fonts 摘除。 */
function unmountAllFontFaces(): void {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return;
  }
  for (const face of mountedFontFaces.values()) {
    document.fonts.delete(face);
  }
  mountedFontFaces.clear();
}

export async function registerImportedLyricsFonts(fonts: ImportedLyricsFont[]): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }

  if (!importedFontStyleNode) {
    const node = document.createElement('style');
    node.setAttribute('data-xianyu-imported-lyrics-fonts', 'true');
    document.head.appendChild(node);
    importedFontStyleNode = node;
  }

  const batch = registrationBatch + 1;
  registrationBatch = batch;

  if (fonts.length === 0) {
    importedFontStyleNode.textContent = '';
    unmountAllFontFaces();
    bumpRevision();
    return;
  }

  const mounted = await Promise.all(fonts.map(async (font) => {
    const payloadUrl = await readFontPayload(font);
    if (payloadUrl === null) {
      return null;
    }
    const face = await mountFontFace(font, payloadUrl);
    return face === null ? null : { family: font.family, face };
  }));

  // 注册期间又来了新请求：本轮结果作废，由最新批次接管。
  if (batch !== registrationBatch) {
    return;
  }

  importedFontStyleNode.textContent = '';
  unmountAllFontFaces();
  for (const entry of mounted) {
    if (entry === null) {
      continue;
    }
    mountedFontFaces.set(entry.family, entry.face);
    document.fonts.add(entry.face);
  }
  bumpRevision();
}

export async function importLyricsFontFile(sourcePath: string): Promise<ImportedLyricsFont> {
  return lyricsApi.importLyricsFont(sourcePath);
}

/* ==================== 系统字体枚举 ==================== */

export const systemLyricsFontOptions: Ref<LyricsFontOption[]> = ref([]);

let systemFontTask: Promise<void> | null = null;
let systemFontTaskDone = false;

/** 系统字体清洗：折叠命名、剔除内置预设同名族、按 zh-CN 序去重排列。 */
function collectDistinctFamilies(rawFamilies: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const rawFamily of rawFamilies) {
    const tidied = normalizeCustomFontName(rawFamily);
    if (tidied === '' || seen.has(tidied) || builtinFamilySet.has(tidied.toLocaleLowerCase())) {
      continue;
    }
    seen.add(tidied);
    kept.push(tidied);
  }
  kept.sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return kept;
}

function toSystemFontOption(family: string): LyricsFontOption {
  return { value: family, label: family, fontFamily: quotedFamilyWithFallback(family), isSystem: true };
}

async function refreshSystemFontOptions(): Promise<void> {
  try {
    const rawFamilies = await lyricsApi.getSystemFonts();
    systemLyricsFontOptions.value = collectDistinctFamilies(rawFamilies).map(toSystemFontOption);
  } catch (listError) {
    console.warn('System font list unavailable:', listError);
    systemLyricsFontOptions.value = [];
  }
}

export async function loadSystemLyricsFonts(force = false): Promise<void> {
  if (systemFontTaskDone && !force) {
    return;
  }
  if (systemFontTask !== null) {
    return systemFontTask;
  }
  systemFontTask = refreshSystemFontOptions().finally(() => {
    systemFontTaskDone = true;
    systemFontTask = null;
  });
  return systemFontTask;
}
