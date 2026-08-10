/**
 * 纯 JS DEFLATE 解码器 —— 基于 RFC 1951 的紧凑 inflate 实现
 *
 * 提供同步解压能力，浏览器 DecompressionStream 仅支持异步，
 * 无法满足插件中 zlib.inflateSync / pako.inflate 等同步调用需求。
 *
 * 支持格式自动检测：zlib (0x78...) / gzip (0x1f 0x8b) / raw DEFLATE
 */

import { Buffer } from 'buffer';

// ==================== Huffman 解码 ====================

interface HuffmanTable {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffmanTable(lengths: Uint8Array): HuffmanTable {
  const counts = new Int32Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  counts[0] = 0;

  const offsets = new Int32Array(16);
  let sum = 0;
  for (let i = 1; i < 16; i++) { offsets[i] = sum; sum += counts[i]; }

  const symbols = new Int32Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] !== 0) symbols[offsets[lengths[i]]++] = i;
  }
  return { counts, symbols };
}

class BitReader {
  data: Uint8Array;
  bytePos = 0;
  bitPos = 0;

  constructor(data: Uint8Array) { this.data = data; }

  readBit(): number {
    if (this.bytePos >= this.data.length) throw new Error('DEFLATE: 数据意外结束');
    const bit = (this.data[this.bytePos] >> this.bitPos) & 1;
    this.bitPos++;
    if (this.bitPos === 8) { this.bitPos = 0; this.bytePos++; }
    return bit;
  }

  readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) result |= this.readBit() << i;
    return result;
  }

  alignToByte(): void {
    if (this.bitPos > 0) { this.bitPos = 0; this.bytePos++; }
  }
}

// ==================== DEFLATE 常量表 ====================

const LEN_BASE = new Int32Array([3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258]);
const LEN_EXTRA = new Int32Array([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]);
const DIST_BASE = new Int32Array([1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577]);
const DIST_EXTRA = new Int32Array([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]);
const CL_ORDER = new Int32Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);

function decodeHuffmanSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0, first = 0, index = 0;
  for (let len = 1; len <= 15; len++) {
    code = (code << 1) | reader.readBit();
    const count = table.counts[len];
    if (code < first + count) return table.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
  }
  throw new Error('DEFLATE: 无效 Huffman 编码');
}

// 预构建固定 Huffman 表（RFC 1951 §3.2.6）
const FIXED_LIT_LENGTHS = new Uint8Array(288);
for (let i = 0; i < 144; i++) FIXED_LIT_LENGTHS[i] = 8;
for (let i = 144; i < 256; i++) FIXED_LIT_LENGTHS[i] = 9;
for (let i = 256; i < 280; i++) FIXED_LIT_LENGTHS[i] = 7;
for (let i = 280; i < 288; i++) FIXED_LIT_LENGTHS[i] = 8;
const FIXED_LIT_TABLE = buildHuffmanTable(FIXED_LIT_LENGTHS);
const FIXED_DIST_TABLE = buildHuffmanTable(new Uint8Array(30).fill(5));

// ==================== 块解码 ====================

function inflateBlock(
  output: number[],
  reader: BitReader,
  litTable: HuffmanTable,
  distTable: HuffmanTable,
): void {
  while (true) {
    const sym = decodeHuffmanSymbol(reader, litTable);
    if (sym === 256) break;
    if (sym < 256) {
      output.push(sym);
    } else {
      const lenIdx = sym - 257;
      const length = LEN_BASE[lenIdx] + (LEN_EXTRA[lenIdx] > 0 ? reader.readBits(LEN_EXTRA[lenIdx]) : 0);
      const distSym = decodeHuffmanSymbol(reader, distTable);
      const distance = DIST_BASE[distSym] + (DIST_EXTRA[distSym] > 0 ? reader.readBits(DIST_EXTRA[distSym]) : 0);
      const start = output.length - distance;
      for (let j = 0; j < length; j++) output.push(output[start + j]);
    }
  }
}

// ==================== 公开 API ====================

/** 解压 raw DEFLATE 数据（RFC 1951） */
export function inflateRawSync(data: Uint8Array): Uint8Array {
  if (!data || data.length === 0) return new Uint8Array(0);
  const reader = new BitReader(data);
  const output: number[] = [];
  let finalBlock = false;

  while (!finalBlock) {
    finalBlock = reader.readBit() === 1;
    const btype = reader.readBits(2);

    if (btype === 0) {
      // Stored block
      reader.alignToByte();
      const len = reader.data[reader.bytePos] | (reader.data[reader.bytePos + 1] << 8);
      reader.bytePos += 4; // 跳过 LEN + NLEN
      for (let i = 0; i < len; i++) output.push(reader.data[reader.bytePos++]);
    } else if (btype === 1) {
      // Fixed Huffman
      inflateBlock(output, reader, FIXED_LIT_TABLE, FIXED_DIST_TABLE);
    } else if (btype === 2) {
      // Dynamic Huffman
      const hlit = reader.readBits(5) + 257;
      const hdist = reader.readBits(5) + 1;
      const hclen = reader.readBits(4) + 4;

      const clLengths = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) clLengths[CL_ORDER[i]] = reader.readBits(3);
      const clTable = buildHuffmanTable(clLengths);

      const lengths = new Uint8Array(hlit + hdist);
      let i = 0;
      while (i < hlit + hdist) {
        const sym = decodeHuffmanSymbol(reader, clTable);
        if (sym < 16) {
          lengths[i++] = sym;
        } else if (sym === 16) {
          const count = reader.readBits(2) + 3;
          const prev = lengths[i - 1];
          for (let j = 0; j < count; j++) lengths[i++] = prev;
        } else if (sym === 17) {
          i += reader.readBits(3) + 3;
        } else if (sym === 18) {
          i += reader.readBits(7) + 11;
        }
      }

      inflateBlock(
        output, reader,
        buildHuffmanTable(lengths.subarray(0, hlit)),
        buildHuffmanTable(lengths.subarray(hlit)),
      );
    } else {
      throw new Error('DEFLATE: 无效块类型 3');
    }
  }

  return new Uint8Array(output);
}

/** 解压 zlib 格式数据（2 字节头 + DEFLATE + 4 字节校验） */
export function inflateZlibSync(data: Uint8Array): Uint8Array {
  if (data.length < 6) throw new Error('zlib: 数据过短');
  if ((data[0] & 0x0f) !== 8) throw new Error('zlib: 不支持的压缩方法');
  let offset = 2;
  if (data[1] & 0x20) offset += 4; // FDICT
  return inflateRawSync(data.subarray(offset, data.length - 4));
}

/** 解压 gzip 格式数据 */
export function gunzipSync(data: Uint8Array): Uint8Array {
  if (data.length < 18 || data[0] !== 0x1f || data[1] !== 0x8b) throw new Error('gzip: 无效头部');
  if (data[2] !== 8) throw new Error('gzip: 不支持的压缩方法');
  const flg = data[3];
  let offset = 10;
  if (flg & 0x04) { const xlen = data[offset] | (data[offset + 1] << 8); offset += 2 + xlen; }
  if (flg & 0x08) { while (data[offset] !== 0) offset++; offset++; }
  if (flg & 0x10) { while (data[offset] !== 0) offset++; offset++; }
  if (flg & 0x02) offset += 2;
  return inflateRawSync(data.subarray(offset, data.length - 8));
}

/** 自动检测格式（zlib / gzip / raw deflate）并解压 */
export function inflateAutoSync(data: Uint8Array): Uint8Array {
  if (data.length >= 2) {
    if (data[0] === 0x1f && data[1] === 0x8b) return gunzipSync(data);
    if ((data[0] & 0x0f) === 8 && ((data[0] << 8 | data[1]) % 31 === 0)) return inflateZlibSync(data);
  }
  return inflateRawSync(data);
}

/** 将各种输入类型转为 Uint8Array */
export function toUint8Array(data: any): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof data === 'object' && data.buffer instanceof ArrayBuffer) {
    return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.buffer.byteLength);
  }
  return Buffer.from(data);
}
