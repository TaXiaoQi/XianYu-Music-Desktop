/**
 * LX/落雪歌词专用构建器。
 *
 * LX 返回的逐字歌词格式与普通插件歌词不完全一致，尤其酷我歌词可能经历过
 * Rust 后端 kw_parse_lxlyric 预处理：带行时间戳，但逐字标签是相对行首的
 * <offset,duration>，offset 可能为负数。这里单独处理，避免被通用歌词构建逻辑误判。
 */

const LRC_LINE_TIMESTAMP_PATTERN = /^\[(\d+:\d{2}(?:\.\d+)?)](.*)$/;
const ENHANCED_TIMESTAMP_PATTERN = /<\d+:\d{2}(?:\.\d+)?>/;

interface WordTimeEntry {
  index: number;
  endIndex: number;
  startMs: number;
  endMs: number;
}

interface WordTimeCandidate {
  entries: WordTimeEntry[];
  score: number;
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

  // LX/KG 常见格式：<offset,duration>字；酷我原始 lyricx 常见格式：字<offset,duration>。
  // Enhanced LRC 要求每行正文必须以 <绝对时间> 开头，否则后端会按普通 LRC 解析，逐字会丢失。
  const firstEntry = entries[0];
  const hasTextBeforeFirstMarker = body.slice(0, firstEntry.index).trim().length > 0;
  let convertedBody = '';

  if (hasTextBeforeFirstMarker) {
    let lastEnd = 0;
    for (const entry of entries) {
      const text = body.slice(lastEnd, entry.index);
      if (text) {
        convertedBody += `<${msToTimestamp(entry.startMs)}>${text}`;
      }
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
      if (text) {
        convertedBody += `<${msToTimestamp(entry.startMs)}>${text}`;
      }
    }
  }

  const lastEndMs = entries[entries.length - 1].endMs;
  convertedBody += `<${msToTimestamp(lastEndMs)}>`;
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

    return {
      ...entry,
      startMs,
      endMs,
    };
  });
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

  return {
    entries: normalizeEntriesForEnhanced(entries),
    score,
  };
}

function selectWordTimeEntries(
  wordTimes: RegExpMatchArray[],
  lineStartMs: number | null,
  hasKuwoTag: boolean,
  lineHasNegativeWordTime: boolean,
  kuwoOffset: number,
  kuwoOffset2: number,
): WordTimeEntry[] {
  const kuwoCandidate = buildWordTimeCandidate(wordTimes, lineStartMs, 'kuwo', kuwoOffset, kuwoOffset2);
  const relativeCandidate = buildWordTimeCandidate(wordTimes, lineStartMs, 'relative', kuwoOffset, kuwoOffset2);

  if (hasKuwoTag || lineStartMs === null) {
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

function convertLxLyricToEnhancedLrc(lxlyric: string): string {
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
      continue;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || kuwoTagPattern.test(line)) continue;

    // 如果已经是 Enhanced LRC，直接保留。
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
      hasKuwoTag,
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

export interface LxLyricsPayload {
  lyric?: string | null;
  tlyric?: string | null;
  rlyric?: string | null;
  lxlyric?: string | null;
  yrc?: string | null;
  qrc?: string | null;
}

export function buildLxLyricsRaw(payload: LxLyricsPayload): string {
  const parts: string[] = [];
  const yrc = payload.yrc?.trim();
  const qrc = payload.qrc?.trim();
  const lxlyric = payload.lxlyric?.trim();

  // 优先保留平台原生逐字格式，交给后端 AMLL 解析器处理。
  // 只有没有 yrc/qrc 时，才把 LX 专用 lxlyric 转成 Enhanced LRC。
  if (yrc) {
    parts.push(yrc);
  } else if (qrc) {
    parts.push(qrc);
  } else if (lxlyric) {
    const enhancedLrc = convertLxLyricToEnhancedLrc(lxlyric);
    if (enhancedLrc) parts.push(enhancedLrc);
  }

  if (parts.length === 0) {
    const lyric = payload.lyric?.trim();
    if (lyric) parts.push(lyric);
  }

  const tlyric = payload.tlyric?.trim();
  const rlyric = payload.rlyric?.trim();
  if (tlyric) parts.push(tlyric);
  if (rlyric) parts.push(rlyric);

  return parts.join('\n');
}
