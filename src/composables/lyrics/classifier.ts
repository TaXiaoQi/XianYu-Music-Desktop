import type {
  ClassifiedGroupResult,
  ClassificationConfidence,
  DominantScript,
  LineScriptProfile,
  ParsedLine,
  SemanticLine,
} from './types';

const MAX_GROUP_TOLERANCE_MS = 50;
const ROMAN_ALIGNMENT_TOLERANCE_MS = 80;
// 音译与汉字通常按音节一对一：音译词数与该行汉字数之比应落在此区间；
// 翻译与原文长度无关，因此仅靠长度无法区分，需配合下面的音译特征判定。
const MIN_ROMAN_TOKEN_HAN_RATIO = 0.45;
const MAX_ROMAN_TOKEN_HAN_RATIO = 2.2;

function resolveDominantScript(profile: Omit<LineScriptProfile, 'dominantScript'>): DominantScript {
  const counts = [
    ['latin', profile.latinCount],
    ['han', profile.hanCount],
    ['kana', profile.kanaCount],
    ['hangul', profile.hangulCount],
  ] as const;
  const total = counts.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) return 'other';

  const sorted = [...counts].sort((left, right) => right[1] - left[1]);
  const [dominantScript, dominantCount] = sorted[0];
  const secondaryCount = sorted[1]?.[1] ?? 0;

  if (secondaryCount > 0 && dominantCount / total < 0.7) {
    return 'mixed';
  }

  return dominantScript;
}

export function getLineScriptProfile(text: string): LineScriptProfile {
  const baseProfile = {
    latinCount: 0,
    hanCount: 0,
    kanaCount: 0,
    hangulCount: 0,
  };

  for (const char of text) {
    if (/\p{Script=Latin}/u.test(char)) {
      baseProfile.latinCount += 1;
      continue;
    }
    if (/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(char)) {
      baseProfile.kanaCount += 1;
      continue;
    }
    if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(char)) {
      baseProfile.hangulCount += 1;
      continue;
    }
    if (/\p{Script=Han}/u.test(char)) {
      baseProfile.hanCount += 1;
    }
  }

  return {
    ...baseProfile,
    dominantScript: resolveDominantScript(baseProfile),
  };
}

function hasExplicitSecondary(line: ParsedLine): boolean {
  return Boolean(line.explicitRole);
}

function hasParserNativeSecondary(line: ParsedLine): boolean {
  return Boolean(line.translatedText || line.romanText || line.words?.some((word) => word.romanText));
}

function isPureLatin(profile: LineScriptProfile): boolean {
  return profile.latinCount > 0
    && profile.hanCount === 0
    && profile.kanaCount === 0
    && profile.hangulCount === 0;
}

function isPureHan(profile: LineScriptProfile): boolean {
  return profile.hanCount > 0
    && profile.latinCount === 0
    && profile.kanaCount === 0
    && profile.hangulCount === 0;
}

function isChineseDominantLine(profile: LineScriptProfile): boolean {
  return profile.hanCount > 0
    && profile.hanCount > profile.latinCount
    && profile.kanaCount === 0
    && profile.hangulCount === 0;
}

function getContentText(line: ParsedLine): string {
  return line.text || line.translatedText || line.romanText || '';
}

function isForeignLanguageLine(line: ParsedLine): boolean {
  const profile = getContentProfile(line);
  return !isChineseDominantLine(profile)
    && !isPureHan(profile)
    && /\p{Letter}/u.test(getContentText(line));
}

// 英文功能词：出现即强烈暗示该拉丁行是英文，而非 CJK 歌词的罗马化音译。
const ENGLISH_FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'do', 'does', 'did', 'have', 'has', 'had', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'their', 'our', 'its', 'to', 'of',
  'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'not', 'that', 'this', 'these', 'those',
  'will', 'would', 'can', 'could', 'should', 'when', 'where', 'what', 'who', 'how', 'all',
  'just', 'only', 'than', 'then', 'there', 'here',
]);

// 典型英文词形；粤拼/拼音不会以这些字母组合结尾，出现即判定为英文而非音译。
const ENGLISH_MORPHOLOGY_PATTERN = /(?:ing|tion|sion|ness|ment|ly|ed)$/;
// 粤拼/港式罗马化特征：声调数字、j-/y- 声母、eo/oe/yu 韵母、-ng/-k/-t 韵尾。
const ROMANIZATION_FINAL_PATTERN = /(?:eo|oe|yu)/;
const ROMANIZATION_INITIAL_PATTERN = /^[jy]/;
const ROMANIZATION_ENDING_PATTERN = /(?:ng|k|t)$/;

function tokenizeLatinWords(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * 该拉丁行是否「像」粤拼/港式罗马化音译，而非英文。
 * 镜像 Rust 侧 score_romanized_latin_text / looks_like_non_romaji_english_latin_text 的意图：
 * 必须带音译特征（声调数字 / 声母 / 韵母 / 韵尾），且不含英文功能词、不含典型英文词形。
 */
function looksLikeRomanizedLatin(text: string): boolean {
  const tokens = tokenizeLatinWords(text);
  if (tokens.length === 0) return false;

  if (tokens.some((token) => ENGLISH_FUNCTION_WORDS.has(token))) return false;
  if (tokens.some((token) => token.length > 3 && ENGLISH_MORPHOLOGY_PATTERN.test(token))) return false;

  const lower = text.toLowerCase();
  if (/\d/.test(text)) return true; // 声调数字，如 nei5 / soeng1
  if (ROMANIZATION_FINAL_PATTERN.test(lower)) return true;
  return tokens.some((token) => (
    ROMANIZATION_INITIAL_PATTERN.test(token) || ROMANIZATION_ENDING_PATTERN.test(token)
  ));
}

/**
 * 拉丁行是否为该汉字行的罗马化音译（常见于粤语歌：lyric=粤拼、tlyric=中文）。
 * 需要同时满足：组内有汉字主导行；拉丁行是纯拉丁且「像音译」；音译词数与汉字数大致对应。
 * 结构完全相同的「英文行 + 中文翻译」会因为英文功能词/词形而在这里被排除。
 */
function isLatinRomanizationOf(latinLine: ParsedLine, cjkLine: ParsedLine): boolean {
  const cjkProfile = getContentProfile(cjkLine);
  if (cjkProfile.hanCount === 0 || !isChineseDominantLine(cjkProfile)) return false;
  if (!isPureLatin(getContentProfile(latinLine))) return false;

  const latinText = getContentText(latinLine);
  if (!looksLikeRomanizedLatin(latinText)) return false;

  const tokenCount = tokenizeLatinWords(latinText).length;
  if (tokenCount === 0) return false;

  const tokenToHanRatio = tokenCount / cjkProfile.hanCount;
  return tokenToHanRatio >= MIN_ROMAN_TOKEN_HAN_RATIO && tokenToHanRatio <= MAX_ROMAN_TOKEN_HAN_RATIO;
}

function isJapaneseLike(profile: LineScriptProfile): boolean {
  return profile.kanaCount > 0
    && profile.hangulCount === 0;
}

function isKoreanLike(profile: LineScriptProfile): boolean {
  return profile.hangulCount > 0
    && profile.kanaCount === 0;
}

function getContentProfile(line: ParsedLine): LineScriptProfile {
  return getLineScriptProfile(getContentText(line));
}

function getEffectiveTolerance(
  currentStartMs: number,
  prevStartMs: number | null,
  nextStartMs: number | null,
): number {
  const prevGap = prevStartMs !== null
    ? Math.abs(currentStartMs - prevStartMs)
    : Number.POSITIVE_INFINITY;
  const nextGap = nextStartMs !== null
    ? Math.abs(nextStartMs - currentStartMs)
    : Number.POSITIVE_INFINITY;

  return Math.min(
    MAX_GROUP_TOLERANCE_MS,
    prevGap * 0.25,
    nextGap * 0.25,
  );
}

function findContextStart(
  lines: ParsedLine[],
  originIndex: number,
  direction: -1 | 1,
): number | null {
  const originStartMs = lines[originIndex].startMs;

  for (let index = originIndex + direction; index >= 0 && index < lines.length; index += direction) {
    const candidateStartMs = lines[index].startMs;
    if (Math.abs(candidateStartMs - originStartMs) > MAX_GROUP_TOLERANCE_MS) {
      return candidateStartMs;
    }
  }

  return null;
}

function getGroupTolerance(lines: ParsedLine[], groupStartIndex: number): number {
  return getEffectiveTolerance(
    lines[groupStartIndex].startMs,
    findContextStart(lines, groupStartIndex, -1),
    findContextStart(lines, groupStartIndex, 1),
  );
}

function groupParsedLines(lines: ParsedLine[]): ParsedLine[][] {
  if (lines.length === 0) return [];

  const groups: ParsedLine[][] = [];
  let groupStartIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const currentGroup = groups[groups.length - 1];

    if (!currentGroup) {
      groups.push([line]);
      groupStartIndex = index;
      continue;
    }

    const tolerance = getGroupTolerance(lines, groupStartIndex);
    const withinTolerance = Math.abs(line.startMs - currentGroup[0].startMs) <= tolerance;

    if (withinTolerance) {
      currentGroup.push(line);
      continue;
    }

    groups.push([line]);
    groupStartIndex = index;
  }

  return groups;
}

function selectHeuristicMainLine(lines: ParsedLine[]): { main: ParsedLine; isRomanizedSwap: boolean } {
  const japaneseLine = lines.find((line) => isJapaneseLike(getContentProfile(line)));
  if (japaneseLine) return { main: japaneseLine, isRomanizedSwap: false };

  const koreanLine = lines.find((line) => isKoreanLike(getContentProfile(line)));
  if (koreanLine) return { main: koreanLine, isRomanizedSwap: false };

  if (lines.length === 2) {
    const chineseLine = lines.find((line) => isChineseDominantLine(getContentProfile(line)));
    const foreignLine = lines.find((line) => isForeignLanguageLine(line));
    if (foreignLine && chineseLine) {
      // 若拉丁行是该汉字行的罗马化音译（如粤拼），汉字行才是主行；
      // 否则维持「外文主行 + 中文译文」的既有行为（英文歌 + 中文翻译）。
      if (isLatinRomanizationOf(foreignLine, chineseLine)) {
        return { main: chineseLine, isRomanizedSwap: true };
      }
      return { main: foreignLine, isRomanizedSwap: false };
    }
  }

  return { main: lines[0], isRomanizedSwap: false };
}

function classifyHeuristicRole(
  main: ParsedLine,
  candidate: ParsedLine,
): 'translation' | 'romaji' | 'secondary' {
  const mainProfile = getContentProfile(main);
  const candidateProfile = getContentProfile(candidate);

  if (isJapaneseLike(mainProfile) || isKoreanLike(mainProfile)) {
    if (isPureLatin(candidateProfile)) return 'romaji';
    if (isChineseDominantLine(candidateProfile)) return 'translation';
    return 'secondary';
  }

  switch (mainProfile.dominantScript) {
    case 'han':
      return isPureLatin(candidateProfile) ? 'romaji' : 'secondary';
    case 'latin':
      return isChineseDominantLine(candidateProfile) ? 'translation' : 'secondary';
    default:
      return isChineseDominantLine(candidateProfile) ? 'translation' : 'secondary';
  }
}

export function classifyGroupLines(group: ParsedLine[]): ClassifiedGroupResult {
  const explicitTranslationLines = group.filter((line) => line.explicitRole === 'translation');
  const explicitRomajiLines = group.filter((line) => line.explicitRole === 'roman');
  const regularLines = group.filter((line) => !line.explicitRole);

  const parserNativeMain = regularLines.find((line) => hasParserNativeSecondary(line));
  const heuristicMain = selectHeuristicMainLine(regularLines.length > 0 ? regularLines : group);
  const main = parserNativeMain ?? heuristicMain.main;
  // 显式标记优先：源里写了角色就不做推断，也不强制显示罗马音。
  const isRomanized = !parserNativeMain
    && heuristicMain.isRomanizedSwap
    && explicitTranslationLines.length === 0
    && explicitRomajiLines.length === 0;

  const remainingRegularLines = regularLines.filter((line) => line !== main);

  let translationLine = explicitTranslationLines[0] ?? null;
  let romajiLine = explicitRomajiLines[0] ?? null;
  const secondaryLines: ParsedLine[] = [
    ...explicitTranslationLines.slice(1),
    ...explicitRomajiLines.slice(1),
  ];

  for (const line of remainingRegularLines) {
    const role = classifyHeuristicRole(main, line);

    if (role === 'translation' && !translationLine && !main.translatedText) {
      translationLine = line;
      continue;
    }

    if (role === 'romaji' && !romajiLine && !main.romanText && !main.words?.some((word) => word.romanText)) {
      romajiLine = line;
      continue;
    }

    secondaryLines.push(line);
  }

  let confidence: ClassificationConfidence = 'heuristic';
  if (hasExplicitSecondary(main) || explicitTranslationLines.length > 0 || explicitRomajiLines.length > 0) {
    confidence = 'explicit';
  } else if (hasParserNativeSecondary(main)) {
    confidence = 'parser-native';
  }

  return {
    main,
    translationLine,
    romajiLine,
    secondaryLines,
    confidence,
    isRomanized,
  };
}

function normalizeRomanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function mergeAlignedRomanWords(main: ParsedLine, romajiLine: ParsedLine | null): SemanticLine['romanWords'] {
  const mainWords = main.words ?? [];

  if (mainWords.some((word) => word.romanText)) {
    const nativeRomanWords = mainWords.map((word) => ({
      text: normalizeRomanText(word.romanText || ''),
      startMs: word.startMs,
      endMs: word.endMs,
    }));
    return nativeRomanWords.every((word) => word.text.length > 0)
      ? nativeRomanWords
      : undefined;
  }

  const romajiWords = romajiLine?.words ?? [];
  if (mainWords.length === 0 || romajiWords.length === 0) return romajiWords.length > 0 ? romajiWords : undefined;
  if (mainWords.length === romajiWords.length) {
    const allAligned = mainWords.every((word, index) => {
      const romajiWord = romajiWords[index];
      return Math.abs(word.startMs - romajiWord.startMs) <= ROMAN_ALIGNMENT_TOLERANCE_MS
        && Math.abs(word.endMs - romajiWord.endMs) <= ROMAN_ALIGNMENT_TOLERANCE_MS;
    });

    if (allAligned) {
      const alignedRomanWords = romajiWords.map((word) => ({
        text: normalizeRomanText(word.text),
        startMs: word.startMs,
        endMs: word.endMs,
      }));
      return alignedRomanWords.every((word) => word.text.length > 0)
        ? alignedRomanWords
        : undefined;
    }
  }

  const mergedTexts = mainWords.map(() => '');

  for (const romajiWord of romajiWords) {
    const romajiCenter = (romajiWord.startMs + romajiWord.endMs) / 2;
    let bestIndex = -1;
    let bestOverlap = Number.NEGATIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < mainWords.length; index += 1) {
      const mainWord = mainWords[index];
      const expandedStart = mainWord.startMs - ROMAN_ALIGNMENT_TOLERANCE_MS;
      const expandedEnd = mainWord.endMs + ROMAN_ALIGNMENT_TOLERANCE_MS;
      const overlap = Math.min(expandedEnd, romajiWord.endMs) - Math.max(expandedStart, romajiWord.startMs);
      const mainCenter = (mainWord.startMs + mainWord.endMs) / 2;
      const distance = Math.abs(mainCenter - romajiCenter);

      if (
        overlap > bestOverlap
        || (overlap === bestOverlap && distance < bestDistance)
      ) {
        bestIndex = index;
        bestOverlap = overlap;
        bestDistance = distance;
      }
    }

    if (bestIndex >= 0) {
      mergedTexts[bestIndex] += romajiWord.text;
    }
  }

  const mergedRomanWords = mainWords.map((word, index) => ({
    text: normalizeRomanText(mergedTexts[index]),
    startMs: word.startMs,
    endMs: word.endMs,
  }));

  return mergedRomanWords.every((word) => word.text.length > 0)
    ? mergedRomanWords
    : undefined;
}

export function buildSemanticLines(lines: ParsedLine[]): SemanticLine[] {
  return groupParsedLines(lines)
    .map((group) => {
      const {
        main,
        translationLine,
        romajiLine,
        secondaryLines,
        confidence,
        isRomanized,
      } = classifyGroupLines(group);
      const endMs = Math.max(
        main.endMs ?? main.startMs,
        ...group.map((line) => line.endMs ?? line.startMs),
      );
      const romanWords = mergeAlignedRomanWords(main, romajiLine);
      const secondaryTexts = secondaryLines
        .map((line) => line.text)
        .filter((text) => text.length > 0);

      return {
        startMs: main.startMs,
        endMs,
        mainText: main.text,
        mainWords: main.words,
        translationText: main.translatedText || translationLine?.text || undefined,
        romanText: main.romanText || romajiLine?.text || undefined,
        romanWords,
        secondaryTexts: secondaryTexts.length > 0 ? secondaryTexts : undefined,
        confidence,
        speaker: undefined,
        isBG: false,
        isDuet: false,
        isDuetPartner: false,
        isRomanized: isRomanized || undefined,
      } satisfies SemanticLine;
    })
    .filter((line) => line.mainText.length > 0 || line.translationText || line.romanText);
}
