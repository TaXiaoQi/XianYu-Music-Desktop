/**
 * Baka / MusicFree 歌词专用构建器。
 *
 * 只处理 Baka/MF 插件自身返回的歌词字段，不调用 LX 歌词接口，
 * 也不依赖 LX 专用构建器，避免两条歌词链路互相串线。
 */

const LRC_LINE_TIMESTAMP_PATTERN = /^\[(\d+:\d{2}(?:\.\d+)?)](.*)$/;
const ENHANCED_TIMESTAMP_PATTERN = /<\d+:\d{2}(?:\.\d+)?>/;

interface WordTimeEntry {
  index: number;
  endIndex: number;
  startMs: number;
  endMs: number;
}

function parseTimestampToMs(raw: string): number | null {
  const match = /^(\d+):(\d{2})(?:\.(\d{1,4}))?$/.exec(raw.trim());
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const milliseconds = Number((match[3] ?? '').padEnd(3, '0').slice(0, 3) || '0');

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(milliseconds)) {
    return null;
  }
  if (seconds >= 60) return null;

  return (minutes * 60 * 1000) + (seconds * 1000) + milliseconds;
}

function msToTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = safeMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function buildEnhancedBody(body: string, entries: WordTimeEntry[]): string {
  if (entries.length === 0) return '';

  const firstEntry = entries[0];
  const hasTextBeforeFirstMarker = body.slice(0, firstEntry.index).trim().length > 0;
  let convertedBody = '';

  if (hasTextBeforeFirstMarker) {
    let lastEnd = 0;
    for (const entry of entries) {
      const text = body.slice(lastEnd, entry.index);
      if (text) convertedBody += `<${msToTimestamp(entry.startMs)}>${text}`;
      lastEnd = entry.endIndex;
    }
    const tail = body.slice(lastEnd);
    if (tail) convertedBody += tail;
  } else {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const nextEntry = entries[index + 1];
      const textStart = entry.endIndex;
      const textEnd = nextEntry?.index ?? body.length;
      const text = body.slice(textStart, textEnd);
      if (text) convertedBody += `<${msToTimestamp(entry.startMs)}>${text}`;
    }
  }

  convertedBody += `<${msToTimestamp(entries[entries.length - 1].endMs)}>`;
  return convertedBody;
}

function normalizeEntriesForEnhanced(entries: WordTimeEntry[]): WordTimeEntry[] {
  let previousStart = 0;
  return entries.map((entry, index) => {
    const startMs = index === 0
      ? Math.max(0, entry.startMs)
      : Math.max(previousStart, entry.startMs);
    const endMs = Math.max(startMs, entry.endMs);
    previousStart = startMs;

    return { ...entry, startMs, endMs };
  });
}

interface WordTimeCandidate {
  entries: WordTimeEntry[];
  score: number;
}

function buildWordTimeCandidate(
  wordTimes: RegExpMatchArray[],
  lineStartMs: number | null,
  mode: 'relative' | 'kuwo',
  kuwoOffset: number,
  kuwoOffset2: number,
): WordTimeCandidate | null {
  if (mode === 'relative' && lineStartMs === null) return null;
  if (mode === 'kuwo' && (kuwoOffset <= 0 || kuwoOffset2 <= 0)) return null;

  const entries: WordTimeEntry[] = [];
  let invalidCount = 0;
  let backwardCount = 0;
  let previousStart: number | null = null;

  for (const wordTime of wordTimes) {
    const a = Number(wordTime[1]);
    const b = Number(wordTime[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      invalidCount++;
      continue;
    }

    let wordStartMs: number;
    let wordEndMs: number;

    if (mode === 'kuwo') {
      wordStartMs = Math.abs(Math.floor((a + b) / (kuwoOffset * 2)));
      wordEndMs = Math.abs(Math.floor((a - b) / (kuwoOffset2 * 2))) + wordStartMs;
    } else {
      wordStartMs = (lineStartMs as number) + a;
      wordEndMs = wordStartMs + b;
    }

    if (!Number.isFinite(wordStartMs) || !Number.isFinite(wordEndMs) || wordEndMs < wordStartMs) {
      invalidCount++;
    }
    if (previousStart !== null && wordStartMs < previousStart) {
      backwardCount++;
    }
    previousStart = wordStartMs;

    entries.push({
      index: wordTime.index ?? 0,
      endIndex: (wordTime.index ?? 0) + wordTime[0].length,
      startMs: wordStartMs,
      endMs: wordEndMs,
    });
  }

  if (entries.length === 0) return null;

  const firstStart = entries[0].startMs;
  const lineDistance = lineStartMs === null ? 0 : Math.abs(firstStart - lineStartMs);
  const negativeStartPenalty = entries.some(entry => entry.startMs < 0) ? 100_000 : 0;
  const score = (invalidCount * 1_000_000)
    + (backwardCount * 100_000)
    + negativeStartPenalty
    + lineDistance;

  return { entries: normalizeEntriesForEnhanced(entries), score };
}

function selectWordTimeEntries(
  wordTimes: RegExpMatchArray[],
  lineStartMs: number | null,
  forceKuwo: boolean,
  lineHasNegativeWordTime: boolean,
  kuwoOffset: number,
  kuwoOffset2: number,
): WordTimeEntry[] {
  const kuwoCandidate = buildWordTimeCandidate(wordTimes, lineStartMs, 'kuwo', kuwoOffset, kuwoOffset2);
  const relativeCandidate = buildWordTimeCandidate(wordTimes, lineStartMs, 'relative', kuwoOffset, kuwoOffset2);

  if (forceKuwo || lineStartMs === null) {
    return kuwoCandidate?.entries ?? relativeCandidate?.entries ?? [];
  }
  if (lineHasNegativeWordTime) {
    const best = [relativeCandidate, kuwoCandidate]
      .filter((candidate): candidate is WordTimeCandidate => candidate !== null)
      .sort((left, right) => left.score - right.score)[0];
    return best?.entries ?? [];
  }

  const best = [relativeCandidate, kuwoCandidate]
    .filter((candidate): candidate is WordTimeCandidate => candidate !== null)
    .sort((left, right) => left.score - right.score)[0];
  return best?.entries ?? [];
}

function convertPluginLxLyricToEnhancedLrc(lxlyric: string): string {
  const lines = lxlyric.split(/\r?\n/);
  const result: string[] = [];
  let convertedCount = 0;

  const wordTimePattern = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;
  const kuwoTagPattern = /^\[kuwo:\s*(\S+)\s*\]/i;
  let kuwoOffset = 1;
  let kuwoOffset2 = 1;
  let hasKuwoTag = false;

  for (const rawLine of lines) {
    const match = kuwoTagPattern.exec(rawLine.trim());
    if (match) {
      hasKuwoTag = true;
      const content = match[1].split('][')[0];
      const value = parseInt(content.trim(), 8) || 0;
      kuwoOffset = Math.floor(value / 10) || 1;
      kuwoOffset2 = value % 10 || 1;
    }
  }

  // 酷我格式是文件级格式，不是逐行格式。逐行判断会让 b 值全为正数的行
  // 被误判为标准格式，用错误公式产生负数/错乱时间戳，该行逐字被丢弃
  // （表现为"只有第一行有逐字"甚至整段无逐字）。
  // 判定：有 [kuwo:xxx] 标签，或全文存在绝对值较大的负 <a,b>（标准格式的
  // 同步偏移通常只是 -几毫秒的小值）。
  const isKuwoSource = hasKuwoTag || (function checkKuwoValues() {
    const checkRe = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;
    for (const l of lines) {
      for (const wt of l.matchAll(checkRe)) {
        const a = Number(wt[1]);
        const b = Number(wt[2]);
        if (a < -500 || b < -500) return true;
      }
    }
    return false;
  })();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || kuwoTagPattern.test(line)) continue;

    wordTimePattern.lastIndex = 0;
    if (ENHANCED_TIMESTAMP_PATTERN.test(line) && !wordTimePattern.test(line)) {
      result.push(line);
      convertedCount++;
      continue;
    }

    wordTimePattern.lastIndex = 0;
    const lineMatch = LRC_LINE_TIMESTAMP_PATTERN.exec(line);
    const lineStartStr = lineMatch?.[1] ?? null;
    const lineStartMs = lineStartStr ? parseTimestampToMs(lineStartStr) : null;
    const body = lineMatch ? lineMatch[2] : line;
    const wordTimes = [...body.matchAll(wordTimePattern)];

    if (wordTimes.length === 0) {
      if (lineStartStr && lineStartMs !== null) result.push(line);
      continue;
    }

    const lineHasNegativeWordTime = wordTimes.some(wordTime => (
      Number(wordTime[1]) < 0 || Number(wordTime[2]) < 0
    ));
    const entries = selectWordTimeEntries(
      wordTimes,
      lineStartMs,
      isKuwoSource,
      lineHasNegativeWordTime,
      kuwoOffset,
      kuwoOffset2,
    );
    if (entries.length === 0) continue;

    const convertedBody = buildEnhancedBody(body, entries);
    if (!convertedBody) continue;

    const finalLineStart = lineStartStr && lineStartMs !== null
      ? msToTimestamp(lineStartMs)
      : msToTimestamp(entries[0]?.startMs ?? 0);

    result.push(`[${finalLineStart}]${convertedBody}`);
    convertedCount++;
  }

  return convertedCount > 0 ? result.join('\n') : '';
}

/**
 * 把「(偏移,时长)」标记的词时间解释为绝对词起始时间。
 * JOOX qrc 的词偏移是相对整曲的绝对时间；结构自洽地逐行判定（见 scoreKrcMode）。
 * 用 walking-max 保证行内时间单调递增，避免 AMLL 因时间回退丢弃整行。
 */
function buildKrcWordTimes(
  markers: RegExpMatchArray[],
  lineStartMs: number,
  mode: 'absolute' | 'relative',
): WordTimeEntry[] {
  const entries: WordTimeEntry[] = [];
  let previousStart = -Infinity;

  for (const marker of markers) {
    const offset = Number(marker[1]);
    const duration = Number(marker[2]);
    if (!Number.isFinite(offset) || !Number.isFinite(duration)) continue;

    const base = mode === 'absolute' ? offset : lineStartMs + offset;
    const startMs = Math.max(previousStart, base);
    const endMs = Math.max(startMs, base + Math.max(0, duration));
    previousStart = startMs;

    entries.push({
      index: marker.index ?? 0,
      endIndex: (marker.index ?? 0) + marker[0].length,
      startMs,
      endMs,
    });
  }

  return entries;
}

/**
 * 逐行评估某一种解释（绝对/相对）在结构上的自洽程度，分数越高越可信：
 *  - 词起始时间早于行首 → 绝对解释的重大嫌疑（标准酷狗相对偏移首词≈0，远远早于行首）；
 *  - 词起始时间越过行窗口 → 修正次要解释；
 *  - 行内时间回退 → 解释错误（真实标记不会倒序）；
 *  - 首词偏移对齐微调：绝对偏好「首词偏移≈行首」，相对偏好「首词偏移≈0」。
 */
function scoreKrcMode(
  mode: 'absolute' | 'relative',
  markers: RegExpMatchArray[],
  times: WordTimeEntry[],
  lineStartMs: number,
  lineDurMs: number,
): number {
  let score = 0;
  let previousStart = -Infinity;
  let backward = 0;
  let beforeLineStart = 0;
  let beyondWindow = 0;

  for (const entry of times) {
    if (entry.startMs < previousStart) backward++;
    previousStart = entry.startMs;
    if (entry.startMs < lineStartMs) beforeLineStart++;
    if (entry.startMs > lineStartMs + lineDurMs) beyondWindow++;
  }

  score -= beforeLineStart * 1_000_000;
  score -= beyondWindow * 50_000;
  score -= backward * 10_000;

  const firstOffset = markers.length > 0 ? Number(markers[0][1]) : NaN;
  if (Number.isFinite(firstOffset)) {
    score -= mode === 'absolute'
      ? Math.abs(firstOffset - lineStartMs)
      : Math.abs(firstOffset);
  }

  return score;
}

/**
 * 将"KRC 风格"逐字歌词转换为 AMLL 可消费的 Enhanced LRC。
 *
 * JOOX 插件的 qrc 与标准酷狗 KRC 结构相同（`[行首,行内时长](词偏移,词时长)文字...`），
 * 但 JOOX 的词偏移是绝对时间（相对整曲），酷狗是相对行内的偏移。二者仅解释不同，
 * 且是逐行语义而非整份文件同一种解释。旧实现用「整份歌词一个全局布尔值」判定，
 * 一旦有少数几行（如前奏间隔、首词带引导文字）不满足多数对齐阈值，整份就被判成
 * 相对偏移，导致后半段全部翻倍错位（表现为"只首行显示/其他全黑"）。
 *
 * 这里改为对每一行分别评估绝对/相对两种解释，选结构上更自洽的一种，逐行各自正确。
 */
function convertKugouKrcToEnhancedLrc(krc: string): string {
  const lines = krc.split(/\r?\n/);
  const result: string[] = [];
  let convertedCount = 0;
  const linePattern = /^\[(\d+),(\d+)](.*)$/;
  const wordTimePattern = /\((-?\d+),(-?\d+)(?:,-?\d+)?\)/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const lineMatch = linePattern.exec(line);
    if (!lineMatch) continue;

    const lineStartMs = Number(lineMatch[1]);
    const lineDurMs = Number(lineMatch[2]);
    const body = lineMatch[3] ?? '';
    if (!Number.isFinite(lineStartMs) || !Number.isFinite(lineDurMs) || !body) continue;

    wordTimePattern.lastIndex = 0;
    const wordTimes = [...body.matchAll(wordTimePattern)];
    if (wordTimes.length === 0) continue;

    const absoluteTimes = buildKrcWordTimes(wordTimes, lineStartMs, 'absolute');
    if (absoluteTimes.length === 0) continue;

    const relativeTimes = buildKrcWordTimes(wordTimes, lineStartMs, 'relative');
    const absoluteScore = scoreKrcMode('absolute', wordTimes, absoluteTimes, lineStartMs, lineDurMs);
    const relativeScore = scoreKrcMode('relative', wordTimes, relativeTimes, lineStartMs, lineDurMs);
    // 平手时取绝对解释：JOOX 是绝对偏移的原始来源；对首行（行首≈0）两种解释结果一致。
    const chosen = absoluteScore >= relativeScore ? absoluteTimes : relativeTimes;

    const convertedBody = buildEnhancedBody(body, chosen);
    if (!convertedBody) continue;
    result.push(`[${msToTimestamp(lineStartMs)}]${convertedBody}`);
    convertedCount++;
  }

  return convertedCount > 0 ? result.join('\n') : '';
}

function isKugouKrcLike(content: string): boolean {
  return /^\[\d+,\d+].*\(-?\d+,-?\d+(?:,-?\d+)?\)/m.test(content);
}

export interface BakaMfLyricsPayload {
  ttml?: string | null;
  lyric?: string | null;
  tlyric?: string | null;
  rlyric?: string | null;
  lxlyric?: string | null;
  yrc?: string | null;
  qrc?: string | null;
  eslrc?: string | null;
}

export function buildBakaMfLyricsRaw(payload: BakaMfLyricsPayload): string {
  const parts: string[] = [];

  const ttml = payload.ttml?.trim();
  const yrc = payload.yrc?.trim();
  const qrc = payload.qrc?.trim();
  const eslrc = payload.eslrc?.trim();
  const lxlyric = payload.lxlyric?.trim();
  const lyric = payload.lyric?.trim();

  let wordLevelContent = '';
  // ttml 是 Baka 插件（JOOX 等）的 XML 逐字歌词，后端 AMLL 的 parseTTML 可直接解析，原样透传。
  if (ttml) {
    wordLevelContent = ttml;
  } else if (yrc) {
    wordLevelContent = yrc;
  } else if (qrc) {
    wordLevelContent = qrc;
  } else if (eslrc) {
    wordLevelContent = eslrc;
  } else if (lxlyric) {
    wordLevelContent = convertPluginLxLyricToEnhancedLrc(lxlyric);
  } else if (lyric && isKugouKrcLike(lyric)) {
    wordLevelContent = convertKugouKrcToEnhancedLrc(lyric);
  } else if (lyric) {
    // 无逐字字段，保留纯 LRC 走普通行
  }

  if (wordLevelContent) {
    parts.push(wordLevelContent);
  } else if (lyric) {
    parts.push(lyric);
  }

  if (parts.length === 0) return '';

  const tlyric = payload.tlyric?.trim();
  const rlyric = payload.rlyric?.trim();
  if (tlyric) parts.push(tlyric);
  if (rlyric) parts.push(rlyric);

  return parts.join('\n');
}
