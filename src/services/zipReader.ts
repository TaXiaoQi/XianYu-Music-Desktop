/**
 * 纯 JS ZIP 文件解析器
 *
 * 解析 ZIP 容器格式（PKZIP），提取文件内容。
 * 压缩方法支持：Stored（0）和 Deflated（8）。
 * Deflated 数据复用 pureInflate.ts 的 inflateRawSync。
 */

import { inflateRawSync, gunzipSync } from './pureInflate';

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;
const LFH_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;

function readUint16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readUint32(data: Uint8Array, offset: number): number {
  return ((data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0);
}

/** 读取 64 位小端整数（JavaScript number 精度安全到 2^53） */
function readUint64(data: Uint8Array, offset: number): number {
  const lo = readUint32(data, offset);
  const hi = readUint32(data, offset + 4);
  return hi * 0x100000000 + lo;
}

function findEocd(data: Uint8Array): number {
  const minEocdSize = 22;
  const maxCommentSize = 65535;
  const searchStart = Math.max(0, data.length - minEocdSize - maxCommentSize);

  for (let i = data.length - minEocdSize; i >= searchStart; i--) {
    if (readUint32(data, i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

export function parseZip(data: Uint8Array): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();

  const eocdOffset = findEocd(data);
  if (eocdOffset === -1) throw new Error('ZIP: 未找到 End of Central Directory Record');

  let totalEntries = readUint16(data, eocdOffset + 10);
  let cdOffset = readUint32(data, eocdOffset + 16);

  // ZIP64: 当 EOCD 中的值为 0xFFFF / 0xFFFFFFFF 时，需要查找 ZIP64 EOCD 记录
  if (totalEntries === 0xFFFF || cdOffset === 0xFFFFFFFF) {
    // ZIP64 EOCD Locator 紧邻 EOCD 之前（20 字节）
    if (eocdOffset >= 20) {
      const locatorOffset = eocdOffset - 20;
      if (readUint32(data, locatorOffset) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
        const zip64EocdOffset = readUint64(data, locatorOffset + 8);
        if (readUint32(data, zip64EocdOffset) === ZIP64_EOCD_SIGNATURE) {
          if (totalEntries === 0xFFFF) {
            totalEntries = readUint64(data, zip64EocdOffset + 24);
          }
          if (cdOffset === 0xFFFFFFFF) {
            cdOffset = readUint64(data, zip64EocdOffset + 48);
          }
        }
      }
    }
  }

  let offset = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (readUint32(data, offset) !== CD_SIGNATURE) {
      throw new Error(`ZIP: 无效的 Central Directory 条目 #${i}`);
    }

    const compressionMethod = readUint16(data, offset + 10);
    let compressedSize = readUint32(data, offset + 20);
    const filenameLength = readUint16(data, offset + 28);
    const extraFieldLength = readUint16(data, offset + 30);
    const commentLength = readUint16(data, offset + 32);
    let localHeaderOffset = readUint32(data, offset + 42);

    const filename = new TextDecoder().decode(
      data.subarray(offset + 46, offset + 46 + filenameLength),
    );

    // 解析 ZIP64 扩展字段（extra field ID = 0x0001）
    if (compressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF) {
      let extraOffset = offset + 46 + filenameLength;
      const extraEnd = extraOffset + extraFieldLength;
      while (extraOffset + 4 <= extraEnd) {
        const fieldId = readUint16(data, extraOffset);
        const fieldSize = readUint16(data, extraOffset + 2);
        if (fieldId === 0x0001) {
          let p = extraOffset + 4;
          // 顺序：uncompressedSize, compressedSize, localHeaderOffset（仅当对应 CD 字段为 0xFFFFFFFF 时存在）
          if (readUint32(data, offset + 24) === 0xFFFFFFFF) p += 8; // 跳过 uncompressedSize
          if (compressedSize === 0xFFFFFFFF) {
            compressedSize = readUint64(data, p);
            p += 8;
          }
          if (localHeaderOffset === 0xFFFFFFFF) {
            localHeaderOffset = readUint64(data, p);
          }
          break;
        }
        extraOffset += 4 + fieldSize;
      }
    }

    offset += 46 + filenameLength + extraFieldLength + commentLength;

    if (filename.endsWith('/')) continue;

    if (readUint32(data, localHeaderOffset) !== LFH_SIGNATURE) {
      throw new Error(`ZIP: 无效的 Local File Header: ${filename}`);
    }

    const lfhFilenameLength = readUint16(data, localHeaderOffset + 26);
    const lfhExtraFieldLength = readUint16(data, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + lfhFilenameLength + lfhExtraFieldLength;

    const compressedData = data.subarray(dataOffset, dataOffset + compressedSize);

    let fileData: Uint8Array;
    if (compressionMethod === 0) {
      fileData = compressedData;
    } else if (compressionMethod === 8) {
      fileData = inflateRawSync(compressedData);
    } else {
      throw new Error(`ZIP: 不支持的压缩方法 ${compressionMethod} (${filename})`);
    }

    result.set(filename, fileData);
  }

  return result;
}

export function extractJsonFromZip(data: Uint8Array): string {
  const entries = parseZip(data);
  const files = [...entries.keys()].filter(f => !f.endsWith('/'));

  // 1. 优先查找 .json 文件
  for (const [filename, fileData] of entries) {
    if (filename.toLowerCase().endsWith('.json')) {
      return new TextDecoder().decode(fileData);
    }
  }

  // 2. 查找 .lxmc 文件（gzip 压缩的 JSON，如洛雪音乐备份被打包在 ZIP 中）
  for (const [filename, fileData] of entries) {
    if (filename.toLowerCase().endsWith('.lxmc')) {
      try {
        const inflated = gunzipSync(fileData);
        return new TextDecoder().decode(inflated);
      } catch { /* 解压失败则继续尝试其他文件 */
      }
    }
  }

  // 3. 尝试内容检测：任何以 { 或 [ 开头的文件（可能是无扩展名的 JSON 备份）
  for (const [, fileData] of entries) {
    const text = new TextDecoder().decode(fileData);
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return text;
    }
  }

  // 4. 如果只有一个文件，无论扩展名都尝试作为 JSON 返回
  if (files.length === 1) {
    return new TextDecoder().decode(entries.get(files[0])!);
  }

  // 5. 友好的错误信息，列出 ZIP 内的文件帮助排查
  const fileList = files.length > 0 ? files.map(f => `"${f}"`).join(', ') : '(空)';
  throw new Error(`ZIP 中未找到可识别的备份文件。包含: ${fileList}`);
}
