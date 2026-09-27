/**
 * YRC（网易云逐词格式）解析。
 *
 * 行头 [起始,时长] 经 u64 校验后即被丢弃，行时间由词回填；
 * 每个词是 (起始,时长,0) 三元组接一段文本，文本可为空且止于下一个 '(' 或行尾。
 */

import type { AmlLyricLine, AmlLyricWord } from '../types';

import {
  finalizeLines,
  readBracketDurationTuple,
  scanFail,
  scanTag,
  scanUpTo,
  scanWhileNot,
  splitSourceLines,
  takeVisibleRun,
  toU64,
} from './shared';

function readYrcWordTime(src: string): [number, number, string] {
  let rest = scanTag(src, '(');
  const [startText, afterStart] = scanUpTo(rest, ',');
  const [durationText, afterDuration] = scanUpTo(afterStart, ',');
  rest = scanTag(afterDuration, '0)');

  const start = toU64(startText);
  const duration = toU64(durationText);
  if (start === null || duration === null) scanFail();
  return [start, duration, rest];
}

function readYrcWords(src: string): AmlLyricWord[] {
  const words: AmlLyricWord[] = [];
  let rest = src;

  for (;;) {
    try {
      const [start, duration, afterTime] = readYrcWordTime(rest);
      const [text, afterText] = scanWhileNot(
        afterTime,
        (ch) => ch === '(' || ch === '\n' || ch === '\r',
      );
      words.push({ startTime: start, endTime: start + duration, word: text });
      rest = afterText;
    } catch {
      break;
    }
  }

  return words;
}

function readYrcLine(line: string): AmlLyricLine {
  const rest = readBracketDurationTuple(line);
  return {
    words: readYrcWords(takeVisibleRun(rest)),
    isBG: false,
    isDuet: false,
    startTime: 0,
    endTime: 0,
    translatedLyric: '',
    romanLyric: '',
  };
}

export function parseYrcLines(src: string): AmlLyricLine[] {
  const collected: AmlLyricLine[] = [];
  for (const line of splitSourceLines(src)) {
    try {
      collected.push(readYrcLine(line));
    } catch {
      // 行头不是合法的 [起始,时长]，整行丢弃。
    }
  }
  return finalizeLines(collected);
}
