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
      // 酷我 <a,b> 解码结果是"相对行首"的时间（首字 a+b=0 → 相对0）。
      // 必须加上该行行首时间，否则后续行（行首非0）的逐字时间戳会远小于
      // 实际播放时间，播放器判定所有字已"过去"，整行高亮成逐行。
      wordStartMs = Math.abs(Math.floor((a + b) / (kuwoOffset * 2))) + (lineStartMs ?? 0);
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

export function convertLxLyricToEnhancedLrc(lxlyric: string): string {
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

  // 酷我格式是文件级格式，不是逐行格式。逐行判断会导致 b 值全为正数的行
  // 被误判为标准格式，用错误公式计算产生负数/错乱时间戳，该行逐字被丢弃
  // （表现为"只有第一行有逐字"甚至整段无逐字）。
  // 判定：有 [kuwo:xxx] 标签，或全文存在绝对值较大的负 <a,b>（酷我编码值，
  // 标准格式的同步偏移通常只是 -几毫秒的小值）。
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

    // 过滤纯双斜杠/占位符号行（如 "[00:15.20]//" 或 "//"），避免构建出孤立的斜杠歌词
    const bodyTextOnly = line.replace(LRC_LINE_TIMESTAMP_PATTERN, '$2').trim();
    if (/^\s*[\/\\_\-—–]+\s*$/.test(bodyTextOnly)) continue;

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

export interface LxLyricsPayload {
  lyric?: string | null;
  tlyric?: string | null;
  rlyric?: string | null;
  lxlyric?: string | null;
  yrc?: string | null;
  qrc?: string | null;
  eslrc?: string | null;
}

// LX 原生逐字标记：<offset,duration>（可能带负值，酷我格式），offset/duration 是毫秒数字。
// 区别于 Enhanced LRC 的绝对时间戳 <mm:ss.ms>（含冒号）。
const LX_WORD_TIME_MARKER_PATTERN = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/;

function containsLxWordTimeMarkers(text: string): boolean {
  return LX_WORD_TIME_MARKER_PATTERN.test(text);
}

export function buildLxLyricsRaw(payload: LxLyricsPayload): string {
  const parts: string[] = [];
  const yrc = payload.yrc?.trim();
  const qrc = payload.qrc?.trim();
  const eslrc = payload.eslrc?.trim();
  const lxlyric = payload.lxlyric?.trim();

  // 优先保留平台原生逐字格式，交给后端 AMLL 解析器处理。
  // 只有没有 yrc/qrc/eslrc 时，才把 LX 专用 lxlyric 转成 Enhanced LRC。
  if (yrc) {
    parts.push(yrc);
  } else if (qrc) {
    parts.push(qrc);
  } else if (eslrc) {
    parts.push(eslrc);
  } else if (lxlyric) {
    const enhancedLrc = convertLxLyricToEnhancedLrc(lxlyric);
    // 若 lxlyric 无法按 <offset,duration> 转换（例如内容实为 yrc 风格
    // `[ms,ms](start,dur,0)字` 标记），仍把原文交给 AMLL 尝试按 yrc 解析，
    // 避免逐字内容被静默丢弃、回退成普通 LRC。
    if (enhancedLrc) parts.push(enhancedLrc);
    else parts.push(lxlyric);
  } else {
    const lyric = payload.lyric?.trim();
    if (lyric) {
      // 有些 LX 插件把逐字歌词直接放在 lyric 字段里（LX 原生 <offset,duration>
      // 标记），而非独立的 lxlyric/yrc 字段。若原样保留，后端 AMLL 解析器认不出
      // <数字,数字> 标记（它只认绝对时间戳 <mm:ss.ms> 或 yrc 的 [ms,ms](...)），
      // 逐字会静默丢失、回退成普通 LRC。因此检测到该标记时转成 Enhanced LRC。
      if (containsLxWordTimeMarkers(lyric)) {
        const enhancedLrc = convertLxLyricToEnhancedLrc(lyric);
        if (enhancedLrc) parts.push(enhancedLrc);
        else parts.push(lyric);
      } else {
        parts.push(lyric);
      }
    }
  }

  const tlyric = payload.tlyric?.trim();
  const rlyric = payload.rlyric?.trim();
  if (tlyric) parts.push(tlyric);
  if (rlyric) parts.push(rlyric);

  return parts.join('\n');
}
