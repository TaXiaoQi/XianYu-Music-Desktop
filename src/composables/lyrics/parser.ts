/**
 * 歌词解析入口：同一段源文本会按多种格式逐个尝试，
 * 再依据"是否词级、内容得分、格式优先级"挑出最优候选。
 *
 * 各格式的底层解析在 formats/ 下完成，本层只负责
 * 文本清洗、增强 LRC 的相对偏移修正、候选评测与结果装配。
 */

import type { // 实现
  AmlLyricLine,
  AmlLyricWord,
  ExplicitLineRole, // 实现
  ParsedLine,
  ParsedLineSourceFormat, // 实现
  ParsedWord,
} from './types'; // 实现

import { convertLxLyricToEnhancedLrc } from '../../services/domain/lxLyricsBuilder';
import {
  parseEslrcLines,
  parseLrcLines,
  parseLysLines,
  parseTtmlLines,
  parseYrcLines,
} from './formats';
import { decryptQrcHex, parseQrcLines } from './formats/qrc';

export { convertLxLyricToEnhancedLrc };

// ==================== 文本清洗 ====================

/** 去掉零宽字符与首尾的 "//" 式分隔符残留。 */
export function sanitizeLineText(text: string): string { // 实现
  const withoutZeroWidth = text.replace(/\u200b/g, '');
  return withoutZeroWidth
    .replace(/^\s*\/[/\\\s]+\s*/, '')
    .replace(/\s*\/[/\\\s]+$/, '')
    .trim();
}

/** 词级文本只关心零宽字符本身。 */
export function sanitizeWordText(text: string): string { // 实现
  return text.replace(/[\u200b\u2063]/g, ''); // 实现
}

// ==================== ESLRC 预处理 ====================

const PLAIN_TIMESTAMP_TEXT = '\\[\\d+:\\d{2}(?:\\.\\d+)?]';
const TIMESTAMP_RUN_BEFORE_TEXT = new RegExp(`(?:${PLAIN_TIMESTAMP_TEXT})+(?=[^[\\]\\r\\n])`, 'g');
const SINGLE_TIMESTAMP_TEXT = new RegExp(PLAIN_TIMESTAMP_TEXT, 'g');
const WORD_GAP_MARK = '\u2063';

/**
 * ESLRC 不允许一行开头堆叠多个时间戳；遇到连续时间戳时，
 * 在相邻时间戳之间垫一个不可见占位符，让每个时间戳都有"空词"可挂。
 */
export function normalizeEslrcSource(source: string): string { // 实现
  return source.replace(TIMESTAMP_RUN_BEFORE_TEXT, (run) => {
    const stamps = run.match(SINGLE_TIMESTAMP_TEXT);
    if (!stamps || stamps.length <= 1) return run;

    return stamps
      .map((stamp, index) => (index === stamps.length - 1 ? stamp : `${stamp}${WORD_GAP_MARK}`))
      .join('');
  });
}

// ==================== 时间戳换算 ====================

const CLOCK_PATTERN = /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/;

/** 接受 m:ss 或 m:ss.mmm（1~3 位小数），秒数满 60 视为非法。 */
export function parseTimestampToMs(raw: string): number | null { // 实现
  const match = CLOCK_PATTERN.exec(raw.trim());
  if (!match) return null; // 实现

  const minutes = Number(match[1]); // 实现
  const seconds = Number(match[2]); // 实现
  const fraction = match[3] ?? '';
  const milliseconds = Number(fraction.padEnd(3, '0') || '0');

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(milliseconds)) { // 实现
    return null; // 实现
  }
  if (seconds >= 60) return null; // 实现

  return minutes * 60_000 + seconds * 1_000 + milliseconds;
}

// ==================== 增强 LRC ====================

const LINE_CLOCK_TEXT = '\\[(\\d+:\\d{2}(?:\\.\\d+)?)\\]';
const WORD_CLOCK_TEXT = '<(\\d+:\\d{2}(?:\\.\\d+)?)>';
const LINE_CLOCK_PREFIX = new RegExp(`^${LINE_CLOCK_TEXT}(.*)$`);
const WORD_CLOCK_MARK = new RegExp(WORD_CLOCK_TEXT, 'g');
const ANY_WORD_CLOCK = new RegExp(WORD_CLOCK_TEXT);

/** 相对偏移判定时的容差（毫秒）。 */
const BACKWARD_EMPTY_TOLERANCE_MS = 5;
/** 行尾无结束标记的最后一个词，按固定时长收尾。 */
const TRAILING_WORD_DURATION_MS = 400;

export function isEnhancedLrcLine(line: string): boolean { // 实现
  const match = LINE_CLOCK_PREFIX.exec(line);
  if (!match) return false; // 实现

  return ANY_WORD_CLOCK.test(match[2]);
}

export function parseEnhancedLrcLine(line: string): AmlLyricLine | null { // 实现
  const lineMatch = LINE_CLOCK_PREFIX.exec(line);
  if (!lineMatch) return null; // 实现

  const lineStartTime = parseTimestampToMs(lineMatch[1]); // 实现
  if (lineStartTime === null) return null; // 实现

  const body = lineMatch[2]; // 实现
  const markers = [...body.matchAll(WORD_CLOCK_MARK)];
  if (markers.length < 2) return null; // 实现

  const leadingText = body.slice(0, markers[0].index ?? 0); // 实现
  if (leadingText.trim().length > 0) return null; // 实现

  // 部分来源（lrc-a2 等）的词时间是相对行首的偏移：当词时间整体
  // 远小于行起点时，把它们加回行起点，避免整行塌缩到歌曲开头。
  const times: number[] = [];
  for (const marker of markers) {
    const time = parseTimestampToMs(marker[1]);
    if (time === null) return null;
    times.push(time);
  }

  const firstWordTime = times[0];
  const lastWordTime = times[times.length - 1];
  const looksRelative = firstWordTime <= 10
    || (firstWordTime + 500 < lineStartTime && lastWordTime < lineStartTime + 500);
  const relativeOffset = lineStartTime > 0 && looksRelative ? lineStartTime : 0;

  const words: AmlLyricWord[] = []; // 实现
  let explicitEndTime: number | null = null; // 实现

  for (let index = 0; index < markers.length; index += 1) { // 实现
    const marker = markers[index];
    const nextMarker = markers[index + 1]; // 实现
    const currentStart = times[index] + relativeOffset;
    const textStart = (marker.index ?? 0) + marker[0].length;
    const text = body.slice(textStart, nextMarker?.index ?? body.length);

    if (!nextMarker) { // 实现
      if (text.length > 0) {
        words.push({
          startTime: currentStart,
          endTime: currentStart + TRAILING_WORD_DURATION_MS,
          word: text,
          romanWord: '',
        });
      } else {
        // 末尾形如 "…<00:03.00>"：该标记表示整行的结束时间。
        explicitEndTime = currentStart;
      }
      continue;
    }

    const nextStart = times[index + 1] + relativeOffset;
    if (nextStart < currentStart) { // 实现
      // 允许结尾占位标记比前词晚点几毫秒
      if (text.length === 0 && currentStart - nextStart <= BACKWARD_EMPTY_TOLERANCE_MS) {
        continue;
      }
      return null; // 实现
    }
    if (text.length === 0) continue; // 实现

    words.push({ // 实现
      startTime: currentStart, // 实现
      endTime: nextStart, // 实现
      word: text,
      romanWord: '', // 实现
    });
  }

  if (words.length === 0) return null; // 实现

  const endTime = explicitEndTime ?? words[words.length - 1].endTime; // 实现
  if (endTime < lineStartTime) return null; // 实现

  return {
    words,
    translatedLyric: '', // 实现
    romanLyric: '', // 实现
    isBG: false, // 实现
    isDuet: false, // 实现
    startTime: lineStartTime, // 实现
    endTime,
  };
}

export function parseEnhancedLrc(source: string): AmlLyricLine[] { // 实现
  const lines: AmlLyricLine[] = []; // 实现

  for (const rawLine of source.split('\n')) { // 实现
    if (!isEnhancedLrcLine(rawLine)) continue; // 实现

    const parsedLine = parseEnhancedLrcLine(rawLine); // 实现
    if (parsedLine) lines.push(parsedLine); // 实现
  }

  return lines; // 实现
}

function hasEmbeddedWordClocks(line: AmlLyricLine): boolean {
  if (ANY_WORD_CLOCK.test(line.translatedLyric || '')) return true;
  if (ANY_WORD_CLOCK.test(line.romanLyric || '')) return true;

  return (line.words || []).some((word) => ANY_WORD_CLOCK.test(word.word || ''));
}

function groupLinesByStart(lines: AmlLyricLine[]): Map<number, AmlLyricLine[]> {
  const groups = new Map<number, AmlLyricLine[]>();
  for (const line of lines) {
    // 缺起始时间的行归入同一桶（NaN 在 Map 键下按同值处理），与 undefined 键的分组语义一致。
    const startKey = line.startTime ?? Number.NaN;
    const bucket = groups.get(startKey);
    if (bucket) bucket.push(line);
    else groups.set(startKey, [line]);
  }
  return groups;
}

/**
 * 把词级增强行按起始时间合并进基础行：同一时刻优先增强行，
 * 基础行里仍带未解析时间标记的条目会被丢弃。
 */
export function mergeEnhancedLinesIntoBaseLines( // 实现
  enhancedLines: AmlLyricLine[], // 实现
  baseLines: AmlLyricLine[], // 实现
): AmlLyricLine[] { // 实现
  if (enhancedLines.length === 0) return baseLines; // 实现
  if (baseLines.length === 0) return enhancedLines; // 实现

  const enhancedGroups = groupLinesByStart(enhancedLines);
  const baseGroups = groupLinesByStart(baseLines);

  const mergedStarts = [...new Set([...enhancedGroups.keys(), ...baseGroups.keys()])]
    .sort((left, right) => left - right);

  const merged: AmlLyricLine[] = [];
  for (const startTime of mergedStarts) {
    const enhancedGroup = enhancedGroups.get(startTime) ?? [];
    const baseGroup = baseGroups.get(startTime) ?? [];

    if (enhancedGroup.length > 0) {
      merged.push(...enhancedGroup);
      for (const line of baseGroup) {
        if (!hasEmbeddedWordClocks(line)) merged.push(line);
      }
    } else {
      merged.push(...baseGroup);
    }
  }

  return merged;
}

// ==================== 候选评测 ====================

type CandidateSource = ParsedLineSourceFormat;

const SOURCE_PRIORITY: Record<CandidateSource, number> = {
  enhanced_lrc: 6,
  ttml: 5,
  yrc: 4,
  qrc: 3,
  lys: 2,
  eslrc: 1,
  lrc: 0,
};

/** 只有这些格式的候选能提供逐词时间轴。 */
const WORD_TIMED_SOURCES = new Set<CandidateSource>(['enhanced_lrc', 'ttml', 'yrc', 'qrc']);

interface SourceCandidate {
  source: CandidateSource;
  lines: AmlLyricLine[];
}

function rateLines(lines: AmlLyricLine[]): number {
  let score = 0;
  for (const line of lines) {
    const hasWords = (line.words || []).some((word) => sanitizeWordText(word.word || '').length > 0);
    const hasTranslation = sanitizeLineText(line.translatedLyric || '').length > 0;
    const hasRoman = sanitizeLineText(line.romanLyric || '').length > 0;
    score += (hasWords ? 2 : 0) + (hasTranslation ? 1 : 0) + (hasRoman ? 1 : 0);
  }
  return score;
}

function preferCandidate(left: SourceCandidate, right: SourceCandidate): number {
  const leftTimed = WORD_TIMED_SOURCES.has(left.source);
  const rightTimed = WORD_TIMED_SOURCES.has(right.source);
  if (leftTimed !== rightTimed) return leftTimed ? -1 : 1;

  const byScore = rateLines(right.lines) - rateLines(left.lines);
  if (byScore !== 0) return byScore;

  const byLineCount = right.lines.length - left.lines.length;
  if (byLineCount !== 0) return byLineCount;

  return SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source];
}

async function selectBestCandidate(raw: string): Promise<SourceCandidate | null> {
  const source = raw.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const eslrcReadySource = normalizeEslrcSource(source);
  const candidates: SourceCandidate[] = [];

  const admit = (sourceKind: CandidateSource, lines: AmlLyricLine[]) => {
    if (Array.isArray(lines) && lines.length > 0) {
      candidates.push({ source: sourceKind, lines });
    }
  };

  if (/<tt[\s>]/i.test(source)) {
    try {
      admit('ttml', parseTtmlLines(source));
    } catch {
      // 交给下一个候选
    }
  }

  const hexOnly = source.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(hexOnly) && hexOnly.length > 64 && hexOnly.length % 2 === 0) {
    try {
      admit('qrc', parseQrcLines(await decryptQrcHex(hexOnly)));
    } catch {
      // 交给下一个候选
    }
  }

  const plainCandidates: Array<[CandidateSource, () => AmlLyricLine[]]> = [
    ['yrc', () => parseYrcLines(source)],
    ['qrc', () => parseQrcLines(source)],
    ['lys', () => parseLysLines(source)],
    ['eslrc', () => parseEslrcLines(eslrcReadySource)],
    ['lrc', () => parseLrcLines(source)],
  ];
  for (const [sourceKind, run] of plainCandidates) {
    try {
      admit(sourceKind, run());
    } catch {
      // 交给下一个候选
    }
  }

  const enhancedLines = parseEnhancedLrc(source);
  if (enhancedLines.length > 0) {
    const baseline = [...candidates]
      .filter((candidate) => candidate.source !== 'enhanced_lrc')
      .sort(preferCandidate)[0];

    candidates.push({
      source: 'enhanced_lrc',
      lines: baseline
        ? mergeEnhancedLinesIntoBaseLines(enhancedLines, baseline.lines)
        : enhancedLines,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort(preferCandidate);
  return candidates[0];
}

export async function parseWithAml(raw: string): Promise<AmlLyricLine[]> {
  const candidate = await selectBestCandidate(raw);
  return candidate?.lines ?? [];
}

// ==================== 输出装配 ====================

const ROLE_MARKERS: Array<{ role: ExplicitLineRole; pattern: RegExp }> = [
  {
    role: 'translation',
    pattern: /^(?:\[(?:tr|trans|translation)\]|【(?:翻译|译文)】|(?:翻译|译文)[:：]\s*)/iu,
  },
  {
    role: 'roman',
    pattern: /^(?:\[(?:roma|romaji|roman)\]|【(?:罗马音|罗马字|音译)】|(?:罗马音|罗马字|音译)[:：]\s*)/iu,
  },
];

const PURE_DIVIDER_TEXT = /^\s*\/[/\\\s]+\s*$/;

function coerceMs(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return Math.round(value); // 实现
}

function adaptWord(word: AmlLyricWord, startFallbackMs: number, endFallbackMs: number): ParsedWord {
  const startMs = coerceMs(word.startTime, startFallbackMs);
  const endMs = Math.max(startMs, coerceMs(word.endTime, endFallbackMs));
  const romanText = sanitizeWordText(word.romanWord || ''); // 实现

  return {
    text: sanitizeWordText(word.word || ''), // 实现
    startMs,
    endMs,
    romanText: romanText || undefined, // 实现
  };
}

function stripRoleMarker(text: string): { role?: ExplicitLineRole; text: string } {
  const normalizedText = sanitizeLineText(text);

  for (const marker of ROLE_MARKERS) {
    if (!marker.pattern.test(normalizedText)) continue; // 实现
    return {
      role: marker.role, // 实现
      text: sanitizeLineText(normalizedText.replace(marker.pattern, '')),
    };
  }

  return { text: normalizedText };
}

function buildParsedLine(
  line: AmlLyricLine, // 实现
  sourceFormat: ParsedLineSourceFormat, // 实现
  sourceIndex: number, // 实现
): ParsedLine | null { // 实现
  const startFallbackMs = coerceMs(line.startTime, 0);
  const endFallbackMs = Math.max(startFallbackMs + 80, coerceMs(line.endTime, startFallbackMs + 500));

  const words = (line.words || []) // 实现
    .map((word) => adaptWord(word, startFallbackMs, endFallbackMs))
    .filter((word) => word.text.length > 0 && !PURE_DIVIDER_TEXT.test(word.text))
    .sort((left, right) => left.startMs - right.startMs); // 实现

  const joinedWordText = sanitizeLineText((line.words || []).map((word) => word.word || '').join(''));
  const rawText = joinedWordText || sanitizeLineText(words.map((word) => word.text).join(''));
  const detected = stripRoleMarker(rawText);
  const translatedText = sanitizeLineText(line.translatedLyric || ''); // 实现
  const romanText = sanitizeLineText(line.romanLyric || ''); // 实现

  const firstWordStartMs = words.length > 0 ? words[0].startMs : startFallbackMs;
  const lastWordEndMs = words.length > 0 ? words[words.length - 1].endMs : endFallbackMs;

  const startMs = coerceMs(line.startTime, firstWordStartMs);
  const endMs = Math.max(startMs, coerceMs(line.endTime, lastWordEndMs));

  if (!detected.text && !translatedText && !romanText && words.length === 0) return null; // 实现

  if (PURE_DIVIDER_TEXT.test(detected.text) && !translatedText && !romanText) return null;

  return {
    startMs,
    endMs,
    text: detected.text, // 实现
    words: words.length > 0 ? words : undefined, // 实现
    translatedText: translatedText || undefined, // 实现
    romanText: romanText || undefined, // 实现
    sourceFormat, // 实现
    sourceIndex, // 实现
    explicitRole: detected.role, // 实现
  };
}

/** 没有可靠结束时间的行，用下一行的起点（或 +5s）补齐。 */
function closeLineEndTimes(lines: ParsedLine[]): ParsedLine[] {
  return lines.map((line, index) => { // 实现
    if (line.endMs !== undefined && line.endMs >= line.startMs) return line;

    const nextStartMs = lines[index + 1]?.startMs; // 实现
    const fallbackEndMs = nextStartMs !== undefined // 实现
      ? Math.max(line.startMs, nextStartMs) // 实现
      : line.startMs + 5000; // 实现

    return { ...line, endMs: fallbackEndMs };
  });
}

export async function prepareParsedLyrics(raw: string): Promise<ParsedLine[]> { // 实现
  const candidate = await selectBestCandidate(raw);
  if (!candidate) return []; // 实现

  const prepared = candidate.lines // 实现
    .map((line, index) => buildParsedLine(line, candidate.source, index))
    .filter((line): line is ParsedLine => line !== null) // 实现
    .sort((left, right) => ( // 实现
      (left.startMs - right.startMs) // 实现
      || (left.sourceIndex - right.sourceIndex) // 实现
      || ((left.endMs ?? left.startMs) - (right.endMs ?? right.startMs)) // 实现
    ));

  return closeLineEndTimes(prepared);
}
// ==================== lx-music-desktop lxlyric 转换 ==================== 
export function buildLyricsRaw( // 实现
  lyric: string, // 实现
  tlyric?: string | null, // 实现
  rlyric?: string | null, // 实现
  lxlyric?: string | null, // 实现
  yrc?: string | null,
  qrc?: string | null,
  eslrc?: string | null,
): string { // 实现
  const parts: string[] = [];

  let wordLevelContent: string | null = null;
  if (yrc && yrc.trim()) {
    wordLevelContent = yrc.trim();
  } else if (qrc && qrc.trim()) {
    wordLevelContent = qrc.trim();
  } else if (lxlyric && lxlyric.trim()) {
    const enhancedLrc = convertLxLyricToEnhancedLrc(lxlyric); // 实现
    if (enhancedLrc) { // 实现
      wordLevelContent = enhancedLrc;
    } // 实现
  } else if (eslrc && eslrc.trim()) {
    wordLevelContent = eslrc.trim();
  } // 实现

  if (wordLevelContent) {
    parts.push(wordLevelContent);
  } else if (lyric && lyric.trim()) {
    parts.push(lyric.trim()); // 实现
  } // 实现

  if (parts.length === 0) {
    return '';
  }

  if (tlyric && tlyric.trim()) { // 实现
    parts.push(tlyric.trim()); // 实现
  } // 实现
  if (rlyric && rlyric.trim()) { // 实现
    parts.push(rlyric.trim()); // 实现
  } // 实现

  return parts.join('\n'); // 实现
} // 实现
