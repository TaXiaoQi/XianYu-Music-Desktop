/**
 * lxLyricFetcher - 直接从各音乐平台 API 获取歌词（包括逐字歌词）
 *
 * 完全移植自 lx-music-desktop 项目的 musicSdk 歌词获取逻辑，
 * 适配 Tauri 环境（使用 Tauri 后端的 HTTP 代理绕过 CORS）。
 *
 * 支持的音源：
 * - kg (酷狗): KRC 加密歌词，包含逐字时间
 * - kw (酷我): 加密歌词，包含逐字时间
 * - tx (QQ音乐): QRC 加密歌词，包含逐字时间
 * - wy (网易云): eapi 加密，yrc 逐字歌词
 */

import { invoke } from '@tauri-apps/api/core';
import CryptoJS from 'crypto-js';
import type { Song } from '../types';
import { buildLyricsRaw } from '../composables/lyrics/parser';

// ==================== Types ====================

export interface LxLyricResult {
  lyric: string;
  tlyric: string;
  rlyric: string;
  lxlyric: string;
}

export interface LxSongInfo {
  songmid: string;
  hash?: string;
  name: string;
  singer: string;
  albumName?: string;
  interval?: string;
  _interval?: number;
  songId?: string | number;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string | number;
  copyrightId?: string;
  source?: string;
}

// ==================== Song Info Cache ====================
// 缓存 lx://source/songmid → 完整歌曲元信息
// 使 playerPlayback.ts 在处理 lx:// 协议时能获取到 hash/songId/interval 等字段
const songInfoCache = new Map<string, LxSongInfo>();
const MAX_CACHE_SIZE = 200;

/**
 * 缓存歌曲元信息，供后续 playerPlayback.ts 获取歌词时使用
 * @param source 音源 (kw/kg/tx/wy)
 * @param songmid 歌曲 ID
 * @param info 完整的歌曲元信息
 */
export function cacheLxSongInfo(source: string, songmid: string, info: LxSongInfo): void {
  const key = `${source}/${songmid}`;
  if (songInfoCache.size >= MAX_CACHE_SIZE) {
    // 简单淘汰：删除最早的条目
    const firstKey = songInfoCache.keys().next().value;
    if (firstKey) songInfoCache.delete(firstKey);
  }
  songInfoCache.set(key, info);
}

/**
 * 从缓存中获取歌曲元信息
 * @param source 音源 (kw/kg/tx/wy)
 * @param songmid 歌曲 ID
 * @returns 缓存的歌曲元信息，未找到时返回 null
 */
export function getCachedLxSongInfo(source: string, songmid: string): LxSongInfo | null {
  return songInfoCache.get(`${source}/${songmid}`) ?? null;
}

// ==================== HTTP Request (via Tauri backend) ====================

interface TauriHttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface TauriHttpBinaryResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body_base64: string;
}

async function tauriHttpFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<TauriHttpResponse> {
  return invoke<TauriHttpResponse>('plugin_http_request', {
    method: options.method || 'GET',
    url,
    headers: options.headers || null,
    body: options.body || null,
  });
}

async function tauriHttpFetchBinary(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<TauriHttpBinaryResponse> {
  return invoke<TauriHttpBinaryResponse>('plugin_http_request_binary', {
    method: options.method || 'GET',
    url,
    headers: options.headers || null,
    body: options.body || null,
  });
}

// ==================== Utility Functions ====================

function decodeName(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 检查字符串是否为合法的 base64 编码
 * base64 字符集: A-Z a-z 0-9 + / =
 */
function isValidBase64(s: string): boolean {
  if (!s || s.length < 4) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0;
}

async function inflateData(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) chunks.push(value);
      if (done) break;
    }
  } catch (error) {
    if (chunks.length === 0) throw error;
  } finally {
    reader.releaseLock();
  }
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function decodeGb18030(bytes: Uint8Array): string {
  try {
    const decoder = new TextDecoder('gb18030');
    return decoder.decode(bytes);
  } catch {
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  }
}

// ==================== KRC Decryption (Kugou) ====================

const KG_KRC_KEY = new Uint8Array([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);

async function decodeKgKrc(base64Data: string): Promise<string> {
  const buf = base64ToUint8Array(base64Data).subarray(4);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = buf[i] ^ KG_KRC_KEY[i % 16];
  }
  const inflated = await inflateData(buf);
  return new TextDecoder('utf-8').decode(inflated);
}

// ==================== Kuwo Lyric Decryption ====================

const KW_BUF_KEY = new TextEncoder().encode('yeelion');

async function decodeKwLyric(bodyBase64: string, _isGetLyricx: boolean): Promise<string> {
  const buf = base64ToUint8Array(bodyBase64);
  if (buf.length === 0) return '';

  // 分割头部和二进制数据（移植自 Go 的 kwDecryptLyric）
  let binaryData: Uint8Array | null = null;
  // 先找 \r\n\r\n
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      binaryData = buf.subarray(i + 4);
      break;
    }
  }
  // 回退：找 \n\n
  if (!binaryData || binaryData.length === 0) {
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === 0x0a && buf[i + 1] === 0x0a) {
        binaryData = buf.subarray(i + 2);
        break;
      }
    }
  }
  if (!binaryData || binaryData.length === 0) return '';

  // zlib 解压
  let lrcData: Uint8Array;
  try {
    lrcData = await inflateData(binaryData);
  } catch {
    // 尝试跳过前 2 字节（zlib header）
    try {
      lrcData = await inflateData(binaryData.subarray(2));
    } catch {
      return '';
    }
  }
  if (lrcData.length === 0) return '';

  // 检测格式：首字节为 '[' (0x5B) = 明文 LRC
  if (lrcData[0] === 0x5B) {
    return decodeGb18030(lrcData);
  }

  // 否则是 base64 编码的 XOR 加密数据
  const lrcStr = new TextDecoder('utf-8').decode(lrcData);
  if (!isValidBase64(lrcStr.trim())) return '';
  let bufStr: Uint8Array;
  try {
    bufStr = base64ToUint8Array(lrcStr.trim());
  } catch {
    return '';
  }
  const output = new Uint8Array(bufStr.length);
  let i = 0;
  while (i < bufStr.length) {
    let j = 0;
    while (j < KW_BUF_KEY.length && i < bufStr.length) {
      output[i] = bufStr[i] ^ KW_BUF_KEY[j];
      i++;
      j++;
    }
  }
  return decodeGb18030(output);
}

// ==================== NetEase eapi Encryption ====================

const WY_EAPI_KEY = 'e82ckenh8dichen8';

function wyEapiEncrypt(url: string, data: object | string): { params: string } {
  let text: string;
  if (typeof data === 'object') {
    // 按 key 字母序排列，与 Go 的 wyyBuildEapiParams 行为一致
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(data).sort()) {
      sorted[key] = (data as Record<string, any>)[key];
    }
    text = JSON.stringify(sorted);
  } else {
    text = data;
  }
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = CryptoJS.MD5(message).toString();
  const dataStr = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(dataStr),
    CryptoJS.enc.Utf8.parse(WY_EAPI_KEY),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  ).ciphertext.toString(CryptoJS.enc.Hex).toUpperCase();
  return { params: encrypted };
}

// ==================== QRC Decryption (QQ Music) ====================

const SBOX: number[][] = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

function bitnum(a: Uint8Array, b: number, c: number): number {
  const index = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8);
  const shift = 7 - (b % 8);
  return ((a[index] >> shift) & 1) << c;
}

function bitnumIntr(a: number, b: number, c: number): number {
  return ((a >>> (31 - b)) & 1) << c;
}

function bitnumIntl(a: number, b: number, c: number): number {
  return (((a << b) & 0x80000000) >>> c);
}

function sboxBit(a: number): number {
  return (a & 32) | ((a & 31) >> 1) | ((a & 1) << 4);
}

function initialPermutation(input: Uint8Array): [number, number] {
  const s0 = ((
    bitnum(input, 57, 31) | bitnum(input, 49, 30) | bitnum(input, 41, 29) | bitnum(input, 33, 28) |
    bitnum(input, 25, 27) | bitnum(input, 17, 26) | bitnum(input, 9, 25) | bitnum(input, 1, 24) |
    bitnum(input, 59, 23) | bitnum(input, 51, 22) | bitnum(input, 43, 21) | bitnum(input, 35, 20) |
    bitnum(input, 27, 19) | bitnum(input, 19, 18) | bitnum(input, 11, 17) | bitnum(input, 3, 16) |
    bitnum(input, 61, 15) | bitnum(input, 53, 14) | bitnum(input, 45, 13) | bitnum(input, 37, 12) |
    bitnum(input, 29, 11) | bitnum(input, 21, 10) | bitnum(input, 13, 9) | bitnum(input, 5, 8) |
    bitnum(input, 63, 7) | bitnum(input, 55, 6) | bitnum(input, 47, 5) | bitnum(input, 39, 4) |
    bitnum(input, 31, 3) | bitnum(input, 23, 2) | bitnum(input, 15, 1) | bitnum(input, 7, 0)
  ) >>> 0);
  const s1 = ((
    bitnum(input, 56, 31) | bitnum(input, 48, 30) | bitnum(input, 40, 29) | bitnum(input, 32, 28) |
    bitnum(input, 24, 27) | bitnum(input, 16, 26) | bitnum(input, 8, 25) | bitnum(input, 0, 24) |
    bitnum(input, 58, 23) | bitnum(input, 50, 22) | bitnum(input, 42, 21) | bitnum(input, 34, 20) |
    bitnum(input, 26, 19) | bitnum(input, 18, 18) | bitnum(input, 10, 17) | bitnum(input, 2, 16) |
    bitnum(input, 60, 15) | bitnum(input, 52, 14) | bitnum(input, 44, 13) | bitnum(input, 36, 12) |
    bitnum(input, 28, 11) | bitnum(input, 20, 10) | bitnum(input, 12, 9) | bitnum(input, 4, 8) |
    bitnum(input, 62, 7) | bitnum(input, 54, 6) | bitnum(input, 46, 5) | bitnum(input, 38, 4) |
    bitnum(input, 30, 3) | bitnum(input, 22, 2) | bitnum(input, 14, 1) | bitnum(input, 6, 0)
  ) >>> 0);
  return [s0, s1];
}

function inversePermutation(s0: number, s1: number): Uint8Array {
  const data = new Uint8Array(8);
  data[3] = bitnumIntr(s1, 7, 7) | bitnumIntr(s0, 7, 6) | bitnumIntr(s1, 15, 5) | bitnumIntr(s0, 15, 4) | bitnumIntr(s1, 23, 3) | bitnumIntr(s0, 23, 2) | bitnumIntr(s1, 31, 1) | bitnumIntr(s0, 31, 0);
  data[2] = bitnumIntr(s1, 6, 7) | bitnumIntr(s0, 6, 6) | bitnumIntr(s1, 14, 5) | bitnumIntr(s0, 14, 4) | bitnumIntr(s1, 22, 3) | bitnumIntr(s0, 22, 2) | bitnumIntr(s1, 30, 1) | bitnumIntr(s0, 30, 0);
  data[1] = bitnumIntr(s1, 5, 7) | bitnumIntr(s0, 5, 6) | bitnumIntr(s1, 13, 5) | bitnumIntr(s0, 13, 4) | bitnumIntr(s1, 21, 3) | bitnumIntr(s0, 21, 2) | bitnumIntr(s1, 29, 1) | bitnumIntr(s0, 29, 0);
  data[0] = bitnumIntr(s1, 4, 7) | bitnumIntr(s0, 4, 6) | bitnumIntr(s1, 12, 5) | bitnumIntr(s0, 12, 4) | bitnumIntr(s1, 20, 3) | bitnumIntr(s0, 20, 2) | bitnumIntr(s1, 28, 1) | bitnumIntr(s0, 28, 0);
  data[7] = bitnumIntr(s1, 3, 7) | bitnumIntr(s0, 3, 6) | bitnumIntr(s1, 11, 5) | bitnumIntr(s0, 11, 4) | bitnumIntr(s1, 19, 3) | bitnumIntr(s0, 19, 2) | bitnumIntr(s1, 27, 1) | bitnumIntr(s0, 27, 0);
  data[6] = bitnumIntr(s1, 2, 7) | bitnumIntr(s0, 2, 6) | bitnumIntr(s1, 10, 5) | bitnumIntr(s0, 10, 4) | bitnumIntr(s1, 18, 3) | bitnumIntr(s0, 18, 2) | bitnumIntr(s1, 26, 1) | bitnumIntr(s0, 26, 0);
  data[5] = bitnumIntr(s1, 1, 7) | bitnumIntr(s0, 1, 6) | bitnumIntr(s1, 9, 5) | bitnumIntr(s0, 9, 4) | bitnumIntr(s1, 17, 3) | bitnumIntr(s0, 17, 2) | bitnumIntr(s1, 25, 1) | bitnumIntr(s0, 25, 0);
  data[4] = bitnumIntr(s1, 0, 7) | bitnumIntr(s0, 0, 6) | bitnumIntr(s1, 8, 5) | bitnumIntr(s0, 8, 4) | bitnumIntr(s1, 16, 3) | bitnumIntr(s0, 16, 2) | bitnumIntr(s1, 24, 1) | bitnumIntr(s0, 24, 0);
  return data;
}

function desF(state: number, key: number[]): number {
  const t1 = ((
    bitnumIntl(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitnumIntl(state, 4, 5) | bitnumIntl(state, 3, 6) |
    ((state & 0x0f000000) >>> 3) | bitnumIntl(state, 8, 11) | bitnumIntl(state, 7, 12) | ((state & 0x00f00000) >>> 5) |
    bitnumIntl(state, 12, 17) | bitnumIntl(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitnumIntl(state, 16, 23)
  ) >>> 0);
  const t2 = ((
    bitnumIntl(state, 15, 0) | ((state & 0x0000f000) << 15) | bitnumIntl(state, 20, 5) | bitnumIntl(state, 19, 6) |
    ((state & 0x00000f00) << 13) | bitnumIntl(state, 24, 11) | bitnumIntl(state, 23, 12) | ((state & 0x000000f0) << 11) |
    bitnumIntl(state, 28, 17) | bitnumIntl(state, 27, 18) | ((state & 0x0000000f) << 9) | bitnumIntl(state, 0, 23)
  ) >>> 0);
  const lrgstate = [
    (t1 >>> 24) & 0xff, (t1 >>> 16) & 0xff, (t1 >>> 8) & 0xff,
    (t2 >>> 24) & 0xff, (t2 >>> 16) & 0xff, (t2 >>> 8) & 0xff,
  ];
  const xorState = lrgstate.map((item, idx) => item ^ key[idx]);
  const outputState = ((
    (SBOX[0][sboxBit(xorState[0] >>> 2)] << 28) |
    (SBOX[1][sboxBit(((xorState[0] & 0x03) << 4) | (xorState[1] >>> 4))] << 24) |
    (SBOX[2][sboxBit(((xorState[1] & 0x0f) << 2) | (xorState[2] >>> 6))] << 20) |
    (SBOX[3][sboxBit(xorState[2] & 0x3f)] << 16) |
    (SBOX[4][sboxBit(xorState[3] >>> 2)] << 12) |
    (SBOX[5][sboxBit(((xorState[3] & 0x03) << 4) | (xorState[4] >>> 4))] << 8) |
    (SBOX[6][sboxBit(((xorState[4] & 0x0f) << 2) | (xorState[5] >>> 6))] << 4) |
    SBOX[7][sboxBit(xorState[5] & 0x3f)]
  ) >>> 0);
  return ((
    bitnumIntl(outputState, 15, 0) | bitnumIntl(outputState, 6, 1) | bitnumIntl(outputState, 19, 2) |
    bitnumIntl(outputState, 20, 3) | bitnumIntl(outputState, 28, 4) | bitnumIntl(outputState, 11, 5) |
    bitnumIntl(outputState, 27, 6) | bitnumIntl(outputState, 16, 7) | bitnumIntl(outputState, 0, 8) |
    bitnumIntl(outputState, 14, 9) | bitnumIntl(outputState, 22, 10) | bitnumIntl(outputState, 25, 11) |
    bitnumIntl(outputState, 4, 12) | bitnumIntl(outputState, 17, 13) | bitnumIntl(outputState, 30, 14) |
    bitnumIntl(outputState, 9, 15) | bitnumIntl(outputState, 1, 16) | bitnumIntl(outputState, 7, 17) |
    bitnumIntl(outputState, 23, 18) | bitnumIntl(outputState, 13, 19) | bitnumIntl(outputState, 31, 20) |
    bitnumIntl(outputState, 26, 21) | bitnumIntl(outputState, 2, 22) | bitnumIntl(outputState, 8, 23) |
    bitnumIntl(outputState, 18, 24) | bitnumIntl(outputState, 12, 25) | bitnumIntl(outputState, 29, 26) |
    bitnumIntl(outputState, 5, 27) | bitnumIntl(outputState, 21, 28) | bitnumIntl(outputState, 10, 29) |
    bitnumIntl(outputState, 3, 30) | bitnumIntl(outputState, 24, 31)
  ) >>> 0);
}

function desCrypt(input: Uint8Array, key: number[][]): Uint8Array {
  let [s0, s1] = initialPermutation(input);
  for (let idx = 0; idx < 15; idx++) {
    const prevS1 = s1;
    s1 = (desF(s1, key[idx]) ^ s0) >>> 0;
    s0 = prevS1;
  }
  s0 = (desF(s1, key[15]) ^ s0) >>> 0;
  return inversePermutation(s0, s1);
}

function desKeySchedule(key: Uint8Array, mode: number): number[][] {
  const schedule: number[][] = Array.from({ length: 16 }, () => new Array(6).fill(0));
  const keyRndShift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
  const keyPermC = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
  const keyPermD = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
  const keyCompression = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];
  let c = 0;
  for (let i = 0; i < 28; i++) c |= bitnum(key, keyPermC[i], 31 - i);
  c >>>= 0;
  let d = 0;
  for (let i = 0; i < 28; i++) d |= bitnum(key, keyPermD[i], 31 - i);
  d >>>= 0;
  for (let i = 0; i < 16; i++) {
    c = (((c << keyRndShift[i]) | (c >>> (28 - keyRndShift[i]))) & 0xfffffff0) >>> 0;
    d = (((d << keyRndShift[i]) | (d >>> (28 - keyRndShift[i]))) & 0xfffffff0) >>> 0;
    const togen = mode === 0 ? 15 - i : i;
    for (let j = 0; j < 6; j++) schedule[togen][j] = 0;
    for (let j = 0; j < 24; j++) schedule[togen][Math.floor(j / 8)] |= bitnumIntr(c, keyCompression[j], 7 - (j % 8));
    for (let j = 24; j < 48; j++) schedule[togen][Math.floor(j / 8)] |= bitnumIntr(d, keyCompression[j] - 27, 7 - (j % 8));
  }
  return schedule;
}

function tripleDesKeySetup(key: Uint8Array, mode: number): number[][][] {
  const key0 = key.subarray(0, 8);
  const key8 = key.subarray(8, 16);
  const key16 = key.subarray(16, 24);
  if (mode === 1) {
    return [desKeySchedule(key0, 1), desKeySchedule(key8, 0), desKeySchedule(key16, 1)];
  }
  return [desKeySchedule(key16, 0), desKeySchedule(key8, 1), desKeySchedule(key0, 0)];
}

function tripleDesCrypt(data: Uint8Array, keySchedule: number[][][]): Uint8Array {
  let temp = data;
  for (let i = 0; i < 3; i++) temp = desCrypt(temp, keySchedule[i]);
  return temp;
}

async function decompressDeflate(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) chunks.push(value);
      if (done) break;
    }
  } catch (error) {
    if (chunks.length === 0) throw error;
  } finally {
    reader.releaseLock();
  }
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8').decode(result);
}

async function qrcDecrypt(encryptedHexOrBytes: string): Promise<string> {
  const hex = encryptedHexOrBytes.trim();
  const encryptedBytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  if (encryptedBytes.length === 0) throw new Error('No data to decrypt');
  const QRC_KEY = new TextEncoder().encode('!@#)(*$%123ZXC!@!@#)(NHL');
  const schedule = tripleDesKeySetup(QRC_KEY, 0);
  const decryptedBytes = new Uint8Array(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i += 8) {
    const block = encryptedBytes.subarray(i, Math.min(i + 8, encryptedBytes.length));
    let paddedBlock = block;
    if (block.length < 8) {
      paddedBlock = new Uint8Array(8);
      paddedBlock.set(block);
    }
    const decryptedBlock = tripleDesCrypt(paddedBlock, schedule);
    decryptedBytes.set(decryptedBlock.subarray(0, block.length), i);
  }
  return await decompressDeflate(decryptedBytes);
}

// ==================== Kugou (kg) Lyric Fetching ====================

const KG_HEAD_EXP = /^.*\[id:\$\w+\]\n/;

function kgParseLyric(str: string): LxLyricResult {
  str = str.replace(/\r/g, '');
  if (KG_HEAD_EXP.test(str)) str = str.replace(KG_HEAD_EXP, '');
  const trans = str.match(/\[language:([\w=\\/+]+)\]/);
  let lyric: string;
  let rlyric: string | any[] = '';
  let tlyric: string | any[] = '';
  if (trans) {
    str = str.replace(/\[language:[\w=\\/+]+\]\n/, '');
    try {
      const json = JSON.parse(atob(trans[1]));
      for (const item of json.content) {
        switch (item.type) {
          case 0: rlyric = item.lyricContent; break;
          case 1: tlyric = item.lyricContent; break;
        }
      }
    } catch { /* ignore */ }
  }
  let i = 0;
  let lxlyric = str.replace(/\[((\d+),\d+)\].*/g, (s) => {
    const result = s.match(/\[((\d+),\d+)\].*/);
    if (!result) return s;
    let time = parseInt(result[2]);
    const ms = time % 1000;
    time /= 1000;
    const m = parseInt(String(time / 60)).toString().padStart(2, '0');
    time %= 60;
    const sec = parseInt(String(time)).toString().padStart(2, '0');
    const timeStr = `${m}:${sec}.${String(ms).padStart(3, '0')}`;
    if (rlyric && Array.isArray(rlyric)) (rlyric as any[])[i] = `[${timeStr}]${(rlyric as any[])[i]?.join('') ?? ''}`;
    if (tlyric && Array.isArray(tlyric)) (tlyric as any[])[i] = `[${timeStr}]${(tlyric as any[])[i]?.join('') ?? ''}`;
    i++;
    return s.replace(result[1], timeStr);
  });
  rlyric = rlyric && Array.isArray(rlyric) ? (rlyric as any[]).join('\n') : '';
  tlyric = tlyric && Array.isArray(tlyric) ? (tlyric as any[]).join('\n') : '';
  lxlyric = lxlyric.replace(/<(\d+,\d+),\d+>/g, '<$1>');
  lxlyric = decodeName(lxlyric);
  lyric = lxlyric.replace(/<\d+,\d+>/g, '');
  rlyric = decodeName(rlyric);
  tlyric = decodeName(tlyric);
  return { lyric, tlyric, rlyric, lxlyric };
}

function kgGetIntv(interval: string): number {
  if (!interval) return 0;
  const intvArr = interval.split(':');
  let intv = 0;
  let unit = 1;
  while (intvArr.length) { intv += parseInt(intvArr.pop()!) * unit; unit *= 60; }
  return intv;
}

async function fetchKgLyric(songInfo: LxSongInfo): Promise<LxLyricResult | null> {
  const name = songInfo.name;
  const hash = songInfo.hash || songInfo.songmid;
  const time = songInfo._interval || kgGetIntv(songInfo.interval || '');
  const searchUrl = `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(name)}&hash=${hash}&timelength=${time}&lrctxt=1`;
  const searchResp = await tauriHttpFetch(searchUrl, {
    headers: { 'KG-RC': '1', 'KG-THash': 'expand_search_manager.cpp:852736169:451', 'User-Agent': 'KuGou2012-9020-ExpandSearchManager' },
  });
  if (searchResp.status !== 200) return null;
  let searchBody: any;
  try { searchBody = JSON.parse(searchResp.body); } catch { return null; }
  if (!searchBody.candidates || !searchBody.candidates.length) return null;
  const info = searchBody.candidates[0];
  const fmt = info.krctype == 1 && info.contenttype != 1 ? 'krc' : 'lrc';
  const downloadUrl = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${info.id}&accesskey=${info.accesskey}&fmt=${fmt}&charset=utf8`;
  const downloadResp = await tauriHttpFetch(downloadUrl, {
    headers: { 'KG-RC': '1', 'KG-THash': 'expand_search_manager.cpp:852736169:451', 'User-Agent': 'KuGou2012-9020-ExpandSearchManager' },
  });
  if (downloadResp.status !== 200) return null;
  let downloadBody: any;
  try { downloadBody = JSON.parse(downloadResp.body); } catch { return null; }
  if (downloadBody.fmt === 'krc') return kgParseLyric(await decodeKgKrc(downloadBody.content));
  if (downloadBody.fmt === 'lrc') return { lyric: decodeName(atob(downloadBody.content)), tlyric: '', rlyric: '', lxlyric: '' };
  return null;
}

// ==================== Kuwo (kw) Lyric Fetching ====================

const KW_TIME_EXP = /^\[([\d:.]*)\]{1}/g;
const KW_EXIST_TIME_EXP = /\[\d{1,2}:.*\d{1,4}\]/;
const KW_LYRICX_TAG = /^<-?\d+,-?\d+>/;

const kwLrcTools = {
  rxps: {
    wordLine: /^(\[\d{1,2}:.*\d{1,4}\])\s*(\S+(?:\s+\S+)*)?\s*/,
    tagLine: /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*\]/,
    wordTimeAll: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g,
    wordTime: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/,
  },
  offset: 1, offset2: 1, isOK: false, lines: [] as string[], tags: [] as string[],
  getWordInfo(str: string, str2: string, prevWord: any): any {
    const offset = parseInt(str);
    const offset2 = parseInt(str2);
    // 必须使用 Math.trunc 进行整数除法（与 Go 的整数除法一致）
    // 否则浮点数如 150.5 无法被 normalizeLxlyricToRelative 的正则 /<(\d+),(\d+)>/g 匹配
    let startTime = Math.trunc(Math.abs((offset + offset2) / (this.offset * 2)));
    let endTime = Math.trunc(Math.abs((offset - offset2) / (this.offset2 * 2))) + startTime;
    if (prevWord) {
      if (startTime < prevWord.endTime) {
        prevWord.endTime = startTime;
        if (prevWord.startTime > prevWord.endTime) prevWord.startTime = prevWord.endTime;
        prevWord.newTimeStr = `<${prevWord.startTime},${prevWord.endTime - prevWord.startTime}>`;
      }
    }
    return { startTime, endTime, timeStr: `<${startTime},${endTime - startTime}>` };
  },
  parseLine(line: string) {
    if (line.length < 6) return;
    let result = this.rxps.wordLine.exec(line);
    if (result) {
      const time = result[1];
      let words = result[2] ?? '';
      const wordTimes = words.match(this.rxps.wordTimeAll);
      if (!wordTimes) return;
      let preTimeInfo: any;
      for (const timeStr of wordTimes) {
        const r = this.rxps.wordTime.exec(timeStr)!;
        const wordInfo = this.getWordInfo(r[1], r[2], preTimeInfo);
        words = words.replace(timeStr, wordInfo.timeStr);
        if (preTimeInfo?.newTimeStr) words = words.replace(preTimeInfo.timeStr, preTimeInfo.newTimeStr);
        preTimeInfo = wordInfo;
      }
      this.lines.push(time + words);
      return;
    }
    result = this.rxps.tagLine.exec(line);
    if (!result) return;
    if (result[1] === 'kuwo') {
      let content = result[2];
      if (content != null && content.includes('][')) content = content.substring(0, content.indexOf(']['));
      const valueOf = parseInt(content, 8);
      this.offset = Math.trunc(valueOf / 10);
      this.offset2 = Math.trunc(valueOf % 10);
      if (this.offset === 0 || Number.isNaN(this.offset) || this.offset2 === 0 || Number.isNaN(this.offset2)) this.isOK = false;
    } else { this.tags.push(line); }
  },
  parse(lrc: string): string {
    const lines = lrc.split(/\r\n|\r|\n/);
    const tools = Object.create(this);
    tools.isOK = true; tools.offset = 1; tools.offset2 = 1; tools.lines = []; tools.tags = [];
    for (const line of lines) { if (!tools.isOK) throw new Error('failed'); tools.parseLine(line); }
    if (!tools.lines.length) return '';
    let lrcs = tools.lines.join('\n');
    if (tools.tags.length) lrcs = `${tools.tags.join('\n')}\n${lrcs}`;
    return lrcs;
  },
};

function kwBuildParams(id: string, isGetLyricx: boolean): string {
  let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}`;
  if (isGetLyricx) params += '&lrcx=1';
  const bufStr = new TextEncoder().encode(params);
  const keyBytes = new TextEncoder().encode('yeelion');
  const output = new Uint8Array(bufStr.length);
  let i = 0;
  while (i < bufStr.length) {
    let j = 0;
    while (j < keyBytes.length && i < bufStr.length) { output[i] = keyBytes[j] ^ bufStr[i]; i++; j++; }
  }
  let binary = '';
  for (let k = 0; k < output.length; k++) binary += String.fromCharCode(output[k]);
  return btoa(binary);
}

function kwSortLrcArr(arr: { time: string; text: string }[]): { lrc: any[]; lrcT: any[] } {
  const lrcSet = new Set<string>();
  const lrc: { time: string; text: string }[] = [];
  const lrcT: { time: string; text: string }[] = [];
  let isLyricx = false;
  for (const item of arr) {
    if (lrcSet.has(item.time)) {
      if (lrc.length < 2) continue;
      const tItem = lrc.pop()!;
      tItem.time = lrc[lrc.length - 1].time;
      lrcT.push(tItem);
      lrc.push(item);
    } else { lrc.push(item); lrcSet.add(item.time); }
    if (!isLyricx && KW_LYRICX_TAG.test(item.text)) isLyricx = true;
  }
  if (!isLyricx && lrcT.length > lrc.length * 0.3 && lrc.length - lrcT.length > 6) throw new Error('failed');
  return { lrc, lrcT };
}

function kwTransformLrc(tags: string[], lrclist: { time: string; text: string }[]): string {
  return `${tags.join('\n')}\n${lrclist ? lrclist.map(l => `[${l.time}]${l.text}\n`).join('') : '暂无歌词'}`;
}

function kwParseLrc(lrc: string): LxLyricResult {
  const lines = lrc.split(/\r\n|\r|\n/);
  const tags: string[] = [];
  const lrcArr: { time: string; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    KW_TIME_EXP.lastIndex = 0;
    const result = KW_TIME_EXP.exec(line);
    if (result) {
      const text = line.replace(KW_TIME_EXP, '').trim();
      let time = RegExp.$1;
      if (/\.\d\d$/.test(time)) time += '0';
      lrcArr.push({ time, text });
    } else if (kwLrcTools.rxps.tagLine.test(line)) { tags.push(line); }
  }
  const lrcInfo = kwSortLrcArr(lrcArr);
  return {
    lyric: decodeName(kwTransformLrc(tags, lrcInfo.lrc)),
    tlyric: lrcInfo.lrcT.length ? decodeName(kwTransformLrc(tags, lrcInfo.lrcT)) : '',
    rlyric: '', lxlyric: '',
  };
}

async function fetchKwLyric(songInfo: LxSongInfo): Promise<LxLyricResult | null> {
  const url = `http://newlyric.kuwo.cn/newlyric.lrc?${kwBuildParams(songInfo.songmid, true)}`;
  const resp = await tauriHttpFetchBinary(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'http://www.kuwo.cn/',
      'Accept': '*/*',
    },
  });
  if (resp.status !== 200) return null;
  const decoded = await decodeKwLyric(resp.body_base64, true);
  let lrcInfo: LxLyricResult;
  try { lrcInfo = kwParseLrc(decoded); } catch { return null; }
  if (lrcInfo.tlyric) lrcInfo.tlyric = lrcInfo.tlyric.replace(kwLrcTools.rxps.wordTimeAll, '');
  try {
    const lxlyric = kwLrcTools.parse(lrcInfo.lyric);
    if (lxlyric) {
      lrcInfo.lxlyric = lxlyric;
      // 调试日志：打印含 <> 标签的前3行（跳过元数据 tag 行）
      const wordLines = lxlyric.split('\n').filter(l => l.includes('<'));
      const preview = wordLines.slice(0, 3).join(' | ');
      console.log('[fetchKwLyric] kw lxlyric word lines preview:', preview);
    }
  } catch { lrcInfo.lxlyric = ''; }
  lrcInfo.lyric = lrcInfo.lyric.replace(kwLrcTools.rxps.wordTimeAll, '');
  if (!KW_EXIST_TIME_EXP.test(lrcInfo.lyric)) return null;
  return lrcInfo;
}

// ==================== QQ Music (tx) Lyric Fetching ====================

const txParseTools = {
  rxps: {
    lineTime: /^\[(\d+),\d+\]/,
    lineTime2: /^\[([\d:.]+)\]/,
    wordTime: /\(\d+,\d+\)/,
    wordTimeAll: /(\(\d+,\d+\))/g,
  },
  msFormat(timeMs: number): string {
    if (Number.isNaN(timeMs)) return '';
    let ms = timeMs % 1000;
    timeMs /= 1000;
    const m = parseInt(String(timeMs / 60)).toString().padStart(2, '0');
    timeMs %= 60;
    const s = parseInt(String(timeMs)).toString().padStart(2, '0');
    return `[${m}:${s}.${String(ms).padStart(3, '0')}]`;
  },
  parseLyric(lrc: string): { lyric: string; lxlyric: string } {
    lrc = lrc.trim().replace(/\r/g, '');
    if (!lrc) return { lyric: '', lxlyric: '' };
    const lines = lrc.split('\n');
    const lxlrcLines: string[] = [];
    const lrcLines: string[] = [];
    for (let line of lines) {
      line = line.trim();
      const result = this.rxps.lineTime.exec(line);
      if (!result) {
        if (line.startsWith('[offset')) { lxlrcLines.push(line); lrcLines.push(line); }
        if (this.rxps.lineTime2.test(line)) lrcLines.push(line);
        continue;
      }
      const startMsTime = parseInt(result[1]);
      const startTimeStr = this.msFormat(startMsTime);
      if (!startTimeStr) continue;
      const words = line.replace(this.rxps.lineTime, '');
      lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, '')}`);
let times: string[] | null = words.match(this.rxps.wordTimeAll);
if (!times) continue;
times = times.map(time => {
const r = /\((\d+),(\d+)\)/.exec(time)!;
return `<${Math.max(parseInt(r[1]) - startMsTime, 0)},${r[2]}>`;
});
      const wordArr = words.split(this.rxps.wordTime);
      const newWords = times.map((time, index) => `${time}${wordArr[index]}`).join('');
      lxlrcLines.push(`${startTimeStr}${newWords}`);
    }
    return { lyric: lrcLines.join('\n'), lxlyric: lxlrcLines.join('\n') };
  },
  parseRlyric(lrc: string): string {
    lrc = lrc.trim().replace(/\r/g, '');
    if (!lrc) return '';
    const lines = lrc.split('\n');
    const lrcLines: string[] = [];
    for (let line of lines) {
      line = line.trim();
      const result = this.rxps.lineTime.exec(line);
      if (!result) continue;
      const startMsTime = parseInt(result[1]);
      const startTimeStr = this.msFormat(startMsTime);
      if (!startTimeStr) continue;
      const words = line.replace(this.rxps.lineTime, '');
      lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, '')}`);
    }
    return lrcLines.join('\n');
  },
  removeTag(str: string): string {
    return str.replace(/^[\S\s]*?LyricContent="/, '').replace(/"\/>[\S\s]*?$/, '');
  },
  getIntv(interval: string): number {
    if (!interval) return 0;
    if (!interval.includes('.')) interval += '.0';
    const arr = interval.split(/:|\./);
    while (arr.length < 3) arr.unshift('0');
    const [m, s, ms] = arr;
    return parseInt(m) * 3600000 + parseInt(s) * 1000 + parseInt(ms);
  },
  fixRlrcTimeTag(rlrc: string, lrc: string): string {
    const rlrcLines = rlrc.split('\n');
    const lrcLines = lrc.split('\n');
    const newLrc: string[] = [];
    rlrcLines.forEach(line => {
      const result = this.rxps.lineTime2.exec(line);
      if (!result) return;
      const words = line.replace(this.rxps.lineTime2, '');
      if (!words.trim()) return;
      const t1 = this.getIntv(result[1]);
      while (lrcLines.length) {
        const lrcLine = lrcLines.shift()!;
        const lrcLineResult = this.rxps.lineTime2.exec(lrcLine);
        if (!lrcLineResult) continue;
        const t2 = this.getIntv(lrcLineResult[1]);
        if (Math.abs(t1 - t2) < 100) { newLrc.push(line.replace(this.rxps.lineTime2, lrcLineResult[0])); break; }
      }
    });
    return newLrc.join('\n');
  },
  fixTlrcTimeTag(tlrc: string, lrc: string): string {
    const tlrcLines = tlrc.split('\n');
    const lrcLines = lrc.split('\n');
    const newLrc: string[] = [];
    tlrcLines.forEach(line => {
      const result = this.rxps.lineTime2.exec(line);
      if (!result) return;
      const words = line.replace(this.rxps.lineTime2, '');
      if (!words.trim()) return;
      let time = result[1];
      if (time.includes('.')) time += ''.padStart(3 - time.split('.')[1].length, '0');
      const t1 = this.getIntv(time);
      while (lrcLines.length) {
        const lrcLine = lrcLines.shift()!;
        const lrcLineResult = this.rxps.lineTime2.exec(lrcLine);
        if (!lrcLineResult) continue;
        const t2 = this.getIntv(lrcLineResult[1]);
        if (Math.abs(t1 - t2) < 100) { newLrc.push(line.replace(this.rxps.lineTime2, lrcLineResult[0])); break; }
      }
    });
    return newLrc.join('\n');
  },
  parse(lrc: string, tlrc: string, rlrc: string): LxLyricResult {
    const info: LxLyricResult = { lyric: '', tlyric: '', rlyric: '', lxlyric: '' };
    if (lrc) {
      const { lyric, lxlyric } = this.parseLyric(this.removeTag(lrc));
      info.lyric = lyric; info.lxlyric = lxlyric;
    }
    if (rlrc) info.rlyric = this.fixRlrcTimeTag(this.parseRlyric(this.removeTag(rlrc)), info.lyric);
    if (tlrc) info.tlyric = this.fixTlrcTimeTag(tlrc, info.lyric);
    return info;
  },
};

/**
 * 从旧版 API 获取 QQ 音乐普通歌词（移植自 Go 的 qqGetLyricsOld）
 * 返回 base64 解码后的 LRC 和翻译
 */
async function qqGetLyricsOld(songmid: string): Promise<{ lyric: string; tlyric: string }> {
  const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songmid}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`;
  const resp = await tauriHttpFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
      'Referer': 'https://y.qq.com/portal/player.html',
    },
  });
  if (resp.status !== 200) return { lyric: '', tlyric: '' };
  let body: any;
  try { body = JSON.parse(resp.body); } catch { return { lyric: '', tlyric: '' }; }
  if (body.retcode !== 0) return { lyric: '', tlyric: '' };

  let lyric = '';
  let tlyric = '';
  if (body.lyric) {
    try { lyric = new TextDecoder('utf-8').decode(base64ToUint8Array(body.lyric)); } catch { /* ignore */ }
  }
  if (body.trans) {
    try { tlyric = new TextDecoder('utf-8').decode(base64ToUint8Array(body.trans)); } catch { /* ignore */ }
  }
  return { lyric, tlyric };
}

/**
 * 获取 QQ 音乐歌词（移植自 Go 的 qqGetQRC + qqGetLyricsOld）
 *
 * 1. 通过 GetPlayLyricInfo (qrc=1, qrc_t=1) 获取加密 QRC 数据
 * 2. 3DES 解密 + zlib 解压 → parseQRC 转为 lxlyric 格式
 * 3. 如果 QRC 不可用，回退到旧版 c.y.qq.com API 获取普通 LRC
 */
async function fetchTxLyric(songInfo: LxSongInfo): Promise<LxLyricResult | null> {
  const songId = String(songInfo.songId || songInfo.songmid);
  const songmid = songInfo.songmid;

  // 1. 通过新 API 获取 QRC 逐字歌词 (qrc=1, qrc_t=1)
  const resp = await tauriHttpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      referer: 'https://y.qq.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comm: { uin: '0', format: 'json', ct: '19', cv: '1859' },
      req: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param: {
          songMID: songmid,
          songID: parseInt(songId) || 0,
          songType: 0,
          qrc: 1,
          qrc_t: 1,
        },
      },
    }),
  });

  let lxlyric = '';
  let lyric = '';
  let tlyric = '';
  let rlyric = '';

  if (resp.status === 200) {
    let body: any;
    try { body = JSON.parse(resp.body); } catch { body = null; }
    if (body && body.code === 0 && body.req?.code === 0) {
      const data = body.req.data;
      // QRC 解密：hex → 3DES 解密 → zlib 解压 → XML 提取 → parseQRC
      if (data.lyric) {
        try {
          const decrypted = await qrcDecrypt(data.lyric);
          const parsed = txParseTools.parse(decrypted, '', '');
          if (parsed.lyric) lyric = parsed.lyric;
          if (parsed.lxlyric) lxlyric = parsed.lxlyric;
        } catch { /* QRC 解密失败 */ }
      }
      if (data.trans) {
        try { tlyric = (await qrcDecrypt(data.trans)).replace(/^.*?LyricContent="/, '').replace(/"\/>[\S\s]*$/, ''); } catch { /* ignore */ }
      }
      if (data.roma) {
        try { rlyric = (await qrcDecrypt(data.roma)).replace(/^.*?LyricContent="/, '').replace(/"\/>[\S\s]*$/, ''); } catch { /* ignore */ }
      }
    }
  }

  // 2. 如果 QRC 没有获取到歌词，回退到旧版 API 获取普通 LRC
  if (!lyric && !lxlyric) {
    const old = await qqGetLyricsOld(songmid);
    lyric = old.lyric;
    tlyric = old.tlyric;
  }

  if (!lyric && !lxlyric) return null;

  return { lyric, tlyric, rlyric, lxlyric };
}

// ==================== NetEase (wy) Lyric Fetching ====================

function wyFixTimeLabel(lrc: string, tlrc: string, romalrc: string): { lrc: string; tlrc: string; romalrc: string } {
  if (lrc) {
    let newLrc = lrc.replace(/\[(\d{2}:\d{2}):(\d{2})]/g, '[$1.$2]');
    let newTlrc = tlrc?.replace(/\[(\d{2}:\d{2}):(\d{2})]/g, '[$1.$2]') ?? tlrc;
    if (newLrc != lrc || newTlrc != tlrc) {
      lrc = newLrc; tlrc = newTlrc;
      if (romalrc) romalrc = romalrc.replace(/\[(\d{2}:\d{2}):(\d{2,3})]/g, '[$1.$2]').replace(/\[(\d{2}:\d{2}\.\d{2})0]/g, '[$1]');
    }
  }
  return { lrc, tlrc, romalrc };
}

// ==================== NetEase YRC/KRC 逐字歌词解析（移植自 zzgc/music-lyrics.go） ====================

/**
 * 解析 YRC 格式逐字歌词（移植自 Go 的 parseYRC 函数）
 *
 * 输入格式: [lineStart,lineDuration](wordStart,wordDur,0)word(wordStart,wordDur,0)word...
 * 可能包含 JSON 元数据行: {"t":0,"c":[...]}
 *
 * 输出格式: [MM:ss.mmm]<offset,duration>word<offset,duration>word...
 *   offset = wordStart - lineStart（相对于行首的偏移，毫秒）
 */
function parseYRC(yrcText: string): string {
  const lines = yrcText.split('\n');
  const result: string[] = [];
  const lineTimeRe = /^\[(\d+),(\d+)\]/;
  const wordTagRe = /\((\d+),(\d+),\d+\)/g;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('{')) continue;

    const lineMatch = lineTimeRe.exec(line);
    if (!lineMatch) continue;
    const startMs = parseInt(lineMatch[1]);

    const content = line.substring(lineMatch[0].length);

    // 查找所有 (wordStart,wordDur,0) 标签及其位置
    const tags: { start: number; dur: number; matchStart: number; matchEnd: number }[] = [];
    let m: RegExpExecArray | null;
    wordTagRe.lastIndex = 0;
    while ((m = wordTagRe.exec(content)) !== null) {
      tags.push({
        start: parseInt(m[1]),
        dur: parseInt(m[2]),
        matchStart: m.index,
        matchEnd: m.index + m[0].length,
      });
    }

    if (tags.length === 0) continue;

    const timeStr = `${String(Math.floor(startMs / 60000)).padStart(2, '0')}:${String(Math.floor((startMs % 60000) / 1000)).padStart(2, '0')}.${String(startMs % 1000).padStart(3, '0')}`;
    let sb = `[${timeStr}]`;

    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      let offset = tag.start - startMs;
      if (offset < 0) offset = 0;

      // 文本在当前标签之后、下一个标签之前
      const textStart = tag.matchEnd;
      const textEnd = i + 1 < tags.length ? tags[i + 1].matchStart : content.length;
      const text = content.substring(textStart, textEnd);

      sb += `<${offset},${tag.dur}>${text}`;
    }

    result.push(sb);
  }

  return result.join('\n');
}

/**
 * 从 EAPI 响应中提取 YRC 逐字歌词
 * 优先检查 body.yrc，其次检查 body.klyric（可能是 YRC 格式文本）
 */
function tryExtractYRC(body: any): string {
  if (!body || body.code !== 200) return '';

  // 1. 检查 yrc 字段
  const yrc = body.yrc;
  if (yrc && yrc.lyric) {
    const result = parseYRC(yrc.lyric);
    if (result) return result;
  }

  // 2. 检查 klyric 字段是否包含 YRC 格式文本
  // 网易云某些歌曲没有 yrc 字段，但 klyric.lyric 是 YRC 格式文本
  const klyric = body.klyric;
  if (klyric && typeof klyric === 'object' && typeof klyric.lyric === 'string' && klyric.lyric.length > 50) {
    // YRC 格式以 [数字,数字] 开头
  if (/^\[\d+,\d+\]/m.test(klyric.lyric)) {
      const result = parseYRC(klyric.lyric);
      if (result) return result;
    }
  }
  if (typeof klyric === 'string' && klyric.length > 50 && /^\[\d+,\d+\]/m.test(klyric)) {
    const result = parseYRC(klyric);
    if (result) return result;
  }

  return '';
}

// ---- KRC 二进制逐字歌词解析（移植自 Go 的 wyyDecodeKRC / wyyParseKRC / krcLinesToLxLyric） ----

// 网易云 KRC 二进制 XOR 密钥（与酷狗 KRC 密钥不同）
const WYY_KRC_KEY = new Uint8Array([0x40, 0x47, 0x61, 0x77, 0x5e, 0x66, 0x44, 0x6d, 0x63, 0x71, 0x6f, 0x69, 0x67, 0x41, 0x39, 0x74]);

/**
 * 解码 KRC base64 数据：base64 → XOR(WYY_KRC_KEY)
 */
function wyyDecodeKRC(encoded: string): Uint8Array {
  if (!isValidBase64(encoded)) return new Uint8Array(0);
  try {
    const data = base64ToUint8Array(encoded);
    if (data.length === 0) return new Uint8Array(0);
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i] ^ WYY_KRC_KEY[i % WYY_KRC_KEY.length];
    }
    return result;
  } catch {
    return new Uint8Array(0);
  }
}

function readUint32LE(data: Uint8Array, pos: number): number {
  if (pos + 4 > data.length) return 0;
  return (data[pos]) | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24);
}

interface KrcLine {
  time: number;
  words: { start: number; dur: number; text: string }[];
}

/**
 * 解析 KRC 二进制格式
 * 结构: [headerLen(4)] [header] [tagLen(4)] [tag] [line data...]
 * 每个 line: [lineTime(4)] [wordCount(4)] [word: [dur(4)] [strLen(1)] [str bytes]]...
 */
function wyyParseKRC(raw: Uint8Array): KrcLine[] {
  if (raw.length < 4) return [];
  const headerLen = readUint32LE(raw, 0);
  if (headerLen <= 0 || headerLen >= raw.length) return [];
  const body = raw.subarray(headerLen);
  if (body.length < 4) return [];
  const tagLen = readUint32LE(body, 0);
  let offset = tagLen + 4;
  if (offset >= body.length) return [];
  const data = body.subarray(offset);

  const lines: KrcLine[] = [];
  let pos = 0;
  const dataLen = data.length;

  while (pos < dataLen - 4) {
    const lineTime = readUint32LE(data, pos);
    pos += 4;
    if (pos >= dataLen) break;
    const wordCount = readUint32LE(data, pos);
    pos += 4;

    const words: { start: number; dur: number; text: string }[] = [];
    let prevEnd = lineTime;

    for (let w = 0; w < wordCount && pos + 4 <= dataLen; w++) {
      const wordDur = readUint32LE(data, pos);
      pos += 4;
      if (pos + 1 > dataLen) break;
      const strLen = data[pos];
      pos++;
      if (pos + strLen > dataLen) break;
      const text = new TextDecoder('utf-8').decode(data.subarray(pos, pos + strLen));
      pos += strLen;

      const start = prevEnd;
      const end = start + wordDur;
      words.push({ start, dur: end - start, text });
      prevEnd = end;
    }

    lines.push({ time: lineTime, words });
  }

  return lines;
}

/**
 * 将 KRC 行数据转为 lxlyric 格式: [MM:ss.mmm]<offset,duration>word...
 */
function krcLinesToLxLyric(lines: KrcLine[]): string {
  const result: string[] = [];
  for (const line of lines) {
    if (line.words.length === 0) continue;
    const lineStart = line.time;
    const timeStr = `${String(Math.floor(lineStart / 60000)).padStart(2, '0')}:${String(Math.floor((lineStart % 60000) / 1000)).padStart(2, '0')}.${String(lineStart % 1000).padStart(3, '0')}`;
    let sb = `[${timeStr}]`;
    for (const word of line.words) {
      let offset = word.start - lineStart;
      if (offset < 0) offset = 0;
      sb += `<${offset},${word.dur}>${word.text}`;
    }
    result.push(sb);
  }
  return result.join('\n');
}

/**
 * 从 EAPI 响应中提取 KRC 二进制逐字歌词（YRC 的后备方案）
 * 搜索 klyric 字段和其他可能包含 KRC 数据的字段
 */
function tryExtractKRC(body: any): string {
  if (!body || body.code !== 200) return '';

  // 查找 klyric 字段
  const klyric = body.klyric;
  if (typeof klyric === 'string' && klyric.length > 100 && klyric !== 'null' && isValidBase64(klyric)) {
    const decoded = wyyDecodeKRC(klyric);
    if (decoded.length > 0) {
      const lines = wyyParseKRC(decoded);
      if (lines.length > 0) return krcLinesToLxLyric(lines);
    }
  }
  if (klyric && typeof klyric === 'object' && typeof klyric.lyric === 'string' && klyric.lyric.length > 100) {
    const lyricStr = klyric.lyric;
    // 先尝试 base64 KRC 解码
    if (isValidBase64(lyricStr)) {
      const decoded = wyyDecodeKRC(lyricStr);
      if (decoded.length > 0) {
        const lines = wyyParseKRC(decoded);
        if (lines.length > 0) return krcLinesToLxLyric(lines);
      }
    }
    // 如果不是 base64，尝试直接作为文本解析（可能是 YRC 格式）
    if (/^\[\d+,\d+\]/m.test(lyricStr)) {
      const result = parseYRC(lyricStr);
      if (result) return result;
    }
  }

  // 遍历所有字段寻找 KRC 数据（跳过明显的非 base64 字符串如 URL、JSON）
  for (const key in body) {
    if (key === 'code') continue;
    const val = body[key];
    if (typeof val === 'string' && val.length > 100 && !val.startsWith('[') && !val.startsWith('{') && !val.startsWith('http') && isValidBase64(val)) {
      const decoded = wyyDecodeKRC(val);
      if (decoded.length > 0) {
        const lines = wyyParseKRC(decoded);
        if (lines.length > 0) return krcLinesToLxLyric(lines);
      }
    }
    if (val && typeof val === 'object') {
      for (const subKey in val) {
        const subVal = val[subKey];
        if (typeof subVal === 'string' && subVal.length > 100 && !subVal.startsWith('[') && !subVal.startsWith('{') && !subVal.startsWith('http') && isValidBase64(subVal)) {
          const decoded = wyyDecodeKRC(subVal);
          if (decoded.length > 0) {
            const lines = wyyParseKRC(decoded);
            if (lines.length > 0) return krcLinesToLxLyric(lines);
          }
        }
      }
    }
  }

  return '';
}

/**
 * 获取网易云逐字歌词（移植自 Go 的 wyyGetKaraoke 函数）
 *
 * 1. 优先通过 /eapi/song/lyric/v1 (kv=1) 获取 YRC
 * 2. YRC 不存在时，尝试 KRC 二进制格式
 * 3. 尝试 /eapi/song/lyric (kv=1) 作为后备
 */
async function wyyGetKaraoke(songId: string): Promise<string> {
  // 使用 lx-music-desktop 的参数（已验证可获取 YRC 逐字歌词）
  // 关键：kv=0 + yv=0 + ytv=0 + yrv=0 让 API 返回 yrc 字段
  // Go 代码的 kv=1 + yt=false 只请求 klyric（二进制KRC），大部分歌曲没有该字段
  const form = wyEapiEncrypt('/api/song/lyric/v1', {
    id: songId, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0,
  });
  const resp = await tauriHttpFetch('https://interface3.music.163.com/eapi/song/lyric/v1', {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36', origin: 'https://music.163.com', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `params=${form.params}`,
  });
  if (resp.status === 200) {
    let body: any;
    try { body = JSON.parse(resp.body); } catch { body = null; }
    if (body) {
      // 优先从 yrc 字段提取 YRC 格式文本
      const yrc = tryExtractYRC(body);
      if (yrc) return yrc;
      // 后备：从 klyric 字段提取 KRC 二进制数据
      const krc = tryExtractKRC(body);
      if (krc) return krc;
      console.warn('[wyyGetKaraoke] 未提取到逐字歌词, code:', body.code, 'hasYrc:', !!body.yrc, 'hasKlyric:', !!body.klyric, 'klyricLyricLen:', body.klyric?.lyric?.length ?? 0);
    }
  }

  // 后备：使用 Go 代码的参数（kv=1 请求 klyric 二进制 KRC）
  const form2 = wyEapiEncrypt('/api/song/lyric/v1', {
    cp: -1, id: Number(songId), kv: 1, lv: -1, rv: 0, tv: -1, yt: false, yv: 0,
  });
  const resp2 = await tauriHttpFetch('https://interface3.music.163.com/eapi/song/lyric/v1', {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154', Cookie: 'os=pc; appver=8.9.75; osver=; deviceId=pyncm!', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `params=${form2.params}`,
  });
  if (resp2.status === 200) {
    let body2: any;
    try { body2 = JSON.parse(resp2.body); } catch { body2 = null; }
    if (body2) {
      const yrc = tryExtractYRC(body2);
      if (yrc) return yrc;
      const krc = tryExtractKRC(body2);
      if (krc) return krc;
    }
  }

  return '';
}

/**
 * 获取网易云歌词（移植自 Go 的 wyyGetLyrics + wyyGetKaraoke）
 *
 * 1. /eapi/song/lyric 获取普通歌词 (lyric + tlyric)
 * 2. /eapi/song/lyric/v1 (kv=1) 获取逐字歌词 (YRC → KRC 回退)
 */
async function fetchWyLyric(songInfo: LxSongInfo): Promise<LxLyricResult | null> {
  // 使用 lx-music-desktop 的参数，一次请求获取 lrc + tlyric + yrc
  const form = wyEapiEncrypt('/api/song/lyric/v1', {
    id: songInfo.songmid, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0,
  });
  const resp = await tauriHttpFetch('https://interface3.music.163.com/eapi/song/lyric/v1', {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36', origin: 'https://music.163.com', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `params=${form.params}`,
  });

  let lyric = '';
  let tlyric = '';
  let lxlyric = '';

  if (resp.status === 200) {
    try {
      const body = JSON.parse(resp.body);
      if (body.code === 200) {
        if (body.lrc?.lyric) lyric = body.lrc.lyric;
        if (body.tlyric?.lyric) tlyric = body.tlyric.lyric;
        // 从 yrc 字段提取逐字歌词
        lxlyric = tryExtractYRC(body);
        // 如果 yrc 没有提取到，尝试 klyric
        if (!lxlyric) lxlyric = tryExtractKRC(body);
      }
    } catch { /* ignore */ }
  }

  // 如果第一次请求没有获取到逐字歌词，尝试 Go 代码的参数作为后备
  if (!lxlyric) {
    lxlyric = await wyyGetKaraoke(songInfo.songmid);
  }

  if (!lyric && !lxlyric) return null;

  // 修复时间标签格式
  const fixed = wyFixTimeLabel(lyric, tlyric, '');

  return {
    lyric: fixed.lrc,
    tlyric: fixed.tlrc,
    rlyric: '',
    lxlyric,
  };
}

// ==================== lxlyric 格式归一化 ====================

/**
 * 按音源归一化 lxlyric 格式
 * 所有音源（kg/kw/tx/wy）的 lxlyric 都已是相对行首偏移格式，无需归一化。
 * Go 源码的 handleKw/handleWyy 等都不做归一化。
 * 此函数保留仅为向后兼容，直接返回原数据。
 */
export function normalizeLxlyricBySource(_source: string, lxlyric: string): string {
  return lxlyric;
}

// ==================== Unified Entry Point ====================

/**
 * 获取歌词（包括逐字歌词）
 *
 * 直接从音乐平台官方 API 获取歌词，方法移植自 zzgc/music-lyrics.go：
 * - wy (网易云): EAPI 加密 → /eapi/song/lyric/v1 (kv=1) → YRC 逐字 → KRC 二进制回退
 * - tx (QQ音乐): GetPlayLyricInfo (qrc=1, qrc_t=1) → QRC 3DES 解密 → 旧版API回退
 * - kw (酷我):   XOR 加密请求 → zlib 解压 → 逐字歌词解析
 * - kg (酷狗):   KRC 解密 → 逐字歌词解析
 *
 * 注意：返回的 lxlyric 统一使用相对偏移格式 <offsetMs,durationMs>（相对于行首）。
 * kg/kw 的绝对时间戳会被归一化为相对偏移。
 */
export async function fetchLxLyric(
  source: 'kw' | 'kg' | 'tx' | 'wy',
  songInfo: LxSongInfo,
): Promise<LxLyricResult | null> {
  // 直接从音乐平台官方 API 获取歌词（移植自 zzgc/music-lyrics.go 的方法）
  try {
    let result: LxLyricResult | null = null;
    switch (source) {
      case 'kg': result = await fetchKgLyric(songInfo); break;
      case 'kw': result = await fetchKwLyric(songInfo); break;
      case 'tx': result = await fetchTxLyric(songInfo); break;
      case 'wy': result = await fetchWyLyric(songInfo); break;
      default: return null;
    }
    // 归一化 lxlyric：kw/kg/tx/wy 的 word 时间都已是相对行首偏移，不需要归一化
    // Go 源码的 handleKw 也不做归一化——kwParseLxLyric 输出已是正确格式
    // 之前的 normalizeLxlyricToRelative 会把已正确的相对偏移减去行首时间，导致全部变成 0
    return result;
  } catch (e) {
    console.warn(`[lxLyricFetcher] 获取 ${source} 歌词失败:`, e);
    return null;
  }
}

const LX_SOURCES = new Set(['kw', 'kg', 'tx', 'wy']);

/** 获取 LX 在线歌曲歌词并转换为播放器支持的原始歌词文本。 */
export async function fetchLxSongLyricsRaw(song: Song): Promise<string> {
  if (song.lyrics_raw?.trim()) return song.lyrics_raw;

  const match = /^lx:\/\/([^/]+)\/(.+)$/.exec(song.path);
  if (!match) return '';

  const [, source, songmid] = match;
  if (!LX_SOURCES.has(source) || !songmid) return '';

  const extendedSong = song as Song & {
    _hash?: string;
    _songmid?: string;
    _copyrightId?: string;
  };
  const cached = getCachedLxSongInfo(source, songmid);
  const songInfo: LxSongInfo = {
    songmid: cached?.songmid || extendedSong._songmid || songmid,
    hash: cached?.hash || extendedSong._hash,
    name: cached?.name || song.title || song.name,
    singer: cached?.singer || song.artist || '',
    albumName: cached?.albumName || song.album,
    interval: cached?.interval,
    _interval: cached?._interval,
    songId: cached?.songId,
    strMediaMid: cached?.strMediaMid,
    albumMid: cached?.albumMid,
    albumId: cached?.albumId,
    copyrightId: cached?.copyrightId || extendedSong._copyrightId,
    source,
  };

  const lyrics = await fetchLxLyric(source as 'kw' | 'kg' | 'tx' | 'wy', songInfo);
  if (!lyrics) return '';

  return buildLyricsRaw(lyrics.lyric, lyrics.tlyric, lyrics.rlyric, lyrics.lxlyric);
}
