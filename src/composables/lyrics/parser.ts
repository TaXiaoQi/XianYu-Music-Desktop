import type {
  LyricLine as AmlLyricLine,
  LyricWord as AmlLyricWord,
} from '@applemusic-like-lyrics/lyric/pkg/amll_lyric.js';

import type {
  ExplicitLineRole,
  ParsedLine,
  ParsedLineSourceFormat,
  ParsedWord,
} from './types';

const TIMESTAMP_BLOCK_PATTERN = /\[(\d+:\d{2}(?:\.\d+)?)]/g;
const ADJACENT_TIMESTAMPS_BEFORE_TEXT_PATTERN = /(?:\[\d+:\d{2}(?:\.\d+)?])+(?=[^[\]\r\n])/g;
const ESLRC_GAP_PLACEHOLDER = '\u2063';
const ENHANCED_TIMESTAMP_PATTERN = /<(\d+:\d{2}(?:\.\d+)?)>/g;
const ENHANCED_TIMESTAMP_TEXT_PATTERN = /<\d+:\d{2}(?:\.\d+)?>/;
const LRC_LINE_TIMESTAMP_PATTERN = /^\[(\d+:\d{2}(?:\.\d+)?)](.*)$/;
const ENHANCED_EMPTY_BACKWARD_TOLERANCE_MS = 5;

type ParserSource = ParsedLineSourceFormat;

interface ParserCandidate {
  source: ParserSource;
  lines: AmlLyricLine[];
}

const PARSER_PRIORITIES: Record<ParserSource, number> = {
  enhanced_lrc: 6,
  ttml: 5,
  yrc: 4,
  qrc: 3,
  lys: 2,
  eslrc: 1,
  lrc: 0,
};

const EXPLICIT_LINE_MARKERS: Array<{
  role: ExplicitLineRole;
  pattern: RegExp;
}> = [
  {
    role: 'translation',
    pattern: /^(?:\[(?:tr|trans|translation)\]|【(?:翻译|译文)】|(?:翻译|译文)[:：]\s*)/iu,
  },
  {
    role: 'roman',
    pattern: /^(?:\[(?:roma|romaji|roman)\]|【(?:罗马音|罗马字|音译)】|(?:罗马音|罗马字|音译)[:：]\s*)/iu,
  },
];

let amlModule: typeof import('@applemusic-like-lyrics/lyric/pkg/amll_lyric.js') | null = null;

async function getAmlModule() {
  if (!amlModule) {
    amlModule = await import('@applemusic-like-lyrics/lyric/pkg/amll_lyric.js');
  }
  return amlModule;
}

export function sanitizeLineText(text: string): string {
  return text.replace(/\u200b/g, '').trim();
}

export function sanitizeWordText(text: string): string {
  return text.replace(/[\u200b\u2063]/g, '');
}

export function normalizeEslrcSource(source: string): string {
  return source.replace(ADJACENT_TIMESTAMPS_BEFORE_TEXT_PATTERN, (match) => {
    const timestamps = [...match.matchAll(TIMESTAMP_BLOCK_PATTERN)];
    if (timestamps.length <= 1) return match;

    return timestamps
      .map((timestamp, index) => (index === timestamps.length - 1
        ? timestamp[0]
        : `${timestamp[0]}${ESLRC_GAP_PLACEHOLDER}`))
      .join('');
  });
}

export function parseTimestampToMs(raw: string): number | null {
  const match = /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/.exec(raw.trim());
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const milliseconds = Number((match[3] ?? '').padEnd(3, '0').slice(0, 3) || '0');

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(milliseconds)) {
    return null;
  }
  if (seconds >= 60) return null;

  return (minutes * 60 * 1000) + (seconds * 1000) + milliseconds;
}

export function isEnhancedLrcLine(line: string): boolean {
  const match = LRC_LINE_TIMESTAMP_PATTERN.exec(line);
  if (!match) return false;

  return ENHANCED_TIMESTAMP_TEXT_PATTERN.test(match[2]);
}

export function parseEnhancedLrcLine(line: string): AmlLyricLine | null {
  const lineMatch = LRC_LINE_TIMESTAMP_PATTERN.exec(line);
  if (!lineMatch) return null;

  const lineStartTime = parseTimestampToMs(lineMatch[1]);
  if (lineStartTime === null) return null;

  const body = lineMatch[2];
  const markers = [...body.matchAll(ENHANCED_TIMESTAMP_PATTERN)];
  if (markers.length < 2) return null;

  const leadingText = body.slice(0, markers[0].index ?? 0);
  if (leadingText.trim().length > 0) return null;

  const words: AmlLyricWord[] = [];
  let explicitEndTime: number | null = null;

  for (let index = 0; index < markers.length; index += 1) {
    const currentMarker = markers[index];
    const nextMarker = markers[index + 1];
    const currentStart = parseTimestampToMs(currentMarker[1]);
    if (currentStart === null) return null;

    const currentMarkerEnd = (currentMarker.index ?? 0) + currentMarker[0].length;
    const nextMarkerIndex = nextMarker?.index ?? body.length;
    const text = body.slice(currentMarkerEnd, nextMarkerIndex);

    if (!nextMarker) {
      if (text.length > 0) return null;
      explicitEndTime = currentStart;
      continue;
    }

    const nextStart = parseTimestampToMs(nextMarker[1]);
    if (nextStart === null) return null;
    if (nextStart < currentStart) {
      if (text.length === 0 && currentStart - nextStart <= ENHANCED_EMPTY_BACKWARD_TOLERANCE_MS) {
        continue;
      }
      return null;
    }
    if (text.length === 0) continue;

    words.push({
      startTime: currentStart,
      endTime: nextStart,
      word: text,
      romanWord: '',
    });
  }

  if (words.length === 0) return null;

  const endTime = explicitEndTime ?? words[words.length - 1].endTime;
  if (endTime < lineStartTime) return null;

  return {
    words,
    translatedLyric: '',
    romanLyric: '',
    isBG: false,
    isDuet: false,
    startTime: lineStartTime,
    endTime,
  };
}

export function parseEnhancedLrc(source: string): AmlLyricLine[] {
  const lines: AmlLyricLine[] = [];

  for (const rawLine of source.split('\n')) {
    if (!isEnhancedLrcLine(rawLine)) continue;

    const parsedLine = parseEnhancedLrcLine(rawLine);
    if (parsedLine) lines.push(parsedLine);
  }

  return lines;
}

function lineContainsEnhancedMarkup(line: AmlLyricLine): boolean {
  if (ENHANCED_TIMESTAMP_TEXT_PATTERN.test(line.translatedLyric || '')) return true;
  if (ENHANCED_TIMESTAMP_TEXT_PATTERN.test(line.romanLyric || '')) return true;

  return (line.words || []).some((word) => ENHANCED_TIMESTAMP_TEXT_PATTERN.test(word.word || ''));
}

export function mergeEnhancedLinesIntoBaseLines(
  enhancedLines: AmlLyricLine[],
  baseLines: AmlLyricLine[],
): AmlLyricLine[] {
  if (enhancedLines.length === 0) return baseLines;
  if (baseLines.length === 0) return enhancedLines;

  const enhancedGroups = new Map<number, AmlLyricLine[]>();
  for (const line of enhancedLines) {
    const existingGroup = enhancedGroups.get(line.startTime);
    if (existingGroup) {
      existingGroup.push(line);
    } else {
      enhancedGroups.set(line.startTime, [line]);
    }
  }

  const baseGroups = new Map<number, AmlLyricLine[]>();
  for (const line of baseLines) {
    const existingGroup = baseGroups.get(line.startTime);
    if (existingGroup) {
      existingGroup.push(line);
    } else {
      baseGroups.set(line.startTime, [line]);
    }
  }

  const times = new Set<number>([
    ...enhancedGroups.keys(),
    ...baseGroups.keys(),
  ]);

  return [...times]
    .sort((a, b) => a - b)
    .flatMap((startTime) => {
      const mergedGroup: AmlLyricLine[] = [];
      const enhancedGroup = enhancedGroups.get(startTime) ?? [];
      const baseGroup = baseGroups.get(startTime) ?? [];

      if (enhancedGroup.length > 0) {
        mergedGroup.push(...enhancedGroup);
        mergedGroup.push(...baseGroup.filter((line) => !lineContainsEnhancedMarkup(line)));
      } else {
        mergedGroup.push(...baseGroup);
      }

      return mergedGroup;
    });
}

function compareParserCandidates(left: ParserCandidate, right: ParserCandidate): number {
  const scoreDiff = scoreParsedLines(right.lines) - scoreParsedLines(left.lines);
  if (scoreDiff !== 0) return scoreDiff;

  const lineCountDiff = right.lines.length - left.lines.length;
  if (lineCountDiff !== 0) return lineCountDiff;

  return PARSER_PRIORITIES[right.source] - PARSER_PRIORITIES[left.source];
}

function toSafeMs(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.round(value);
}

function normalizeParsedWord(
  word: AmlLyricWord,
  fallbackStartMs: number,
  fallbackEndMs: number,
): ParsedWord {
  const startMs = toSafeMs(word.startTime, fallbackStartMs);
  const rawEndMs = toSafeMs(word.endTime, fallbackEndMs);
  const endMs = Math.max(startMs, rawEndMs);

  const romanText = sanitizeWordText(word.romanWord || '');

  return {
    text: sanitizeWordText(word.word || ''),
    startMs,
    endMs,
    romanText: romanText || undefined,
  };
}

function detectExplicitRole(text: string): {
  role?: ExplicitLineRole;
  text: string;
} {
  let normalizedText = sanitizeLineText(text);

  for (const marker of EXPLICIT_LINE_MARKERS) {
    if (!marker.pattern.test(normalizedText)) continue;
    normalizedText = sanitizeLineText(normalizedText.replace(marker.pattern, ''));
    return {
      role: marker.role,
      text: normalizedText,
    };
  }

  return {
    text: normalizedText,
  };
}

function prepareParsedLine(
  line: AmlLyricLine,
  sourceFormat: ParsedLineSourceFormat,
  sourceIndex: number,
): ParsedLine | null {
  const fallbackStartMs = toSafeMs(line.startTime, 0);
  const fallbackEndMs = Math.max(fallbackStartMs + 80, toSafeMs(line.endTime, fallbackStartMs + 500));

  const words = (line.words || [])
    .map((word) => normalizeParsedWord(word, fallbackStartMs, fallbackEndMs))
    .filter((word) => word.text.length > 0)
    .sort((left, right) => left.startMs - right.startMs);

  const wordsText = sanitizeLineText((line.words || []).map((word) => word.word || '').join(''));
  const rawText = wordsText || sanitizeLineText(words.map((word) => word.text).join(''));
  const detected = detectExplicitRole(rawText);
  const translatedText = sanitizeLineText(line.translatedLyric || '');
  const romanText = sanitizeLineText(line.romanLyric || '');

  const firstWordStartMs = words.length > 0 ? words[0].startMs : fallbackStartMs;
  const lastWordEndMs = words.length > 0 ? words[words.length - 1].endMs : fallbackEndMs;

  const startMs = toSafeMs(line.startTime, firstWordStartMs);
  const endMs = Math.max(startMs, toSafeMs(line.endTime, lastWordEndMs));

  if (!detected.text && !translatedText && !romanText && words.length === 0) return null;

  return {
    startMs,
    endMs,
    text: detected.text,
    words: words.length > 0 ? words : undefined,
    translatedText: translatedText || undefined,
    romanText: romanText || undefined,
    sourceFormat,
    sourceIndex,
    explicitRole: detected.role,
  };
}

function normalizeParsedLineEndTimes(lines: ParsedLine[]): ParsedLine[] {
  return lines.map((line, index) => {
    if (line.endMs !== undefined && line.endMs >= line.startMs) {
      return {
        ...line,
        endMs: line.endMs,
      };
    }

    const nextStartMs = lines[index + 1]?.startMs;
    const fallbackEndMs = nextStartMs !== undefined
      ? Math.max(line.startMs, nextStartMs)
      : line.startMs + 5000;

    return {
      ...line,
      endMs: fallbackEndMs,
    };
  });
}

function scoreParsedLines(lines: AmlLyricLine[]): number {
  return lines.reduce((score, line) => {
    const hasWords = (line.words || []).some((word) => sanitizeWordText(word.word || '').length > 0);
    const hasTranslation = sanitizeLineText(line.translatedLyric || '').length > 0;
    const hasRomaji = sanitizeLineText(line.romanLyric || '').length > 0;

    return score + (hasWords ? 2 : 0) + (hasTranslation ? 1 : 0) + (hasRomaji ? 1 : 0);
  }, 0);
}

async function parseWithBestCandidate(raw: string): Promise<ParserCandidate | null> {
  const {
    decryptQrcHex,
    parseEslrc,
    parseLrc,
    parseLys,
    parseQrc,
    parseTTML,
    parseYrc,
  } = await getAmlModule();
  const source = raw.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const normalizedEslrcSource = normalizeEslrcSource(source);
  const candidates: ParserCandidate[] = [];

  const collect = (candidateSource: ParserSource, parser: () => AmlLyricLine[]) => {
    try {
      const lines = parser();
      if (Array.isArray(lines) && lines.length > 0) {
        candidates.push({
          source: candidateSource,
          lines,
        });
      }
    } catch {
      // Try next parser.
    }
  };

  if (/<tt[\s>]/i.test(source)) {
    collect('ttml', () => parseTTML(source).lines);
  }

  const compactHex = source.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(compactHex) && compactHex.length > 64 && compactHex.length % 2 === 0) {
    collect('qrc', () => parseQrc(decryptQrcHex(compactHex)));
  }

  collect('yrc', () => parseYrc(source));
  collect('qrc', () => parseQrc(source));
  collect('lys', () => parseLys(source));
  collect('eslrc', () => parseEslrc(normalizedEslrcSource));
  collect('lrc', () => parseLrc(source));

  const enhancedLines = parseEnhancedLrc(source);
  if (enhancedLines.length > 0) {
    const baselineCandidate = [...candidates]
      .filter((candidate) => candidate.source !== 'enhanced_lrc')
      .sort(compareParserCandidates)[0];

    candidates.push({
      source: 'enhanced_lrc',
      lines: baselineCandidate
        ? mergeEnhancedLinesIntoBaseLines(enhancedLines, baselineCandidate.lines)
        : enhancedLines,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort(compareParserCandidates);
  return candidates[0];
}

export async function parseWithAml(raw: string): Promise<AmlLyricLine[]> {
  const candidate = await parseWithBestCandidate(raw);
  return candidate?.lines ?? [];
}

export async function prepareParsedLyrics(raw: string): Promise<ParsedLine[]> {
  const candidate = await parseWithBestCandidate(raw);
  if (!candidate) return [];

  const prepared = candidate.lines
    .map((line, index) => prepareParsedLine(line, candidate.source, index))
    .filter((line): line is ParsedLine => line !== null)
    .sort((left, right) => (
      (left.startMs - right.startMs)
      || (left.sourceIndex - right.sourceIndex)
      || ((left.endMs ?? left.startMs) - (right.endMs ?? right.startMs))
    ));

  return normalizeParsedLineEndTimes(prepared);
}

// ==================== lx-music-desktop lxlyric 转换 ====================

/**
 * 将毫秒数格式化为 mm:ss.xxx 时间戳字符串
 */
function msToTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * lx-music-desktop 的 lxlyric 格式转换为 Enhanced LRC 格式
 *
 * 支持两种 lxlyric 子格式：
 *
 * 1. 标准格式: [mm:ss.ms]<offset,duration>word<offset,duration>word...
 *    - offset: 相对于行首的偏移量（毫秒，正数）
 *    - duration: 该字的持续时间（毫秒，正数）
 *
 * 2. 酷我格式: [mm:ss.ms]word<a,b>word<a,b>...（或无行时间戳）
 *    - a, b 均可为负数
 *    - 词开始时间 = |(a + b) / (kuwoOffset * 2)|
 *    - 词结束时间 = |(a - b) / (kuwoOffset2 * 2)| + 词开始时间
 *    - kuwoOffset / kuwoOffset2 从 [kuwo:xxx] 标签解析（八进制），默认 1
 *    - 词开始时间为绝对时间，不需要加行时间戳
 *
 * Enhanced LRC 格式: [mm:ss.ms]<mm:ss.ms>word<mm:ss.ms>word...<mm:ss.ms>
 *   - 每个标记是绝对时间戳
 *   - 最后一个标记是行结束时间（无文字跟在后面）
 *
 * @param lxlyric lx-music-desktop 格式的逐字歌词
 * @returns Enhanced LRC 格式的逐字歌词，转换失败时返回空字符串
 */
export function convertLxLyricToEnhancedLrc(lxlyric: string): string {
  if (!lxlyric || !lxlyric.trim()) return '';

  const lines = lxlyric.split('\n');
  const result: string[] = [];
  let convertedCount = 0;

  // 词时间标记：支持正数（标准）和负数（酷我），以及可选的第三个参数
  const lxWordTimePattern = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;
  // 酷我 [kuwo:xxx] 标签
  const kuwoTagPattern = /^\[kuwo:\s*(\S+)\s*\]/i;

  // 先解析酷我 offset 参数
  let kuwoOffset = 1;
  let kuwoOffset2 = 1;
  let hasKuwoTag = false;
  for (const rawLine of lines) {
    const m = kuwoTagPattern.exec(rawLine.trim());
    if (m) {
      hasKuwoTag = true;
      const content = m[1].split('][')[0];
      const value = parseInt(content.trim(), 8) || 0;
      kuwoOffset = Math.floor(value / 10) || 1;
      kuwoOffset2 = value % 10 || 1;
      break;
    }
  }

  // 酷我格式是文件级格式（由 [kuwo:xxx] 标签标识），不是逐行格式。
  // 逐行判断 isKuwoFormat 会导致 b 值全为正数的行被误判为标准格式，
  // 用错误公式计算产生负数时间戳，该行逐字被丢弃 → "只有第一行逐字"。
  // 判断条件：有 [kuwo:xxx] 标签，或全文任意 <a,b> 的 a 或 b 为负数。
  const isKuwoSource = hasKuwoTag || (function checkKuwoValues() {
    const checkRe = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;
    for (const l of lines) {
      const times = [...l.matchAll(checkRe)];
      for (const wt of times) {
        if (parseInt(wt[1]) < 0 || parseInt(wt[2]) < 0) return true;
      }
    }
    return false;
  })();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 跳过 [kuwo:xxx] 标签行
    if (kuwoTagPattern.test(line)) continue;

    // 尝试匹配行时间戳 [mm:ss.ms]
    const lineMatch = LRC_LINE_TIMESTAMP_PATTERN.exec(line);
    const lineStartStr = lineMatch?.[1] ?? null;
    const lineStartMs = lineStartStr ? parseTimestampToMs(lineStartStr) : null;
    const body = lineMatch ? lineMatch[2] : line;

    // 全局重置正则 lastIndex（因为使用 matchAll）
    lxWordTimePattern.lastIndex = 0;
    const wordTimes = [...body.matchAll(lxWordTimePattern)];

    if (wordTimes.length === 0) {
      // 没有逐字时间标记，保留为普通 LRC 行（仅当有行时间戳时）
      if (lineStartStr && lineStartMs !== null) {
        result.push(line);
      }
      continue;
    }

    // 酷我格式需要绝对时间，标准格式需要行时间戳
    if (!isKuwoSource && lineStartMs === null) {
      // 标准格式但没有行时间戳，无法转换
      continue;
    }

    // 重建 body，将 <a,b> 转为 <mm:ss.ms> 绝对时间戳
    let convertedBody = '';
    let lastEnd = 0;
    let firstWordStartMs: number | null = null;
    let lastWordEndMs = 0;

    for (const wt of wordTimes) {
      const a = parseInt(wt[1]);
      const b = parseInt(wt[2]);

      let wordStartMs: number;
      let wordEndMs: number;

      if (isKuwoSource) {
        // 酷我格式（文件级）：a,b 可为负数，时间为绝对值
        wordStartMs = Math.abs(Math.floor((a + b) / (kuwoOffset * 2)));
        wordEndMs = Math.abs(Math.floor((a - b) / (kuwoOffset2 * 2))) + wordStartMs;
      } else {
        // 标准格式：offset 相对于行首，duration 持续时间
        wordStartMs = (lineStartMs as number) + a;
        wordEndMs = wordStartMs + b;
      }

      if (firstWordStartMs === null) {
        firstWordStartMs = wordStartMs;
      }

      const timestampStr = msToTimestamp(wordStartMs);

      // 添加标记之间的文字
      const textBefore = body.substring(lastEnd, wt.index);
      convertedBody += textBefore;

      // 添加转换后的时间戳
      convertedBody += `<${timestampStr}>`;

      lastEnd = (wt.index ?? 0) + wt[0].length;
      lastWordEndMs = wordEndMs;
    }

    // 添加最后一个标记后的文字
    convertedBody += body.substring(lastEnd);

    // 添加行结束时间标记（无文字跟在后面）
    const endTimeStr = msToTimestamp(lastWordEndMs);
    convertedBody += `<${endTimeStr}>`;

    // 确定行时间戳
    let finalLineStartStr: string;
    if (lineStartStr && lineStartMs !== null) {
      finalLineStartStr = lineStartStr;
    } else {
      // 无行时间戳：使用第一个词的绝对时间作为行时间戳
      finalLineStartStr = msToTimestamp(firstWordStartMs ?? 0);
    }

    result.push(`[${finalLineStartStr}]${convertedBody}`);
    convertedCount++;
  }

  // 如果没有任何行被成功转换，返回空字符串（让 buildLyricsRaw 回退到普通 LRC）
  if (convertedCount === 0) return '';

  return result.join('\n');
}

/**
 * 构建用于存储到 lyrics_raw 的歌词文本
 *
 * 逐字格式按优先级仅选用最高优先级的一种（不混用，避免后端不同格式解析器
 * 互相干扰导致解析失败或产生重复行）：
 * 1. yrc（网易云逐字格式）
 * 2. qrc（QQ 音乐逐字格式，可能为 hex 加密串）
 * 3. lxlyric（lx-music-desktop 逐字格式）— 转换为 Enhanced LRC
 * 4. eslrc（Baka 增强型逐字歌词）
 *
 * 仅当没有任何逐字格式时，才使用普通 LRC（lyric）作为主歌词。
 *
 * 翻译歌词（tlyric）和罗马音歌词（rlyric）作为附加行追加在末尾。
 * 后端会按时间戳将附加行聚类为 translation/romanization 轨道，
 * 与主歌词配对显示。
 *
 * @param lyric 普通歌词
 * @param tlyric 翻译歌词（可选）
 * @param rlyric 罗马音歌词（可选）
 * @param lxlyric 逐字歌词（可选，lx-music-desktop 格式）
 * @param yrc 逐字歌词（可选，网易云 YRC 格式）
 * @param qrc 逐字歌词（可选，QQ 音乐 QRC 格式，可为 hex 加密串）
 * @param eslrc 逐字歌词（可选，Baka ESLRC 格式）
 * @returns 用于存储到 lyrics_raw 的歌词文本
 */
export function buildLyricsRaw(
  lyric: string,
  tlyric?: string | null,
  rlyric?: string | null,
  lxlyric?: string | null,
  yrc?: string | null,
  qrc?: string | null,
  eslrc?: string | null,
): string {
  const parts: string[] = [];

  // 逐字格式按优先级仅选用最高优先级的一种
  // 不混用多种逐字格式，避免后端 YRC/QRC/ESLRC 解析器在混合内容上互相干扰
  let wordLevelContent: string | null = null;
  if (yrc && yrc.trim()) {
    wordLevelContent = yrc.trim();
  } else if (qrc && qrc.trim()) {
    wordLevelContent = qrc.trim();
  } else if (lxlyric && lxlyric.trim()) {
    const enhancedLrc = convertLxLyricToEnhancedLrc(lxlyric);
    if (enhancedLrc) {
      wordLevelContent = enhancedLrc;
    }
  } else if (eslrc && eslrc.trim()) {
    wordLevelContent = eslrc.trim();
  }

  if (wordLevelContent) {
    parts.push(wordLevelContent);
  } else if (lyric && lyric.trim()) {
    parts.push(lyric.trim());
  }

  if (parts.length === 0) {
    return '';
  }

  // 翻译和罗马音作为附加行追加（后端按时间戳聚类为 translation/romanization 轨道）
  if (tlyric && tlyric.trim()) {
    parts.push(tlyric.trim());
  }
  if (rlyric && rlyric.trim()) {
    parts.push(rlyric.trim());
  }

  return parts.join('\n');
}
