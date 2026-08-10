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

function convertPluginLxLyricToEnhancedLrc(lxlyric: string): string {
  const lines = lxlyric.split(/\r?\n/);
  const result: string[] = [];
  let convertedCount = 0;
  const wordTimePattern = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

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
    if (lineStartMs === null) continue;

    const entries: WordTimeEntry[] = [];
    for (const wordTime of wordTimes) {
      const offset = Number(wordTime[1]);
      const duration = Number(wordTime[2]);
      const startMs = lineStartMs + offset;
      entries.push({
        index: wordTime.index ?? 0,
        endIndex: (wordTime.index ?? 0) + wordTime[0].length,
        startMs,
        endMs: startMs + duration,
      });
    }

    const convertedBody = buildEnhancedBody(body, entries);
    if (!convertedBody) continue;
    result.push(`[${msToTimestamp(lineStartMs)}]${convertedBody}`);
    convertedCount++;
  }

  return convertedCount > 0 ? result.join('\n') : '';
}

export interface BakaMfLyricsPayload {
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

  const yrc = payload.yrc?.trim();
  const qrc = payload.qrc?.trim();
  const eslrc = payload.eslrc?.trim();
  const lxlyric = payload.lxlyric?.trim();
  const lyric = payload.lyric?.trim();

  let wordLevelContent = '';
  if (yrc) {
    wordLevelContent = yrc;
  } else if (qrc) {
    wordLevelContent = qrc;
  } else if (eslrc) {
    wordLevelContent = eslrc;
  } else if (lxlyric) {
    wordLevelContent = convertPluginLxLyricToEnhancedLrc(lxlyric);
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
