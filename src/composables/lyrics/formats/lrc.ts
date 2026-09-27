/**
 * LRC 与 ESLyric 逐词 LRC（ESLRC）解析。
 *
 * 行内时间戳形如 [mm:ss.xxx]：分钟可任意位数，秒 1 位以上，
 * 毫秒段为 1~3 位数字且不可省略；秒后必须跟随 ':' 或 '.'。
 */

import type { AmlLyricLine, AmlLyricWord } from '../types';

import {
  scanBoundedDigits,
  scanFail,
  scanFixed,
  scanTag,
  scanUpTo,
  scanWhileNot1,
  splitSourceLines,
  takeVisibleRun,
  toU64,
  toU64Or,
  finalizeLines,
} from './shared';

export function parseLrcTimestamp(src: string): [number, string] {
  let rest = scanTag(src, '[');

  const [minuteText, afterColon] = scanUpTo(rest, ':');
  const minutes = toU64(minuteText);
  if (minutes === null) scanFail();

  const [secondText, afterSecond] = scanWhileNot1(afterColon, (ch) => ch === ':' || ch === '.');
  const seconds = toU64(secondText);
  if (seconds === null) scanFail();

  const [, afterSeparator] = scanFixed(afterSecond, 1);
  const [millisText, afterMillis] = scanBoundedDigits(afterSeparator, 3);
  const millisScale = millisText.length === 1 ? 100 : millisText.length === 2 ? 10 : 1;

  rest = scanTag(afterMillis, ']');

  const time = minutes * 60_000 + seconds * 1_000 + toU64Or(millisText, 0) * millisScale;
  return [time, rest];
}

/** 单行 → 每个行首时间戳生成一行，整行文本作为唯一的"词"。 */
function parseLrcLine(line: string): AmlLyricLine[] | null {
  const times: number[] = [];
  let rest = line;
  for (;;) {
    try {
      const [time, remaining] = parseLrcTimestamp(rest);
      times.push(time);
      rest = remaining;
    } catch {
      break;
    }
  }
  if (times.length === 0) return null;

  const text = takeVisibleRun(rest);

  return times.map((time) => ({
    words: [{ startTime: time, endTime: 0, word: text }],
    isBG: false,
    isDuet: false,
    startTime: time,
    endTime: 0,
    translatedLyric: '',
    romanLyric: '',
  }));
}

export function parseLrcLines(src: string): AmlLyricLine[] {
  const collected: AmlLyricLine[] = [];
  for (const line of splitSourceLines(src)) {
    const parsed = parseLrcLine(line);
    if (parsed) collected.push(...parsed);
  }

  collected.sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));

  // 逆序回填：每行的结束时间取下一行的起始时间，末行取上限哨兵。
  let nextStart = Number.POSITIVE_INFINITY;
  for (let i = collected.length - 1; i >= 0; i -= 1) {
    const line = collected[i];
    line.endTime = nextStart;
    if (line.words.length > 0) line.words[0].endTime = nextStart;
    nextStart = line.startTime ?? 0;
  }

  return finalizeLines(collected);
}

/** ESLRC：单词文本夹在相邻时间戳之间，行必须以时间戳收尾。 */
function parseEslrcLine(line: string): AmlLyricLine | null {
  const [firstTime, afterFirst] = parseLrcTimestamp(line);
  let rest = afterFirst;
  let wordStart = firstTime;

  const words: AmlLyricWord[] = [];
  while (rest.trim().length > 0) {
    const [text, afterText] = scanUpTo(rest, '[');
    const [endTime, afterEnd] = parseLrcTimestamp(`[${afterText}`);
    words.push({ startTime: wordStart, endTime, word: text });
    rest = afterEnd;
    wordStart = endTime;
  }

  return { words, isBG: false, isDuet: false, startTime: firstTime, endTime: 0, translatedLyric: '', romanLyric: '' };
}

export function parseEslrcLines(src: string): AmlLyricLine[] {
  const collected: AmlLyricLine[] = [];
  for (const rawLine of splitSourceLines(src)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      const parsed = parseEslrcLine(line);
      if (parsed) collected.push(parsed);
    } catch {
      // 当前行不符合 ESLRC 语法，整行丢弃。
    }
  }
  return finalizeLines(collected);
}
