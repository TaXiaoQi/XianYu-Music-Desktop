/**
 * 桥接层：把播放器内核的秒制词时间轴（PreparedLine）
 * 翻译成本子系统的毫秒制 ParsedLine，再走语义归并管线输出展示行。
 */

import type { LyricLine, LyricWord, ParsedLine, ParsedWord } from './types';
import { buildSemanticLines } from './classifier';
import { semanticLineToLyricLine } from './converters';

/** 播放器内核传来的行数据形状：行时间毫秒、词时间秒。 */
export interface PreparedLineLike {
  /** 行起点（毫秒）。 */ startMs: number;
  /** 行终点（毫秒）。 */ endMs: number;
  /** 行原文。 */ text: string;
  /** 翻译行文本，空串表示没有。 */ translation: string;
  /** 罗马音行文本，空串表示没有。 */ romaji: string;
  /** 逐词时间轴（秒制）。 */ words: LyricWord[];
  /** 在源歌词中的行序号，供同刻分组使用。 */ sourceIndex: number;
}

/** 秒 → 毫秒，四舍五入到整数。 */
const secondsToMs = (seconds: number): number => Math.round(seconds * 1000);

/** 单词换算：秒制起止换成毫秒，罗马音空串视为缺失。 */
function scaleWordTiming(word: LyricWord): ParsedWord {
  return {
    text: word.text,
    startMs: secondsToMs(word.start),
    endMs: secondsToMs(word.end),
    romanText: word.romaji === '' ? undefined : word.romaji,
  };
}

/** 空词表视为“无逐词时间轴”。 */
function collectParsedWords(words: LyricWord[] | undefined): ParsedWord[] | undefined {
  if (!words?.length) {
    return undefined;
  }
  return words.map(scaleWordTiming);
}

/** 空串文本视为“无副行”。 */
const optionalText = (value: string): string | undefined => (value === '' ? undefined : value);

/** 内核行 → 模型行：仅做单位换算与字段命名对齐，不改语义。 */
function toParsedLine(row: PreparedLineLike): ParsedLine {
  return {
    startMs: row.startMs,
    endMs: row.endMs,
    text: row.text,
    words: collectParsedWords(row.words),
    translatedText: optionalText(row.translation),
    romanText: optionalText(row.romaji),
    sourceFormat: 'lrc',
    sourceIndex: row.sourceIndex,
  };
}

/**
 * 归并内核 PreparedLine：同刻/漂移行组按脚本角色定主行、罗马音、翻译，
 * 最终输出播放器可直接消费的展示行。
 */
export function mergePreparedLines(lines: PreparedLineLike[]): LyricLine[] {
  const parsedLines: ParsedLine[] = lines.map((row) => toParsedLine(row));
  return buildSemanticLines(parsedLines).map((one) => semanticLineToLyricLine(one));
}
