/**
 * 各歌词格式解析器共享的原语。
 *
 * 这里的扫描函数以"失败即抛出"的方式模拟解析组合子的错误传播，
 * 调用方用 try/catch 决定回退或终止。
 */

import type { AmlLyricLine } from '../types';

/** 所有格式的统一时间上限（999:99.999），超出部分被钳制。 */
export const TIME_CEILING_MS = 60039999;

/** 解析中途失败时抛出；外层据此跳过当前候选或当前行。 */
export class ScanError extends Error {
  constructor() {
    super('scan failed');
    this.name = 'ScanError';
  }
}

export function scanFail(): never {
  throw new ScanError();
}

/** 字面量：匹配 tag 开头并返回剩余部分。 */
export function scanTag(src: string, token: string): string {
  if (!src.startsWith(token)) scanFail();
  return src.slice(token.length);
}

/** 消费定长字符，不足即失败。 */
export function scanFixed(src: string, count: number): [string, string] {
  if (src.length < count) scanFail();
  return [src.slice(0, count), src.slice(count)];
}

/** 取首个 stop 出现位置之前的内容，且内容不得为空。 */
export function scanUpTo(src: string, stop: string): [string, string] {
  const idx = src.indexOf(stop);
  if (idx <= 0) scanFail();
  return [src.slice(0, idx), src.slice(idx + stop.length)];
}

/** 逐字符消费直到谓词命中；命中前无字符也算成功（允许空匹配）。 */
export function scanWhileNot(src: string, hit: (ch: string) => boolean): [string, string] {
  let i = 0;
  while (i < src.length && !hit(src[i])) i += 1;
  return [src.slice(0, i), src.slice(i)];
}

/** 同上，但至少要消费一个字符。 */
export function scanWhileNot1(src: string, hit: (ch: string) => boolean): [string, string] {
  const [taken, rest] = scanWhileNot(src, hit);
  if (taken.length === 0) scanFail();
  return [taken, rest];
}

/** 消费 1..max 个满足谓词的字符，少于 1 个即失败。 */
export function scanBoundedDigits(src: string, max: number): [string, string] {
  let i = 0;
  while (i < src.length && i < max && src[i] >= '0' && src[i] <= '9') i += 1;
  if (i === 0) scanFail();
  return [src.slice(0, i), src.slice(i)];
}

export function isDigitChar(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

const U64_MAX = 18446744073709551615n;

/**
 * 对标 Rust `u64::from_str`：仅接受可选正号加纯数字，越界视为失败。
 */
export function toU64(text: string): number | null {
  if (!/^\+?\d+$/.test(text)) return null;
  const value = BigInt(text);
  if (value > U64_MAX) return null;
  return Number(value);
}

export function toU64Or(text: string, fallback: number): number {
  return toU64(text) ?? fallback;
}

export function clampToCeiling(value: number): number {
  if (value < 0) return 0;
  if (value > TIME_CEILING_MS) return TIME_CEILING_MS;
  return value;
}

/**
 * 格式解析完成后的统一收尾：先按首词起始时间稳定排序
 * （无词的行视为最小），再把行级与词级时间钳制进合法区间。
 * 行的 start/end 直接取自首/末词时间，缺词行归零。
 */
export function finalizeLines(lines: AmlLyricLine[]): AmlLyricLine[] {
  const ordered = [...lines].sort((left, right) => {
    const a = left.words[0]?.startTime ?? null;
    const b = right.words[0]?.startTime ?? null;
    if (a === null && b === null) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a - b;
  });

  for (const line of ordered) {
    const first = line.words[0];
    const last = line.words[line.words.length - 1];
    line.startTime = clampToCeiling(first ? first.startTime : 0);
    line.endTime = clampToCeiling(last ? last.endTime : 0);
    for (const word of line.words) {
      word.startTime = clampToCeiling(word.startTime);
      word.endTime = clampToCeiling(word.endTime);
    }
  }

  return ordered;
}

/** 把整篇文本按行切分（容忍 CRLF），对标 Rust `str::lines()`。 */
export function splitSourceLines(src: string): string[] {
  return src.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * 复刻 is_not("\r\n") 的完整语义：遇到换行即截断；
 * 若开头就是换行（或输入为空），组合子失败后调用方会把整段原文当作内容。
 */
export function takeVisibleRun(src: string): string {
  if (src.length === 0 || src[0] === '\r' || src[0] === '\n') return src;
  const cut = src.search(/[\r\n]/);
  return cut === -1 ? src : src.slice(0, cut);
}

/**
 * 在 UTF-16 字符串上模拟 `char_indices` 的逐码点推进，
 * 保证词边界不会落在代理对中间。
 */
export function advanceCodePoint(src: string, index: number): number {
  const code = src.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff && index + 1 < src.length
    && src.charCodeAt(index + 1) >= 0xdc00 && src.charCodeAt(index + 1) <= 0xdfff
    ? index + 2
    : index + 1;
}

/**
 * QRC/LYS 风格的词扫描：从每个码点边界起尝试匹配"词时间元组"，
 * 首个成功位置即当前词的终点与下一段的起点，词文本为该边界之前的全部内容。
 */
export function scanWordByBoundary(
  src: string,
  readTuple: (s: string) => [number, number, string],
): { word: string; start: number; end: number; rest: string } {
  let index = 0;
  while (index < src.length) {
    try {
      const [start, duration, rest] = readTuple(src.slice(index));
      return { word: src.slice(0, index), start, end: start + duration, rest };
    } catch {
      index = advanceCodePoint(src, index);
    }
  }
  scanFail();
}

/** (起始,时长) 二元组 —— QRC 与 LYS 共用的词时间语法。 */
export function readStartDurationTuple(src: string): [number, number, string] {
  const afterParen = scanTag(src, '(');
  const [startText, afterStart] = scanUpTo(afterParen, ',');
  const [durationText, afterDuration] = scanUpTo(afterStart, ')');

  const start = toU64(startText);
  const duration = toU64(durationText);
  if (start === null || duration === null) scanFail();
  return [start, duration, afterDuration];
}

/** 行/词头部共用的 [起始,时长] 方括号元组；数值经 u64 校验后即被丢弃。 */
export function readBracketDurationTuple(src: string): string {
  let rest = scanTag(src, '[');
  const [startText, afterStart] = scanBoundedDigits(rest, Number.POSITIVE_INFINITY);
  if (toU64(startText) === null) scanFail();
  rest = scanTag(afterStart, ',');
  const [durationText, afterDuration] = scanBoundedDigits(rest, Number.POSITIVE_INFINITY);
  if (toU64(durationText) === null) scanFail();
  return scanTag(afterDuration, ']');
}
