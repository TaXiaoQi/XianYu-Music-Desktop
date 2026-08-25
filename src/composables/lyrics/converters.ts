import type { LyricLine as CoreAmlLyricLine } from '@applemusic-like-lyrics/core';

import type {
  CurrentLyricDisplayLine,
  DisplayFragment,
  LyricLine,
  LyricWord,
  RenderLine,
  SemanticLine,
} from './types';

function toMs(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000));
}

const MAX_AML_LINE_LEAD_IN_MS = 300;
const AML_LINE_LEAD_IN_RATIO = 0.25;
const MIN_AML_LINE_DURATION_MS = 40;
const AML_ROMAJI_WORD_SEPARATOR = '\u00a0';

function getAdaptiveAmlLineLeadInMs(currentStartTime: number, nextStartTime: number): number {
  const gap = nextStartTime - currentStartTime;
  if (gap <= 0) return 0;

  return Math.min(MAX_AML_LINE_LEAD_IN_MS, Math.round(gap * AML_LINE_LEAD_IN_RATIO));
}

function createPlainFragment(text: string): DisplayFragment[] | undefined {
  return text ? [{ text }] : undefined;
}

function createFragmentsFromWords(words: SemanticLine['mainWords']): DisplayFragment[] | undefined {
  if (!words || words.length === 0) return undefined;

  return words.map((word) => ({
    text: word.text,
    startMs: word.startMs,
    endMs: word.endMs,
  }));
}

function createRomanFragments(line: SemanticLine): DisplayFragment[] | undefined {
  if (line.romanWords && line.romanWords.length > 0) {
    return line.romanWords.map((word) => ({
      text: word.text,
      startMs: word.startMs,
      endMs: word.endMs,
    }));
  }

  return createPlainFragment(line.romanText || '');
}

export function toRenderLine(line: SemanticLine, options?: {
  showTranslation?: boolean;
  showRomaji?: boolean;
}): RenderLine {
  const showTranslation = options?.showTranslation ?? true;
  const showRomaji = options?.showRomaji ?? true;

  return {
    startMs: line.startMs,
    endMs: line.endMs,
    main: createFragmentsFromWords(line.mainWords) ?? [{ text: line.mainText }],
    translation: showTranslation ? createPlainFragment(line.translationText || '') : undefined,
    roman: showRomaji ? createRomanFragments(line) : undefined,
    secondary: line.secondaryTexts?.map((text) => ({ text })),
  };
}

function buildRomajiText(line: SemanticLine): string {
  if (line.romanText) return line.romanText;
  if (!line.romanWords || line.romanWords.length === 0) return '';
  return line.romanWords.map((word) => word.text).join('');
}

function getWordOverlapMs(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
) {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function findOverlappingRomanWord(
  word: NonNullable<SemanticLine['mainWords']>[number],
  romanWords: NonNullable<SemanticLine['romanWords']>,
) {
  if (word.endMs <= word.startMs) {
    return undefined;
  }

  let bestWord: NonNullable<SemanticLine['romanWords']>[number] | undefined;
  let bestOverlap = 0;

  for (const romanWord of romanWords) {
    const overlap = getWordOverlapMs(word, romanWord);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestWord = romanWord;
    }
  }

  return bestWord;
}

export function semanticLineToLyricLine(line: SemanticLine): LyricLine {
  const renderLine = toRenderLine(line);

  const words = (line.mainWords || []).map((word) => {
    const timedRomaji = line.romanWords?.find((romanWord) => (
      romanWord.startMs === word.startMs && romanWord.endMs === word.endMs
    )) ?? (line.romanWords ? findOverlappingRomanWord(word, line.romanWords) : undefined);

    return {
      text: word.text,
      start: word.startMs / 1000,
      end: word.endMs / 1000,
      romaji: word.romanText || timedRomaji?.text || '',
    } satisfies LyricWord;
  });

  return {
    time: line.startMs / 1000,
    endTime: line.endMs / 1000,
    text: line.mainText || renderLine.main[0]?.text || '',
    translation: line.translationText || '',
    romaji: buildRomajiText(line),
    words: words.length > 0 ? words : undefined,
    romajiWords: line.romanWords?.map((word) => ({
      text: word.text,
      start: word.startMs / 1000,
      end: word.endMs / 1000,
    })),
    secondary: line.secondaryTexts ? [...line.secondaryTexts] : undefined,
  };
}

function wordRequiresRomaji(word: LyricWord) {
  return /[\p{L}\p{N}]/u.test(word.text);
}

function addAmlRomajiSeparators<T extends { romanWord: string }>(words: T[]): T[] {
  return words.map((word, index) => {
    const romanWord = word.romanWord || '';
    if (!romanWord.trim()) {
      return word;
    }

    if (/\s$/.test(romanWord)) {
      return word;
    }

    const hasLaterRomaji = words
      .slice(index + 1)
      .some(nextWord => (nextWord.romanWord || '').trim().length > 0);

    return {
      ...word,
      romanWord: hasLaterRomaji ? `${romanWord.trimEnd()}${AML_ROMAJI_WORD_SEPARATOR}` : romanWord,
    };
  });
}

function getOrderedSecondaryLyrics(
  line: Pick<LyricLine, 'translation' | 'romaji'>,
  showTranslation: boolean,
  showRomaji: boolean,
): string[] {
  const orderedLines: string[] = [];
  if (showRomaji && line.romaji) orderedLines.push(line.romaji);
  if (showTranslation && line.translation) orderedLines.push(line.translation);
  return orderedLines;
}

export function convertLyricsToAmlLines(
  lines: LyricLine[],
  showTranslation: boolean,
  showRomaji: boolean,
  enableWordEffect = true,
): CoreAmlLyricLine[] {
  const validLines = lines.filter((line) => {
    const text = (line.text || '').trim();
    if (/^\s*[\/\\_\-—–]+\s*$/.test(text) && !line.translation && !line.romaji) {
      return false;
    }
    return true;
  });

  return validLines.map((line, lineIndex) => {
    // When word-by-word effect is disabled, treat each line as a single word
    // so the entire line highlights at once instead of word-by-word.
    const effectiveWords = enableWordEffect ? line.words : undefined;
    const renderLine = {
      startMs: toMs(line.time),
      endMs: toMs(line.endTime || line.time),
      main: effectiveWords?.map((word) => ({
        text: word.text,
        startMs: toMs(word.start),
        endMs: toMs(word.end),
      })) ?? [{ text: line.text }],
      translation: showTranslation && line.translation ? [{ text: line.translation }] : undefined,
      roman: showRomaji && line.romaji
        ? (effectiveWords?.every((word) => Boolean(word.romaji))
          ? effectiveWords.map((word) => ({
            text: word.romaji || '',
            startMs: toMs(word.start),
            endMs: toMs(word.end),
          }))
          : [{ text: line.romaji }])
        : undefined,
    } satisfies RenderLine;

    const startTime = renderLine.startMs;
    const parsedEndTime = renderLine.endMs;
    const nextLine = validLines[lineIndex + 1];
    const nextStartTime = toMs(nextLine?.time ?? line.time + 3);
    const adaptiveLeadIn = nextLine
      ? getAdaptiveAmlLineLeadInMs(startTime, nextStartTime)
      : 0;
    const lineBoundaryEndTime = nextLine
      ? nextStartTime - adaptiveLeadIn
      : Math.max(parsedEndTime, nextStartTime);
    const endTime = Math.max(startTime + MIN_AML_LINE_DURATION_MS, lineBoundaryEndTime);

    const sourceWords = effectiveWords ?? [];
    const canUsePerWordRomaji = showRomaji
      && sourceWords.length > 0
      && sourceWords
        .filter(wordRequiresRomaji)
        .every((word) => Boolean((word.romaji || '').trim()));
    const convertedWords = sourceWords.map((word, wordIndex) => {
      const wordStart = toMs(word.start);
      const nextWordStart = sourceWords[wordIndex + 1]?.start;
      const rawWordEnd = nextWordStart !== undefined
        ? toMs(nextWordStart)
        : toMs(word.end > word.start ? word.end : endTime / 1000);
      const wordEnd = Math.max(wordStart + 20, Math.min(endTime, rawWordEnd));

      return {
        word: word.text,
        startTime: wordStart,
        endTime: wordEnd,
        romanWord: canUsePerWordRomaji ? (word.romaji || '') : '',
        obscene: false,
      };
    });
    const separatedWords = addAmlRomajiSeparators(convertedWords);
    const hasTimedRomaji = convertedWords.some((word) => (word.romanWord || '').trim().length > 0);

    const words = separatedWords.length > 0
      ? separatedWords
      : [{
          word: line.text || renderLine.main[0]?.text || ' ',
          startTime,
          endTime,
          romanWord: '',
          obscene: false,
        }];

    return {
      words,
      translatedLyric: renderLine.translation?.[0]?.text || '',
      romanLyric: showRomaji && !hasTimedRomaji ? (renderLine.roman?.[0]?.text || '') : '',
      romajiWords: showRomaji && line.romajiWords
        ? line.romajiWords.map((word) => ({
          text: word.text,
          startTime: toMs(word.start),
          endTime: toMs(word.end),
        }))
        : undefined,
      startTime,
      endTime,
      isBG: false,
      isDuet: false,
    };
  });
}

export function getCurrentLyricDisplayLines(
  line: LyricLine,
  showTranslation: boolean,
  showRomaji: boolean,
): CurrentLyricDisplayLine[] {
  const displayLines: CurrentLyricDisplayLine[] = [{
    kind: 'main',
    text: line.text || line.words?.map((word) => word.text).join('') || '',
  }];

  if (showRomaji && line.romaji) {
    const romajiWords = line.romajiWords && line.romajiWords.length > 0
      ? line.romajiWords.map((word) => ({
        text: word.text,
        start: word.start,
        end: word.end,
      }))
      : (line.words ?? [])
      .filter((word) => (word.romaji || '').length > 0)
      .map((word) => ({
        text: word.romaji || '',
        start: word.start,
        end: word.end,
      }));

    displayLines.push({
      kind: 'romaji',
      text: line.romaji,
      words: romajiWords.length > 0 ? romajiWords : undefined,
    });
  }

  if (showTranslation && line.translation) {
    displayLines.push({
      kind: 'translation',
      text: line.translation,
    });
  }

  return displayLines;
}

export function getDisplaySubtitles(
  line: Pick<LyricLine, 'translation' | 'romaji'>,
  showTranslation: boolean,
  showRomaji: boolean,
) {
  const orderedLines = getOrderedSecondaryLyrics(line, showTranslation, showRomaji);
  return {
    upper: orderedLines[0] || '',
    lower: orderedLines[1] || '',
  };
}
