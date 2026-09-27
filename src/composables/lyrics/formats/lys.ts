/**
 * Lyricify Syllable（LYS）解析。
 *
 * 文本格式（非 JSON）：行头为 [属性序号] 决定背景/对唱标记，
 * 词时间为 (起始,时长) 二元组，词文本为元组之前的全部字符。
 */

import type { AmlLyricLine, AmlLyricWord } from '../types';

import {
  finalizeLines,
  readStartDurationTuple,
  scanBoundedDigits,
  scanTag,
  scanWordByBoundary,
  splitSourceLines,
  takeVisibleRun,
} from './shared';

/** 属性序号不是 0-255 时抛出：与上游 panic 对应，整篇候选作废。 */
class PropertyOutOfRangeError extends Error {
  constructor() {
    super('lys property out of range');
    this.name = 'PropertyOutOfRangeError';
  }
}

/** 属性序号 → [是否背景, 是否对唱]。 */
function resolveLineProperty(src: string): [{ isBG: boolean; isDuet: boolean }, string] {
  let rest = scanTag(src, '[');
  const [digits, afterDigits] = scanBoundedDigits(rest, Number.POSITIVE_INFINITY);
  rest = scanTag(afterDigits, ']');

  const value = Number(digits);
  if (!Number.isFinite(value) || value > 255) throw new PropertyOutOfRangeError();

  return [
    {
      isBG: value === 6 || value === 7,
      isDuet: value === 2 || value === 5 || value === 8,
    },
    rest,
  ];
}

function readLysWords(src: string): AmlLyricWord[] {
  const words: AmlLyricWord[] = [];
  let rest = src;

  for (;;) {
    try {
      const found = scanWordByBoundary(rest, readStartDurationTuple);
      words.push({ startTime: found.start, endTime: found.end, word: found.word });
      rest = found.rest;
    } catch {
      break;
    }
  }

  return words;
}

function readLysLine(line: string): AmlLyricLine {
  const [property, rest] = resolveLineProperty(line);
  return {
    words: readLysWords(takeVisibleRun(rest)),
    isBG: property.isBG,
    isDuet: property.isDuet,
    startTime: 0,
    endTime: 0,
    translatedLyric: '',
    romanLyric: '',
  };
}

export function parseLysLines(src: string): AmlLyricLine[] {
  const collected: AmlLyricLine[] = [];
  for (const line of splitSourceLines(src)) {
    try {
      collected.push(readLysLine(line));
    } catch (error) {
      // 普通语法失败仅丢弃该行；属性越界则放弃整篇。
      if (error instanceof PropertyOutOfRangeError) throw error;
    }
  }
  return finalizeLines(collected);
}
