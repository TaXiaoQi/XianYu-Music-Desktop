/**
 * 翻译/音译子行的同步扫光：与播放器补丁共享的常量与进度计算。
 *
 * 背景：AMLL 的子行是固定透明度的静态暗行（库 CSS `._lyricSubLine_ { opacity: .3 }`），
 * 只有主行有词级遮罩扫光，所以翻译看着「没有高光」。这里算出行的演唱进度，由补丁写进
 * 行元素的 CSS 变量，再由 LyricsView 的遮罩把子行也扫亮。
 *
 * 译文没有自己的逐字时间，所以进度不是简单按时间匀速推进，而是**跟着主行的词级节奏**：
 * 每个词按它在原句中的字数占权，已唱完的词整份计入、正在唱的词按时间比例计入。于是
 * 主行唱得快译文就快、遇到词间空隙译文也停住，整行结束时恰好扫完，不会提前结束。
 */

/** 库的 CSS Modules 类名主体（构建后形如 `_lyricSubLine_ut4sn_136`） */
export const SUB_LINE_CLASS_FRAGMENT = '_lyricSubLine_';
/** 由播放器补丁写在行元素上、被子行继承的进度变量 */
export const SUB_LINE_PROGRESS_VAR = '--xy-sub-line-progress';
/**
 * 子行文本的包裹层类名。遮罩挂在它上面：inline-block 使其宽度恰好等于文本宽度，
 * 扫光因此正好覆盖文本，不会因为翻译比整行短而提前扫完。
 */
export const SUB_LINE_TEXT_CLASS = 'xy-sub-line-text';

interface WordTiming {
  startTime?: number;
  endTime?: number;
  word?: string;
}

interface LineTiming {
  startTime: number;
  endTime: number;
  words?: WordTiming[];
}

interface NormalizedWord {
  start: number;
  end: number;
  weight: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 筛出时间有效的词，并按字数给出权重（缺文本时按等权处理）。 */
function normalizeWords(line: LineTiming): NormalizedWord[] {
  return (line.words ?? [])
    .filter(
      (word): word is { startTime: number; endTime: number } & WordTiming =>
        typeof word.startTime === 'number' &&
        typeof word.endTime === 'number' &&
        Number.isFinite(word.startTime) &&
        Number.isFinite(word.endTime) &&
        word.endTime > word.startTime,
    )
    .map((word) => ({
      start: word.startTime,
      end: word.endTime,
      weight: Math.max(1, (word.word ?? '').replace(/\s+/g, '').length),
    }))
    .sort((left, right) => left.start - right.start);
}

/** 无逐词时间时的兜底：整行（或整段词区间）线性推进。 */
export function resolveSubLineProgressRange(line: LineTiming): [number, number] {
  const words = normalizeWords(line);
  if (words.length > 0) {
    return [words[0].start, words[words.length - 1].end];
  }
  return [line.startTime, line.endTime];
}

function linearProgress(currentTime: number, line: LineTiming): number {
  const [start, end] = resolveSubLineProgressRange(line);
  const span = end - start;
  if (span > 0) return clamp01((currentTime - start) / span);
  return currentTime >= start ? 1 : 0;
}

/** 按词的权重累计：唱完的词整份计入，正在唱的词按在其时长内的比例计入，空隙处保持不动。 */
function weightedWordProgress(currentTime: number, words: NormalizedWord[]): number {
  const total = words.reduce((sum, word) => sum + word.weight, 0);
  if (total <= 0) return 0;

  let done = 0;
  for (const word of words) {
    if (currentTime >= word.end) {
      done += word.weight;
      continue;
    }
    if (currentTime <= word.start) break;

    done += word.weight * clamp01((currentTime - word.start) / (word.end - word.start));
    break;
  }
  return clamp01(done / total);
}

/** 返回可直接写入 CSS 变量的百分比字符串。 */
export function resolveSubLineProgressValue(currentTime: number, line: LineTiming): string {
  const words = normalizeWords(line);
  const progress = words.length > 0
    ? weightedWordProgress(currentTime, words)
    : linearProgress(currentTime, line);

  return `${(progress * 100).toFixed(2)}%`;
}
