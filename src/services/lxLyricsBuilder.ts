/**
 * LX/落雪歌词专用构建器。
 *
 * LX 返回的逐字歌词格式与普通插件歌词不完全一致，尤其酷我歌词可能经历过
 * Rust 后端 kw_parse_lxlyric 预处理：带行时间戳，但逐字标签是相对行首的
 * <offset,duration>，offset 可能为负数。这里单独处理，避免被通用歌词构建逻辑误判。
 */

const LRC_LINE_TIMESTAMP_PATTERN = /^\[(\d+:\d{2}(?:\.\d+)?)](.*)$/;
const ENHANCED_TIMESTAMP_PATTERN = /<\d+:\d{2}(?:\.\d+)?>/;

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

function convertLxLyricToEnhancedLrc(lxlyric: string): string {
  const lines = lxlyric.split(/\r?\n/);
  const result: string[] = [];
  let convertedCount = 0;

  const wordTimePattern = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;
  const kuwoTagPattern = /^\[kuwo:\s*(\S+)\s*\]/i;
  let kuwoOffset = 1;
  let kuwoOffset2 = 1;
  let hasKuwoTag = false;
  let hasNegativeWordTime = false;

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

    wordTimePattern.lastIndex = 0;
    for (const wordTime of rawLine.matchAll(wordTimePattern)) {
      if (Number(wordTime[1]) < 0 || Number(wordTime[2]) < 0) {
        hasNegativeWordTime = true;
        break;
      }
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

    // 后端已处理过的 LX/KW 歌词：有行时间戳，按标准 <相对偏移,持续时间> 解析。
    // 原始酷我歌词：通常带 [kuwo:]，可能没有行时间戳，此时按酷我公式解析。
    const useKuwoFormula = hasKuwoTag || (lineStartMs === null && hasNegativeWordTime);
    if (!useKuwoFormula && lineStartMs === null) continue;

    let convertedBody = '';
    let lastEnd = 0;
    let firstWordStartMs: number | null = null;
    let lastWordEndMs = 0;

    for (const wordTime of wordTimes) {
      const a = Number(wordTime[1]);
      const b = Number(wordTime[2]);
      let wordStartMs: number;
      let wordEndMs: number;

      if (useKuwoFormula) {
        wordStartMs = Math.abs(Math.floor((a + b) / (kuwoOffset * 2)));
        wordEndMs = Math.abs(Math.floor((a - b) / (kuwoOffset2 * 2))) + wordStartMs;
      } else {
        wordStartMs = (lineStartMs as number) + a;
        wordEndMs = wordStartMs + b;
      }

      if (firstWordStartMs === null) firstWordStartMs = wordStartMs;
      convertedBody += body.substring(lastEnd, wordTime.index);
      convertedBody += `<${msToTimestamp(wordStartMs)}>`;
      lastEnd = (wordTime.index ?? 0) + wordTime[0].length;
      lastWordEndMs = wordEndMs;
    }

    convertedBody += body.substring(lastEnd);
    convertedBody += `<${msToTimestamp(lastWordEndMs)}>`;

    const finalLineStart = lineStartStr && lineStartMs !== null
      ? msToTimestamp(lineStartMs)
      : msToTimestamp(firstWordStartMs ?? 0);

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
  const lxlyric = payload.lxlyric?.trim();

  if (lxlyric) {
    const enhancedLrc = convertLxLyricToEnhancedLrc(lxlyric);
    if (enhancedLrc) parts.push(enhancedLrc);
  }

  if (parts.length === 0) {
    const yrc = payload.yrc?.trim();
    const qrc = payload.qrc?.trim();
    const lyric = payload.lyric?.trim();
    if (yrc) parts.push(yrc);
    else if (qrc) parts.push(qrc);
    else if (lyric) parts.push(lyric);
  }

  const tlyric = payload.tlyric?.trim();
  const rlyric = payload.rlyric?.trim();
  if (tlyric) parts.push(tlyric);
  if (rlyric) parts.push(rlyric);

  return parts.join('\n');
}
