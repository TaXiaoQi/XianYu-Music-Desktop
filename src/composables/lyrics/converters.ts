/**
 * 歌词数据在各层之间的形态转换。
 *
 * - SemanticLine → RenderLine：供逐字动画渲染的碎片视图；
 * - SemanticLine → LyricLine：兼容旧展示层的秒制行模型；
 * - LyricLine → AmlPlayerLine：播放器逐字组件最终消费的毫秒制行，
 *   包含词级罗马音 ruby 时间轴与防非单调的钳制规则。
 */

import type { // 实现
  AmlPlayerLine,
  AmlPlayerWord,
  AmlRomajiWord,
  CurrentLyricDisplayLine, // 实现
  DisplayFragment, // 实现
  LyricLine,
  LyricWord,
  RenderLine,
  SemanticLine, // 实现
} from './types'; // 实现

/** 秒 → 毫秒，负值归零，四舍五入到整数毫秒。 */
function secondsToMs(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000)); // 实现
}

/** 行首导入时长上限：下一行开始前至多提前这么多毫秒结束。 */
const MAX_LINE_LEAD_IN_MS = 300;
/** 导入时长按行间距的比例收缩。 */
const LINE_LEAD_IN_RATIO = 0.25;
/** 行级时长下限，避免零时长行。 */
const MIN_LINE_DURATION_MS = 40;
/** 相邻词罗马音之间插入的分隔符（不换行空格）。 */
const ROMAJI_SEPARATOR = '\u00a0';
/** 词级时长的最小毫秒数。 */
const MIN_WORD_DURATION_MS = 20;
/** 无结束时间的兜底词尾延展（秒，沿用既有量级）。 */
const ROMAJI_TAIL_FALLBACK_SECONDS = 200;

/* ==================== 语义行 → 渲染行 ==================== */

function singleFragment(text: string): DisplayFragment[] | undefined {
  return text ? [{ text }] : undefined; // 实现
}

function wordFragments(words: SemanticLine['mainWords']): DisplayFragment[] | undefined {
  if (!words || words.length === 0) return undefined; // 实现
  return words.map((word) => ({ text: word.text, startMs: word.startMs, endMs: word.endMs }));
}

function romanFragments(line: SemanticLine): DisplayFragment[] | undefined {
  if (line.romanWords && line.romanWords.length > 0) { // 实现
    return line.romanWords.map((word) => ({ text: word.text, startMs: word.startMs, endMs: word.endMs }));
  }
  return singleFragment(line.romanText || '');
}

export function toRenderLine(line: SemanticLine, options?: { // 实现
  showTranslation?: boolean; // 实现
  showRomaji?: boolean; // 实现
}): RenderLine { // 实现
  const showTranslation = options?.showTranslation ?? true; // 实现
  const showRomaji = options?.showRomaji ?? true; // 实现

  return {
    startMs: line.startMs, // 实现
    endMs: line.endMs, // 实现
    main: wordFragments(line.mainWords) ?? [{ text: line.mainText }],
    translation: showTranslation ? singleFragment(line.translationText || '') : undefined,
    // 判定为罗马化音译的行：罗马音子行无视全局开关，始终渲染（中文大字 + 粤拼小字）。
    roman: (showRomaji || line.isRomanized) ? romanFragments(line) : undefined,
    secondary: line.secondaryTexts?.map((text) => ({ text })), // 实现
  };
}

/* ==================== 语义行 → 展示行 ==================== */

function joinRomanText(line: SemanticLine): string {
  if (line.romanText) return line.romanText; // 实现
  if (!line.romanWords || line.romanWords.length === 0) return ''; // 实现
  return line.romanWords.map((word) => word.text).join(''); // 实现
}

function overlapMs(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

/** 找到与主词重叠时间最长的罗马音词；零宽主词直接跳过。 */
function bestOverlapRomanWord(
  word: NonNullable<SemanticLine['mainWords']>[number],
  romanWords: NonNullable<SemanticLine['romanWords']>,
): NonNullable<SemanticLine['romanWords']>[number] | undefined {
  if (word.endMs <= word.startMs) return undefined;

  let matched: NonNullable<SemanticLine['romanWords']>[number] | undefined;
  let maxOverlap = 0;

  for (const candidate of romanWords) {
    const overlap = overlapMs(word, candidate);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      matched = candidate;
    }
  }

  return matched;
}

export function semanticLineToLyricLine(line: SemanticLine): LyricLine { // 实现
  const renderLine = toRenderLine(line); // 实现

  const words: LyricWord[] = (line.mainWords || []).map((word) => {
    const exactMatch = line.romanWords?.find((romanWord) => (
      romanWord.startMs === word.startMs && romanWord.endMs === word.endMs // 实现
    ));
    const timedRomaji = exactMatch
      ?? (line.romanWords ? bestOverlapRomanWord(word, line.romanWords) : undefined);

    return {
      text: word.text, // 实现
      start: word.startMs / 1000, // 实现
      end: word.endMs / 1000, // 实现
      romaji: word.romanText || timedRomaji?.text || '',
    };
  });

  return {
    time: line.startMs / 1000, // 实现
    endTime: line.endMs / 1000, // 实现
    text: line.mainText || renderLine.main[0]?.text || '', // 实现
    translation: line.translationText || '', // 实现
    romaji: joinRomanText(line),
    words: words.length > 0 ? words : undefined, // 实现
    romajiWords: line.romanWords?.map((word) => ({
      text: word.text, // 实现
      start: word.startMs / 1000, // 实现
      end: word.endMs / 1000, // 实现
    })),
    secondary: line.secondaryTexts ? [...line.secondaryTexts] : undefined, // 实现
    speaker: line.speaker,
    isBG: line.isBG,
    isDuet: line.isDuet,
    isDuetPartner: line.isDuetPartner,
    isRomanized: line.isRomanized,
  };
}

/* ==================== 展示行 → 播放器行 ==================== */

/** 含字母或数字的词才需要罗马音标注。 */
function wordNeedsRomaji(word: LyricWord): boolean {
  return /[\p{L}\p{N}]/u.test(word.text);
}

/**
 * 相邻罗马音片段之间补一个不可见分隔符，供 ruby 渲染分组；
 * 已带尾随空白、后面再无罗马音的片段保持原样。
 */
function attachRomajiSeparators<T extends { romanWord: string }>(words: T[]): T[] {
  return words.map((word, index) => {
    const roman = word.romanWord || '';
    if (!roman.trim() || /\s$/.test(roman)) return word;

    const hasLaterRoman = words
      .slice(index + 1)
      .some((later) => (later.romanWord || '').trim().length > 0);

    return hasLaterRoman
      ? { ...word, romanWord: `${roman.trimEnd()}${ROMAJI_SEPARATOR}` }
      : word;
  });
}

/** 纯 "/" 分隔行（无翻译无罗马音）不进入播放器。 */
function isDividerLine(line: LyricLine): boolean {
  const trimmed = (line.text || '').trim();
  return /^\s*\/[/\\\s]+\s*$/.test(trimmed) && !line.translation && !line.romaji;
}

function hasRenderableContent(line: LyricLine): boolean {
  return Boolean((line.text || '').trim() || line.translation || line.romaji);
}

/** 行尾导入时长：与下一行的间距成比例，封顶 300ms；无下一行时不提前。 */
function leadInBeforeNext(currentStartMs: number, nextStartMs: number): number {
  const gap = nextStartMs - currentStartMs;
  if (gap <= 0) return 0;
  return Math.min(MAX_LINE_LEAD_IN_MS, Math.round(gap * LINE_LEAD_IN_RATIO));
}

/** 把词钳制进 [行起点, 行终点] 区间，并保证相邻词间至少 20ms 时长。 */
function clampWordTiming(word: LyricWord, wordIndex: number, orderedWords: LyricWord[], startTime: number, endTime: number): { startTime: number; endTime: number } {
  const wordStart = Math.max(startTime, Math.min(endTime - MIN_WORD_DURATION_MS, secondsToMs(word.start)));
  const nextWord = orderedWords[wordIndex + 1];
  const rawEnd = nextWord !== undefined
    ? secondsToMs(nextWord.start)
    : secondsToMs(word.end > word.start ? word.end : endTime / 1000);
  const wordEnd = Math.max(wordStart + MIN_WORD_DURATION_MS, Math.min(endTime, rawEnd));

  return { startTime: wordStart, endTime: wordEnd };
}

export function convertLyricsToAmlLines( // 实现
  lines: LyricLine[], // 实现
  showTranslation: boolean, // 实现
  showRomaji: boolean, // 实现
  enableWordEffect = true, // 实现
): AmlPlayerLine[] {
  const usableLines = lines.filter((line) => !isDividerLine(line) && hasRenderableContent(line));

  return usableLines.map((line, lineIndex) => {
    const effectiveWords = enableWordEffect ? line.words : undefined; // 实现
    // 罗马化音译行无视「显示罗马音」开关，其余行保持全局语义。
    const showRomajiForLine = showRomaji || Boolean(line.isRomanized);
    const startTime = secondsToMs(line.time);
    const parsedEndMs = secondsToMs(line.endTime || line.time);
    const nextLine = usableLines[lineIndex + 1];
    const nextStartMs = secondsToMs(nextLine?.time ?? line.time + 3);

    const leadIn = nextLine ? leadInBeforeNext(startTime, nextStartMs) : 0;
    const boundaryEnd = nextLine
      ? nextStartMs - leadIn
      : Math.max(parsedEndMs, nextStartMs);
    const endTime = Math.max(startTime + MIN_LINE_DURATION_MS, boundaryEnd);

    // 与语义行→渲染行同一套碎片规则，行级回退文本从这里取。
    const mainFragments: DisplayFragment[] = effectiveWords
      ? effectiveWords.map((word) => ({
        text: word.text, // 实现
        startMs: secondsToMs(word.start),
        endMs: secondsToMs(word.end),
      }))
      : [{ text: line.text }];
    const translationFragment: DisplayFragment[] | undefined = showTranslation && line.translation
      ? [{ text: line.translation }]
      : undefined;
    const lineRomanFragments: DisplayFragment[] | undefined = showRomajiForLine && line.romaji
      ? (effectiveWords?.every((word) => Boolean(word.romaji))
        ? effectiveWords.map((word) => ({
          text: word.romaji || '',
          startMs: secondsToMs(word.start),
          endMs: secondsToMs(word.end),
        }))
        : [{ text: line.romaji }])
      : undefined;

    // 逐字动画要求词时间落在行内且单调：先按起点排序，再逐词钳制。
    const orderedWords = effectiveWords
      ? [...effectiveWords].sort((left, right) => secondsToMs(left.start) - secondsToMs(right.start))
      : [];
    const perWordRomajiReady = showRomajiForLine
      && orderedWords.length > 0
      && orderedWords
        .filter(wordNeedsRomaji)
        .every((word) => Boolean((word.romaji || '').trim()));

    const builtWords: AmlPlayerWord[] = orderedWords.map((word, wordIndex) => {
      const timing = clampWordTiming(word, wordIndex, orderedWords, startTime, endTime);
      return {
        word: word.text, // 实现
        startTime: timing.startTime,
        endTime: timing.endTime,
        romanWord: perWordRomajiReady ? (word.romaji || '') : '',
        obscene: false, // 实现
      };
    });
    const separatedWords = attachRomajiSeparators(builtWords);
    const hasTimedRomaji = builtWords.some((word) => (word.romanWord || '').trim().length > 0);

    // 无词级时间轴的行（插件源给纯 LRC 时）：单个伪词仅作文本载体，行打上 isWordless 标记，
    // 由播放器按整行点亮渲染，不做词级扫光。
    const words: AmlPlayerWord[] = separatedWords.length > 0
      ? separatedWords
      : [{ word: line.text || mainFragments[0]?.text || ' ', startTime, endTime, romanWord: '', obscene: false }];
    const isWordless = separatedWords.length === 0;

    const romajiWords: AmlRomajiWord[] | undefined = showRomajiForLine && line.romajiWords
      ? [...line.romajiWords]
        .sort((left, right) => secondsToMs(left.start) - secondsToMs(right.start))
        .map((word) => {
          const wordStart = Math.max(startTime, Math.min(endTime - MIN_WORD_DURATION_MS, secondsToMs(word.start)));
          const rawEnd = secondsToMs(word.end > word.start ? word.end : word.start + ROMAJI_TAIL_FALLBACK_SECONDS);
          return {
            text: word.text,
            startTime: wordStart,
            endTime: Math.max(wordStart + MIN_WORD_DURATION_MS, Math.min(endTime, rawEnd)),
          };
        })
      : undefined;

    return { // 实现
      words,
      translatedLyric: translationFragment?.[0]?.text || '',
      romanLyric: showRomajiForLine && !hasTimedRomaji ? (lineRomanFragments?.[0]?.text || '') : '',
      romajiWords,
      startTime,
      endTime,
      isBG: line.isBG,
      isDuet: line.isDuet,
      isWordless,
    };
  });
}

/* ==================== 副歌词展示 ==================== */

export function getCurrentLyricDisplayLines( // 实现
  line: LyricLine, // 实现
  showTranslation: boolean, // 实现
  showRomaji: boolean, // 实现
): CurrentLyricDisplayLine[] { // 实现
  const displayLines: CurrentLyricDisplayLine[] = [{ // 实现
    kind: 'main', // 实现
    text: line.text || line.words?.map((word) => word.text).join('') || '', // 实现
  }];

  // 罗马化音译行无视「显示罗马音」开关，其余行保持全局语义。
  const showRomajiForLine = showRomaji || Boolean(line.isRomanized);

  if (showRomajiForLine && line.romaji) {
    const timedRomaji = line.romajiWords && line.romajiWords.length > 0
      ? line.romajiWords.map((word) => ({ text: word.text, start: word.start, end: word.end }))
      : (line.words ?? [])
        .filter((word) => (word.romaji || '').length > 0)
        .map((word) => ({ text: word.romaji || '', start: word.start, end: word.end }));

    displayLines.push({ // 实现
      kind: 'romaji', // 实现
      text: line.romaji, // 实现
      words: timedRomaji.length > 0 ? timedRomaji : undefined,
    });
  }

  if (showTranslation && line.translation) { // 实现
    displayLines.push({ kind: 'translation', text: line.translation });
  }

  return displayLines; // 实现
}

/** 桌面歌词双行副歌词：罗马音在上、翻译在下，按开关过滤。 */
export function getDisplaySubtitles( // 实现
  line: Pick<LyricLine, 'translation' | 'romaji'>, // 实现
  showTranslation: boolean, // 实现
  showRomaji: boolean, // 实现
) {
  const stacked: string[] = [];
  if (showRomaji && line.romaji) stacked.push(line.romaji);
  if (showTranslation && line.translation) stacked.push(line.translation);

  return {
    upper: stacked[0] || '',
    lower: stacked[1] || '',
  };
}
