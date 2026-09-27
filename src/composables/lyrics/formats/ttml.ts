/**
 * TTML（Apple Music 风格逐词 XML）解析。
 *
 * 内嵌一个轻量 XML 扫描器来复刻上游 XML 库的事件序列：
 * 开始与自闭合标签共用同一套分发（自闭合不会产生结束事件），
 * 文本事件做实体反转义而属性值保持原文；结构性错误令整篇解析失败。
 * 解析产物不做任何排序或钳制，行时间完全来自 begin/end 属性。
 */

import type { AmlLyricLine, AmlLyricWord } from '../types';

type XmlAttr = { name: string; value: string };

type XmlToken =
  | { kind: 'start' | 'empty'; name: string; attrs: XmlAttr[]; malformed: boolean }
  | { kind: 'end'; name: string }
  | { kind: 'text'; raw: string };

/** 状态编号：与上游解析器的 16 个状态一一对应。 */
const S = {
  None: 0,
  InTtml: 1,
  InHead: 2,
  InMetadata: 3,
  InITunesMetadata: 4,
  InITunesTranslation: 5,
  InBody: 6,
  InDiv: 7,
  InP: 8,
  InSpan: 9,
  InTranslationSpan: 10,
  InRomanSpan: 11,
  InBackgroundSpan: 12,
  InSpanInBackgroundSpan: 13,
  InTranslationSpanInBackgroundSpan: 14,
  InRomanSpanInBackgroundSpan: 15,
} as const;
type TtmlStatus = (typeof S)[keyof typeof S];

function isNameChar(ch: string): boolean {
  return !/[\s=/>]/.test(ch);
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * 把整篇 XML 切成事件流。注释、CDATA、处理指令、DOCTYPE 不产生事件
 * （CDATA 在上游同样被丢弃）；文本段原样保留，转义延后处理。
 */
function tokenizeXml(src: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  let i = 0;

  while (i < src.length) {
    if (src[i] !== '<') {
      const next = src.indexOf('<', i);
      const end = next === -1 ? src.length : next;
      tokens.push({ kind: 'text', raw: src.slice(i, end) });
      i = end;
      continue;
    }

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end === -1) throw new Error('ttml: unterminated comment');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end === -1) throw new Error('ttml: unterminated cdata');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end === -1) throw new Error('ttml: unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!', i)) {
      const end = src.indexOf('>', i + 2);
      if (end === -1) throw new Error('ttml: unterminated declaration');
      i = end + 1;
      continue;
    }
    if (src.startsWith('</', i)) {
      const gt = src.indexOf('>', i + 2);
      if (gt === -1) throw new Error('ttml: unterminated end tag');
      tokens.push({ kind: 'end', name: src.slice(i + 2, gt).trim() });
      i = gt + 1;
      continue;
    }

    i += 1;
    const nameStart = i;
    while (i < src.length && isNameChar(src[i])) i += 1;
    const name = src.slice(nameStart, i);
    if (name.length === 0) throw new Error('ttml: empty tag name');

    const attrs: XmlAttr[] = [];
    let malformed = false;
    let selfClosing = false;

    for (;;) {
      while (i < src.length && isWhitespace(src[i])) i += 1;
      if (i >= src.length) throw new Error('ttml: unterminated tag');
      if (src[i] === '>') {
        i += 1;
        break;
      }
      if (src[i] === '/' && src[i + 1] === '>') {
        selfClosing = true;
        i += 2;
        break;
      }

      const attrStart = i;
      while (i < src.length && isNameChar(src[i])) i += 1;
      const attrName = src.slice(attrStart, i);
      while (i < src.length && isWhitespace(src[i])) i += 1;
      if (attrName.length === 0 || src[i] !== '=') {
        malformed = true;
        continue;
      }
      i += 1;
      while (i < src.length && isWhitespace(src[i])) i += 1;
      const quote = src[i];
      if (quote !== '"' && quote !== "'") {
        malformed = true;
        continue;
      }
      const valueEnd = src.indexOf(quote, i + 1);
      if (valueEnd === -1) throw new Error('ttml: unterminated attribute value');
      attrs.push({ name: attrName, value: src.slice(i + 1, valueEnd) });
      i = valueEnd + 1;
    }

    tokens.push(
      selfClosing
        ? { kind: 'empty', name, attrs, malformed }
        : { kind: 'start', name, attrs, malformed },
    );
  }

  return tokens;
}

/** 文本实体的最小反转义；遇到未知实体即抛错（上游同样视为损坏输入）。 */
function decodeXmlEntities(raw: string): string {
  if (!raw.includes('&')) return raw;

  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '&') {
      out += ch;
      continue;
    }
    const semi = raw.indexOf(';', i);
    if (semi === -1) throw new Error('ttml: broken entity');
    const body = raw.slice(i + 1, semi);
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new Error('ttml: bad char ref');
      out += String.fromCodePoint(code);
    } else if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new Error('ttml: bad char ref');
      out += String.fromCodePoint(code);
    } else if (body === 'amp') out += '&';
    else if (body === 'lt') out += '<';
    else if (body === 'gt') out += '>';
    else if (body === 'quot') out += '"';
    else if (body === 'apos') out += "'";
    else throw new Error('ttml: unknown entity');
    i = semi;
  }
  return out;
}

/**
 * 迭代某标签的全部属性；属性残缺或重名都会抛错，
 * 与上游"属性迭代器产出 Err 即整体失败"的语义一致。
 */
function readAttrs(token: Extract<XmlToken, { kind: 'start' | 'empty' }>): XmlAttr[] {
  if (token.malformed) throw new Error('ttml: malformed attribute');
  const seen = new Set<string>();
  for (const attr of token.attrs) {
    if (seen.has(attr.name)) throw new Error('ttml: duplicate attribute');
    seen.add(attr.name);
  }
  return token.attrs;
}

function takeDigits(src: string, pos: number, min: number, max: number): [number, number] | null {
  let end = pos;
  while (end < src.length && end - pos < max && src[end] >= '0' && src[end] <= '9') end += 1;
  return end - pos >= min ? [Number(src.slice(pos, end)), end] : null;
}

/** 小数段按位数放大：1 位×100、2 位×10、3 位原样、更长截前 3 位。 */
function takeFraction(src: string, pos: number): [number, number] | null {
  if (src[pos] !== '.') return null;
  const digits = takeDigits(src, pos + 1, 1, Number.POSITIVE_INFINITY);
  if (!digits) return null;
  const [raw, end] = digits;
  let value = Number(String(raw).slice(0, 3));
  const length = String(raw).length;
  if (length === 1) value *= 100;
  else if (length === 2) value *= 10;
  return [value, end];
}

/**
 * 三种时间写法依次尝试（均要求整串匹配）：
 * HH:MM:SS(.fff)?，HH 固定 2~3 位；MM:SS(.fff)?；SS(.fff)?。
 */
export function parseTtmlTimestamp(input: string): number {
  const hour = takeDigits(input, 0, 2, 3);
  if (hour && input[hour[1]] === ':') {
    const minute = takeDigits(input, hour[1] + 1, 1, 2);
    if (minute && input[minute[1]] === ':') {
      const second = takeDigits(input, minute[1] + 1, 1, 2);
      if (second) {
        const fraction = takeFraction(input, second[1]);
        const tail = fraction ? fraction[1] : second[1];
        if (tail === input.length) {
          return hour[0] * 3_600_000 + minute[0] * 60_000 + second[0] * 1_000
            + (fraction ? fraction[0] : 0);
        }
      }
    }
  }

  const minute = takeDigits(input, 0, 1, 2);
  if (minute && input[minute[1]] === ':') {
    const second = takeDigits(input, minute[1] + 1, 1, 2);
    if (second) {
      const fraction = takeFraction(input, second[1]);
      const tail = fraction ? fraction[1] : second[1];
      if (tail === input.length) {
        return minute[0] * 60_000 + second[0] * 1_000 + (fraction ? fraction[0] : 0);
      }
    }
  }

  const second = takeDigits(input, 0, 1, 2);
  if (second) {
    const fraction = takeFraction(input, second[1]);
    const tail = fraction ? fraction[1] : second[1];
    if (tail === input.length) {
      return second[0] * 1_000 + (fraction ? fraction[0] : 0);
    }
  }

  throw new Error('ttml: bad timestamp');
}

function emptyLine(): AmlLyricLine {
  return {
    words: [],
    isBG: false,
    isDuet: false,
    startTime: 0,
    endTime: 0,
    translatedLyric: '',
    romanLyric: '',
  };
}

function emptyWord(): AmlLyricWord {
  return { startTime: 0, endTime: 0, word: '' };
}

export function parseTtmlLines(src: string): AmlLyricLine[] {
  const tokens = tokenizeXml(src);
  const lines: AmlLyricLine[] = [];
  let status: TtmlStatus = S.None;
  let strBuf = '';
  let mainAgent = '';
  const itunesTranslations = new Map<string, string>();

  const lastLine = (): AmlLyricLine => {
    const line = lines[lines.length - 1];
    if (!line) throw new Error('ttml: missing line');
    return line;
  };

  const lastNonBgLine = (): AmlLyricLine => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].isBG) return lines[i];
    }
    throw new Error('ttml: missing non-background line');
  };

  const lastBgLine = (): AmlLyricLine => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].isBG) return lines[i];
    }
    throw new Error('ttml: missing background line');
  };

  const configureLine = (token: Extract<XmlToken, { kind: 'start' | 'empty' }>, line: AmlLyricLine) => {
    for (const attr of readAttrs(token)) {
      if (attr.name === 'ttm:agent') {
        line.isDuet = Boolean(line.isDuet) || attr.value !== mainAgent;
      } else if (attr.name === 'begin') {
        line.startTime = parseTtmlTimestamp(attr.value);
      } else if (attr.name === 'end') {
        line.endTime = parseTtmlTimestamp(attr.value);
      }
    }
  };

  const configureWord = (token: Extract<XmlToken, { kind: 'start' | 'empty' }>, word: AmlLyricWord) => {
    for (const attr of readAttrs(token)) {
      if (attr.name === 'begin') word.startTime = parseTtmlTimestamp(attr.value);
      else if (attr.name === 'end') word.endTime = parseTtmlTimestamp(attr.value);
    }
  };

  const unexpected = (element: string): never => {
    throw new Error(`ttml: unexpected ${element} element`);
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.kind === 'text') {
      const txt = decodeXmlEntities(token.raw);
      switch (status) {
        case S.InP:
          lastNonBgLine().words.push({ ...emptyWord(), word: txt });
          break;
        case S.InBackgroundSpan:
          lastBgLine().words.push({ ...emptyWord(), word: txt });
          break;
        case S.InSpan:
        case S.InTranslationSpan:
        case S.InRomanSpan:
        case S.InSpanInBackgroundSpan:
        case S.InTranslationSpanInBackgroundSpan:
        case S.InRomanSpanInBackgroundSpan:
          strBuf += txt;
          break;
        default:
          break;
      }
      continue;
    }

    if (token.kind === 'end') {
      switch (token.name) {
        case 'iTunesMetadata':
          if (status === S.InITunesMetadata) status = S.InMetadata;
          break;
        case 'translation':
          if (status === S.InITunesTranslation) status = S.InITunesMetadata;
          break;
        case 'tt':
          if (status === S.InTtml) status = S.None;
          else unexpected('tt');
          break;
        case 'head':
          if (status === S.InHead) status = S.InTtml;
          else unexpected('head');
          break;
        case 'metadata':
          if (status === S.InMetadata) status = S.InHead;
          else unexpected('metadata');
          break;
        case 'body':
          if (status === S.InBody) status = S.InTtml;
          else unexpected('body');
          break;
        case 'div':
          if (status === S.InDiv) status = S.InBody;
          else unexpected('div');
          break;
        case 'p':
          if (status === S.InP) status = S.InDiv;
          else unexpected('p');
          break;
        case 'span':
          switch (status) {
            case S.InSpan: {
              status = S.InP;
              const line = lastLine();
              const word = line.words[line.words.length - 1];
              if (!word) unexpected('span');
              word.word = strBuf;
              strBuf = '';
              break;
            }
            case S.InBackgroundSpan:
              status = S.InP;
              strBuf = '';
              break;
            case S.InSpanInBackgroundSpan: {
              status = S.InBackgroundSpan;
              const line = lastBgLine();
              const word = line.words[line.words.length - 1];
              if (!word) unexpected('span');
              word.word = strBuf;
              strBuf = '';
              break;
            }
            case S.InTranslationSpan: {
              status = S.InP;
              const line = lastNonBgLine();
              // 已有 Apple Music 式翻译时内嵌翻译让位
              if (!line.translatedLyric) line.translatedLyric = strBuf;
              strBuf = '';
              break;
            }
            case S.InRomanSpan:
              status = S.InP;
              lastNonBgLine().romanLyric = strBuf;
              strBuf = '';
              break;
            case S.InTranslationSpanInBackgroundSpan:
              status = S.InBackgroundSpan;
              lastBgLine().translatedLyric = strBuf;
              strBuf = '';
              break;
            case S.InRomanSpanInBackgroundSpan:
              status = S.InBackgroundSpan;
              lastBgLine().romanLyric = strBuf;
              strBuf = '';
              break;
            default:
              unexpected('span');
          }
          break;
        default:
          break;
      }
      continue;
    }

    // start / empty 共用同一套分发
    switch (token.name) {
      case 'iTunesMetadata':
        if (status === S.InMetadata) status = S.InITunesMetadata;
        break;
      case 'translation':
        if (status === S.InITunesMetadata) status = S.InITunesTranslation;
        break;
      case 'text':
        if (status === S.InITunesTranslation) {
          // 属性迭代忽略残缺项，"for" 以最后一次出现为准
          let key: string | null = null;
          for (const attr of token.attrs) {
            if (attr.name === 'for') key = attr.value;
          }
          if (key !== null && tokens[i + 1]?.kind === 'text') {
            try {
              itunesTranslations.set(key, decodeXmlEntities((tokens[i + 1] as { raw: string }).raw));
            } catch {
              // 嵌套文本解码失败时静默放弃该翻译
            }
          }
          i += 1; // 上游在此处额外读取并消费一个事件，无论其类型
        }
        break;
      case 'tt':
        if (status === S.None) status = S.InTtml;
        else unexpected('tt');
        break;
      case 'head':
        if (status === S.InTtml) status = S.InHead;
        else unexpected('head');
        break;
      case 'metadata':
        if (status === S.InHead) status = S.InMetadata;
        else unexpected('metadata');
        break;
      case 'ttm:agent':
        if (mainAgent === '') {
          if (status !== S.InMetadata) unexpected('ttm:agent');
          let agentType = '';
          let agentId = '';
          for (const attr of readAttrs(token)) {
            if (attr.name === 'type') agentType = attr.value;
            else if (attr.name === 'xml:id') agentId = attr.value;
          }
          if (agentType === 'person') mainAgent = agentId;
        }
        break;
      case 'amll:meta':
        if (status !== S.InMetadata) unexpected('amll:meta');
        {
          let metaKey = '';
          let metaValue = '';
          for (const attr of readAttrs(token)) {
            if (attr.name === 'key') metaKey = attr.value;
            else if (attr.name === 'value') metaValue = attr.value;
          }
          // 元数据目前无消费方，仅维持结构合法性
          void metaKey;
          void metaValue;
        }
        break;
      case 'body':
        if (status === S.InTtml) status = S.InBody;
        else unexpected('body');
        break;
      case 'div':
        if (status === S.InBody) status = S.InDiv;
        else unexpected('div');
        break;
      case 'p':
        if (status !== S.InDiv) unexpected('p');
        {
          status = S.InP;
          const newLine = emptyLine();

          let itunesKey: string | null = null;
          for (const attr of token.attrs) {
            if (attr.name === 'itunes:key') {
              itunesKey = attr.value;
              break;
            }
          }

          configureLine(token, newLine);

          const preset = itunesKey === null ? undefined : itunesTranslations.get(itunesKey);
          if (preset !== undefined) newLine.translatedLyric = preset;

          lines.push(newLine);
        }
        break;
      case 'span':
        if (status === S.InP) {
          status = S.InSpan;
          for (const attr of readAttrs(token)) {
            if (attr.name !== 'ttm:role') continue;
            if (attr.value === 'x-bg') {
              status = S.InBackgroundSpan;
              const bgLine = emptyLine();
              bgLine.isBG = true;
              bgLine.isDuet = Boolean(lastLine().isDuet);
              configureLine(token, bgLine);
              lines.push(bgLine);
              break;
            }
            if (attr.value === 'x-translation') {
              status = S.InTranslationSpan;
              break;
            }
            if (attr.value === 'x-roman') {
              status = S.InRomanSpan;
              break;
            }
          }
          if (status === S.InSpan) {
            const word = emptyWord();
            configureWord(token, word);
            lastLine().words.push(word);
          }
        } else if (status === S.InBackgroundSpan) {
          status = S.InSpanInBackgroundSpan;
          for (const attr of readAttrs(token)) {
            if (attr.name !== 'ttm:role') continue;
            if (attr.value === 'x-translation') {
              status = S.InTranslationSpanInBackgroundSpan;
              break;
            }
            if (attr.value === 'x-roman') {
              status = S.InRomanSpanInBackgroundSpan;
              break;
            }
          }
          if (status === S.InSpanInBackgroundSpan) {
            const word = emptyWord();
            configureWord(token, word);
            lastBgLine().words.push(word);
          }
        } else {
          unexpected('span');
        }
        break;
      default:
        break;
    }
  }

  // 背景行的首尾括号是上游书写习惯，产出前剥掉
  for (const line of lines) {
    if (!line.isBG) continue;
    const first = line.words[0];
    if (first && first.word.startsWith('(')) first.word = first.word.slice(1);
    const last = line.words[line.words.length - 1];
    if (last && last.word.endsWith(')')) last.word = last.word.slice(0, -1);
  }

  return lines;
}
