import { buildSemanticLines } from './classifier';
import { semanticLineToLyricLine } from './converters';
import type { LyricLine, LyricWord, ParsedLine, ParsedWord } from './types';

export interface PreparedLineLike {
  startMs: number;
  endMs: number;
  text: string;
  translation: string;
  romaji: string;
  words: LyricWord[];
  sourceIndex: number;
}

function toParsedWords(words: LyricWord[]): ParsedWord[] | undefined {
  if (!words || words.length === 0) return undefined;

  return words.map((word) => ({
    text: word.text,
    startMs: Math.round(word.start * 1000),
    endMs: Math.round(word.end * 1000),
    romanText: word.romaji || undefined,
  }));
}

export function mergePreparedLines(lines: PreparedLineLike[]): LyricLine[] {
  const parsedLines: ParsedLine[] = lines.map((line) => ({
    startMs: line.startMs,
    endMs: line.endMs,
    text: line.text,
    words: toParsedWords(line.words),
    translatedText: line.translation || undefined,
    romanText: line.romaji || undefined,
    sourceFormat: 'lrc',
    sourceIndex: line.sourceIndex,
  }));

  return buildSemanticLines(parsedLines).map(semanticLineToLyricLine);
}
