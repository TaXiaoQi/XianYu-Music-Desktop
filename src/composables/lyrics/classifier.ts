/**
 * 歌词行分组与轨道角色判定。
 *
 * 同一时刻并排出现的多行歌词（原文/翻译/罗马音/备用行）会先按
 * 起始时间聚成"组"，再依据文字类型与显式标记推断每行扮演的角色，
 * 最终折叠成语义行（SemanticLine）供展示层消费。
 */

import type {
  ClassifiedGroupResult,
  ClassificationConfidence,
  DominantScript,
  LineScriptProfile,
  ParsedLine,
  ParsedWord,
  SemanticLine,
} from './types';

/** 相邻行归入同组的时间容差上限。 */
const GROUP_TOLERANCE_MS = 50;
/** 罗马音词与主词时间对齐时的允许偏差。 */
const ROMAJI_WORD_TOLERANCE_MS = 80;
/** 判定"主导文字"所需的最小占比。 */
const DOMINANT_SCRIPT_RATIO = 0.7;
// 音译与汉字通常按音节一对一：音译词数与该行汉字数之比应落在此区间；
// 翻译与原文长度无关，因此仅靠长度无法区分，需配合下面的音译特征判定。
const MIN_ROMAN_TOKEN_HAN_RATIO = 0.45;
const MAX_ROMAN_TOKEN_HAN_RATIO = 2.2;

/* ==================== 文字类型分析 ==================== */

type ScriptKind = Exclude<DominantScript, 'mixed' | 'other'>;

/** 逐字符识别文字种类；无法识别时返回 null。 */
function detectScriptKind(char: string): ScriptKind | null {
  if (/\p{Script=Latin}/u.test(char)) return 'latin';
  if (/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(char)) return 'kana';
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(char)) return 'hangul';
  if (/\p{Script=Han}/u.test(char)) return 'han';
  return null;
}

/**
 * 从四类计数里挑出主导文字：占比不足 0.7 且存在次要多于零时判为 mixed；
 * 计数持平的时候按 latin → han → kana → hangul 的固定顺序取胜者。
 */
function pickDominantScript(profile: Omit<LineScriptProfile, 'dominantScript'>): DominantScript {
  const tally: Array<[ScriptKind, number]> = [
    ['latin', profile.latinCount],
    ['han', profile.hanCount],
    ['kana', profile.kanaCount],
    ['hangul', profile.hangulCount],
  ];

  const total = tally.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return 'other';

  let leader: ScriptKind = tally[0][0];
  let leaderCount = tally[0][1];
  let runnerUpCount = -1;

  for (let index = 1; index < tally.length; index += 1) {
    const [kind, count] = tally[index];
    if (count > leaderCount) {
      runnerUpCount = leaderCount;
      leader = kind;
      leaderCount = count;
      continue;
    }
    if (count > runnerUpCount) runnerUpCount = count;
  }

  if (runnerUpCount > 0 && leaderCount / total < DOMINANT_SCRIPT_RATIO) return 'mixed';
  return leader;
}

export function getLineScriptProfile(text: string): LineScriptProfile {
  const counts = { latinCount: 0, hanCount: 0, kanaCount: 0, hangulCount: 0 };

  for (const char of text) {
    const kind = detectScriptKind(char);
    if (kind === 'latin') counts.latinCount += 1;
    else if (kind === 'han') counts.hanCount += 1;
    else if (kind === 'kana') counts.kanaCount += 1;
    else if (kind === 'hangul') counts.hangulCount += 1;
  }

  return { ...counts, dominantScript: pickDominantScript(counts) };
}

/* ==================== 行内容速判 ==================== */

function contentTextOf(line: ParsedLine): string {
  return line.text || line.translatedText || line.romanText || '';
}

function profileOf(line: ParsedLine): LineScriptProfile {
  return getLineScriptProfile(contentTextOf(line));
}

function isPureLatin(profile: LineScriptProfile): boolean {
  return profile.latinCount > 0
    && profile.hanCount + profile.kanaCount + profile.hangulCount === 0;
}

function isPureHan(profile: LineScriptProfile): boolean {
  return profile.hanCount > 0
    && profile.latinCount + profile.kanaCount + profile.hangulCount === 0;
}

/** 汉字占优且没有假名/谚文，视为中文行。 */
function isChineseLike(profile: LineScriptProfile): boolean {
  return profile.hanCount > 0
    && profile.hanCount > profile.latinCount
    && profile.kanaCount === 0
    && profile.hangulCount === 0;
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
 * 与 Rust 侧 score_romanized_latin_text / looks_like_non_romaji_english_latin_text 同一意图：
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
  // j-/y- 声母、-ng/-k/-t 韵尾是弱特征（法语/英语单词 et、out 也会命中），
  // 至少两个音节同时命中才判音译，避免「拉丁主行 + 中文翻译」被误交换。
  let markerCount = 0;
  for (const token of tokens) {
    if (ROMANIZATION_INITIAL_PATTERN.test(token) || ROMANIZATION_ENDING_PATTERN.test(token)) {
      markerCount += 1;
      if (markerCount >= 2) return true;
    }
  }
  return false;
}

/**
 * 拉丁行是否为该汉字行的罗马化音译（常见于粤语歌：lyric=粤拼、tlyric=中文）。
 * 需要同时满足：组内有汉字主导行；拉丁行是纯拉丁且「像音译」；音译词数与汉字数大致对应。
 * 结构完全相同的「英文行 + 中文翻译」会因为英文功能词/词形而在这里被排除。
 */
function isLatinRomanizationOf(latinLine: ParsedLine, cjkLine: ParsedLine): boolean {
  const cjkProfile = profileOf(cjkLine);
  if (cjkProfile.hanCount === 0 || !isChineseLike(cjkProfile)) return false;
  if (!isPureLatin(profileOf(latinLine))) return false;

  const latinText = contentTextOf(latinLine);
  if (!looksLikeRomanizedLatin(latinText)) return false;

  const tokenCount = tokenizeLatinWords(latinText).length;
  if (tokenCount === 0) return false;

  const tokenToHanRatio = tokenCount / cjkProfile.hanCount;
  return tokenToHanRatio >= MIN_ROMAN_TOKEN_HAN_RATIO && tokenToHanRatio <= MAX_ROMAN_TOKEN_HAN_RATIO;
}

function isJapaneseLike(profile: LineScriptProfile): boolean {
  return profile.kanaCount > 0 && profile.hangulCount === 0;
}

function isKoreanLike(profile: LineScriptProfile): boolean {
  return profile.hangulCount > 0 && profile.kanaCount === 0;
}

/** 含字母且不是中文主导的行，当作"外语行"参与主行竞争。 */
function isForeignTextLine(line: ParsedLine): boolean {
  const profile = profileOf(line);
  return !isChineseLike(profile)
    && !isPureHan(profile)
    && /\p{Letter}/u.test(contentTextOf(line));
}

/* ==================== 时间分组 ==================== */

/**
 * 求组锚点两侧"第一个跳出容差窗"的行起点，用于把容差收缩到
 * 邻近真实换行处，避免密集行被误并。
 */
function boundaryStartMs(lines: ParsedLine[], anchor: number, step: -1 | 1): number | null {
  const anchorStart = lines[anchor].startMs;

  for (let index = anchor + step; index >= 0 && index < lines.length; index += step) {
    const candidateStart = lines[index].startMs;
    if (Math.abs(candidateStart - anchorStart) > GROUP_TOLERANCE_MS) return candidateStart;
  }

  return null;
}

function toleranceAtAnchor(lines: ParsedLine[], anchor: number): number {
  const anchorStart = lines[anchor].startMs;
  const prevStart = boundaryStartMs(lines, anchor, -1);
  const nextStart = boundaryStartMs(lines, anchor, 1);
  const prevGap = prevStart === null ? Number.POSITIVE_INFINITY : Math.abs(anchorStart - prevStart);
  const nextGap = nextStart === null ? Number.POSITIVE_INFINITY : Math.abs(nextStart - anchorStart);

  return Math.min(GROUP_TOLERANCE_MS, prevGap * 0.25, nextGap * 0.25);
}

/** 把按时间排序的行按容差切成若干组，每组内首行锚定容差。 */
function splitIntoGroups(lines: ParsedLine[]): ParsedLine[][] {
  if (lines.length === 0) return [];

  const groups: ParsedLine[][] = [[lines[0]]];
  let anchorIndex = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const tolerance = toleranceAtAnchor(lines, anchorIndex);
    const anchorStartMs = groups[groups.length - 1][0].startMs;

    if (Math.abs(lines[index].startMs - anchorStartMs) <= tolerance) {
      groups[groups.length - 1].push(lines[index]);
    } else {
      groups.push([lines[index]]);
      anchorIndex = index;
    }
  }

  return groups;
}

/* ==================== 组内角色判定 ==================== */

function carriesInlineSecondary(line: ParsedLine): boolean {
  return Boolean(line.translatedText || line.romanText || line.words?.some((word) => word.romanText));
}

/** 从一组常规行里挑出最像"原文"的那一行；发生拉丁音译互换时一并返回交换标记。 */
function chooseMainLine(lines: ParsedLine[]): { mainLine: ParsedLine; romanizedSwap: boolean } {
  const japaneseLine = lines.find((line) => isJapaneseLike(profileOf(line)));
  if (japaneseLine) return { mainLine: japaneseLine, romanizedSwap: false };

  const koreanLine = lines.find((line) => isKoreanLike(profileOf(line)));
  if (koreanLine) return { mainLine: koreanLine, romanizedSwap: false };

  // 恰好两行且一行为中文时，非中文的那行更可能是原文。
  if (lines.length === 2) {
    const chineseLine = lines.find((line) => isChineseLike(profileOf(line)));
    const foreignLine = lines.find((line) => isForeignTextLine(line));
    if (chineseLine && foreignLine) {
      // 若拉丁行是该汉字行的罗马化音译（如粤拼），汉字行才是主行；
      // 否则维持「外文主行 + 中文译文」的既有行为（英文歌 + 中文翻译）。
      if (isLatinRomanizationOf(foreignLine, chineseLine)) {
        return { mainLine: chineseLine, romanizedSwap: true };
      }
      return { mainLine: foreignLine, romanizedSwap: false };
    }
  }

  return { mainLine: lines[0], romanizedSwap: false };
}

type HeuristicRole = 'translation' | 'romaji' | 'secondary';

/** 依据主行文字类型给候选行定性。 */
function inferRole(main: ParsedLine, candidate: ParsedLine): HeuristicRole {
  const mainProfile = profileOf(main);
  const candidateProfile = profileOf(candidate);

  if (isJapaneseLike(mainProfile) || isKoreanLike(mainProfile)) {
    if (isPureLatin(candidateProfile)) return 'romaji';
    if (isChineseLike(candidateProfile)) return 'translation';
    return 'secondary';
  }

  if (mainProfile.dominantScript === 'han') {
    return isPureLatin(candidateProfile) ? 'romaji' : 'secondary';
  }

  return isChineseLike(candidateProfile) ? 'translation' : 'secondary';
}

export function classifyGroupLines(group: ParsedLine[]): ClassifiedGroupResult {
  const markedTranslations = group.filter((line) => line.explicitRole === 'translation');
  const markedRomaji = group.filter((line) => line.explicitRole === 'roman');
  const plainLines = group.filter((line) => !line.explicitRole);

  const inlineCarrier = plainLines.find((line) => carriesInlineSecondary(line));
  const heuristicPick = chooseMainLine(plainLines.length > 0 ? plainLines : group);
  const main = inlineCarrier ?? heuristicPick.mainLine;
  // 显式标记优先：源里写了角色就不做推断，也不强制显示罗马音。
  const isRomanized = !inlineCarrier
    && heuristicPick.romanizedSwap
    && markedTranslations.length === 0
    && markedRomaji.length === 0;

  const leftovers = plainLines.filter((line) => line !== main);

  let translationLine: ParsedLine | null = markedTranslations[0] ?? null;
  let romajiLine: ParsedLine | null = markedRomaji[0] ?? null;
  const secondaryLines: ParsedLine[] = [
    ...markedTranslations.slice(1),
    ...markedRomaji.slice(1),
  ];

  const mainHasRomanText = Boolean(main.romanText) || Boolean(main.words?.some((word) => word.romanText));

  for (const line of leftovers) {
    const role = inferRole(main, line);

    if (role === 'translation' && !translationLine && !main.translatedText) {
      translationLine = line;
      continue;
    }
    if (role === 'romaji' && !romajiLine && !mainHasRomanText) {
      romajiLine = line;
      continue;
    }
    secondaryLines.push(line);
  }

  let confidence: ClassificationConfidence = 'heuristic';
  if (main.explicitRole || markedTranslations.length > 0 || markedRomaji.length > 0) {
    confidence = 'explicit';
  } else if (carriesInlineSecondary(main)) {
    confidence = 'parser-native';
  }

  return { main, translationLine, romajiLine, secondaryLines, confidence, isRomanized };
}

/* ==================== 罗马音词对齐 ==================== */

function tidyRomanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

type RomanWordCandidate = { text: string; startMs: number; endMs: number };

function allNonEmpty(words: RomanWordCandidate[]): boolean {
  return words.every((word) => word.text.length > 0);
}

/** 主词自带罗马音时直接使用，缺失则整体放弃。 */
function nativeRomanWords(mainWords: ParsedWord[]): RomanWordCandidate[] | undefined {
  const mapped = mainWords.map((word) => ({
    text: tidyRomanText(word.romanText || ''),
    startMs: word.startMs,
    endMs: word.endMs,
  }));
  return allNonEmpty(mapped) ? mapped : undefined;
}

/** 词数一致且时间偏差都在容差内 → 逐词一一对应。 */
function alignedRomanWords(
  mainWords: ParsedWord[],
  romajiWords: ParsedWord[],
): RomanWordCandidate[] | undefined {
  const aligned = mainWords.every((word, index) => {
    const pair = romajiWords[index];
    return Math.abs(word.startMs - pair.startMs) <= ROMAJI_WORD_TOLERANCE_MS
      && Math.abs(word.endMs - pair.endMs) <= ROMAJI_WORD_TOLERANCE_MS;
  });
  if (!aligned) return undefined;

  const mapped = romajiWords.map((word) => ({
    text: tidyRomanText(word.text),
    startMs: word.startMs,
    endMs: word.endMs,
  }));
  return allNonEmpty(mapped) ? mapped : undefined;
}

/** 时间对不上时，按重叠量（次选中心距）把罗马音片段吸附到主词上。 */
function reassignedRomanWords(
  mainWords: ParsedWord[],
  romajiWords: ParsedWord[],
): RomanWordCandidate[] | undefined {
  const bucketTexts = mainWords.map(() => '');

  for (const romajiWord of romajiWords) {
    const romajiCenter = (romajiWord.startMs + romajiWord.endMs) / 2;
    let target = -1;
    let bestOverlap = Number.NEGATIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < mainWords.length; index += 1) {
      const mainWord = mainWords[index];
      const windowStart = mainWord.startMs - ROMAJI_WORD_TOLERANCE_MS;
      const windowEnd = mainWord.endMs + ROMAJI_WORD_TOLERANCE_MS;
      const overlap = Math.min(windowEnd, romajiWord.endMs) - Math.max(windowStart, romajiWord.startMs);
      const distance = Math.abs((mainWord.startMs + mainWord.endMs) / 2 - romajiCenter);

      if (overlap > bestOverlap || (overlap === bestOverlap && distance < bestDistance)) {
        target = index;
        bestOverlap = overlap;
        bestDistance = distance;
      }
    }

    if (target >= 0) bucketTexts[target] += romajiWord.text;
  }

  const merged = mainWords.map((word, index) => ({
    text: tidyRomanText(bucketTexts[index]),
    startMs: word.startMs,
    endMs: word.endMs,
  }));
  return allNonEmpty(merged) ? merged : undefined;
}

/**
 * 为语义行产出逐词罗马音：优先主词自带 → 时间对齐 → 重叠吸附，
 * 三条路径都拿不到完整结果时返回 undefined（退回整行罗马音文本）。
 */
function resolveRomanWords(main: ParsedLine, romajiLine: ParsedLine | null): SemanticLine['romanWords'] {
  const mainWords = main.words ?? [];
  const romajiWords = romajiLine?.words ?? [];

  if (mainWords.some((word) => word.romanText)) {
    return nativeRomanWords(mainWords);
  }

  if (mainWords.length === 0 || romajiWords.length === 0) {
    return romajiWords.length > 0 ? romajiWords : undefined;
  }

  if (mainWords.length === romajiWords.length) {
    const aligned = alignedRomanWords(mainWords, romajiWords);
    if (aligned) return aligned;
  }

  return reassignedRomanWords(mainWords, romajiWords);
}

/* ==================== 语义行装配 ==================== */

export function buildSemanticLines(lines: ParsedLine[]): SemanticLine[] {
  return splitIntoGroups(lines)
    .map((group) => {
      const { main, translationLine, romajiLine, secondaryLines, confidence, isRomanized } = classifyGroupLines(group);

      const endMs = Math.max(
        main.endMs ?? main.startMs,
        ...group.map((line) => line.endMs ?? line.startMs),
      );
      const secondaryTexts = secondaryLines
        .map((line) => line.text)
        .filter((text) => text.length > 0);

      const semantic: SemanticLine = {
        startMs: main.startMs,
        endMs,
        mainText: main.text,
        mainWords: main.words,
        translationText: main.translatedText || translationLine?.text || undefined,
        romanText: main.romanText || romajiLine?.text || undefined,
        romanWords: resolveRomanWords(main, romajiLine),
        secondaryTexts: secondaryTexts.length > 0 ? secondaryTexts : undefined,
        confidence,
        speaker: undefined,
        isBG: false,
        isDuet: false,
        isDuetPartner: false,
        isRomanized: isRomanized || undefined,
      };
      return semantic;
    })
    .filter((semantic) => semantic.mainText.length > 0 || semantic.translationText || semantic.romanText);
}
