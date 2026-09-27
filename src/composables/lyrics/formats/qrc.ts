/**
 * QRC（QQ 音乐逐词格式）解析与密文解密。
 *
 * 密文 = hex 编码的 3DES-ECB（24 字节常量按 8 字节切分成三把子密钥，
 * 解密方向为 D(k3)→E(k2)→D(k1)）再套 zlib 压缩；
 * 明文行头是 [起始,时长]（u64 校验后丢弃），词文本在前、(起始,时长) 元组在后。
 */

import type { AmlLyricLine, AmlLyricWord } from '../types';

import {
  finalizeLines,
  readBracketDurationTuple,
  readStartDurationTuple,
  scanWordByBoundary,
  splitSourceLines,
  takeVisibleRun,
} from './shared';

/** 三重 DES 密钥：[0..8)=k1、[8..16)=k2、[16..24)=k3。 */
const QRC_DES_KEY = '!@#)(*$%123ZXC!@!@#)(NHL';

type CryptoJsModule = typeof import('crypto-js');
type CryptoJsWordArray = { words: number[]; sigBytes: number };

let cryptoJsPromise: Promise<CryptoJsModule> | null = null;

/** crypto-js 以 CJS 形式发布，各运行时的互操作结果可能挂在 default 上，这里统一归一。 */
function loadCryptoJs(): Promise<CryptoJsModule> {
  if (!cryptoJsPromise) {
    cryptoJsPromise = import('crypto-js').then((mod) => {
      const maybe = mod as { default?: CryptoJsModule };
      return (maybe.default ?? mod) as CryptoJsModule;
    });
  }
  return cryptoJsPromise;
}

function bytesToWordArray(bytes: Uint8Array, CryptoJS: CryptoJsModule) {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    words[i >>> 2] = (words[i >>> 2] ?? 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function wordArrayToBytes(wordArray: CryptoJsWordArray): Uint8Array {
  const out = new Uint8Array(wordArray.sigBytes);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function hexNibble(code: number): number | null {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x61 && code <= 0x66) return code - 0x57; // a-f
  if (code >= 0x41 && code <= 0x46) return code - 0x37; // A-F
  return null;
}

/** 十六进制解码：奇数长度整体作废；无法成对解析的位置静默跳过。 */
function decodeHexPairs(src: string): Uint8Array {
  if (src.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(src.length >> 1);
  let written = 0;
  for (let i = 0; i + 1 < src.length; i += 2) {
    const high = hexNibble(src.charCodeAt(i));
    const low = hexNibble(src.charCodeAt(i + 1));
    if (high === null || low === null) continue;
    out[written] = (high << 4) | low;
    written += 1;
  }
  return out.subarray(0, written);
}

/** 逐 8 字节块解密；尾部凑不满一块的残字节原样保留，不参与解密。 */
function des3DecryptBlocks(data: Uint8Array, CryptoJS: CryptoJsModule): Uint8Array {
  const blockCount = Math.floor(data.length / 8);
  const tailStart = blockCount * 8;
  const tail = data.subarray(tailStart);

  const key = CryptoJS.enc.Latin1.parse(QRC_DES_KEY);
  const ciphertext = CryptoJS.lib.CipherParams.create({
    ciphertext: bytesToWordArray(data.subarray(0, tailStart), CryptoJS),
  });
  const plaintext = CryptoJS.TripleDES.decrypt(ciphertext, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.NoPadding,
  });

  const out = new Uint8Array(tailStart + tail.length);
  out.set(wordArrayToBytes(plaintext), 0);
  out.set(tail, tailStart);
  return out;
}

type DecompressionCtor = new (format: string) => TransformStream<Uint8Array, Uint8Array>;

/** zlib 解压为文本；运行时不支持或数据损坏时返回空串（对标 unwrap_or_default）。 */
async function inflateZlibText(bytes: Uint8Array): Promise<string> {
  const ctor = (globalThis as { DecompressionStream?: DecompressionCtor }).DecompressionStream;
  if (!ctor) return '';
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new ctor('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return new TextDecoder('utf-8').decode(buffer);
  } catch {
    return '';
  }
}

export async function decryptQrcHex(hexData: string): Promise<string> {
  const bytes = decodeHexPairs(hexData);
  if (bytes.length === 0) return '';
  const CryptoJS = await loadCryptoJs();
  return inflateZlibText(des3DecryptBlocks(bytes, CryptoJS));
}

function readQrcWords(src: string): AmlLyricWord[] {
  const words: AmlLyricWord[] = [];
  let rest = src;

  for (;;) {
    try {
      const found = scanWordByBoundary(rest, readStartDurationTuple);
      words.push({ startTime: found.start, endTime: found.end, word: found.word });
      rest = found.rest;
    } catch {
      break;
    }
  }

  return words;
}

function readQrcLine(line: string): AmlLyricLine {
  const rest = readBracketDurationTuple(line);
  return {
    words: readQrcWords(takeVisibleRun(rest)),
    isBG: false,
    isDuet: false,
    startTime: 0,
    endTime: 0,
    translatedLyric: '',
    romanLyric: '',
  };
}

export function parseQrcLines(src: string): AmlLyricLine[] {
  const collected: AmlLyricLine[] = [];
  for (const line of splitSourceLines(src)) {
    try {
      collected.push(readQrcLine(line));
    } catch {
      // 行头不是合法的 [起始,时长]，整行丢弃。
    }
  }
  return finalizeLines(collected);
}
