
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

  if (totalEntries === 0xFFFF || cdOffset === 0xFFFFFFFF) {
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

    if (compressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF) {
      let extraOffset = offset + 46 + filenameLength;
      const extraEnd = extraOffset + extraFieldLength;
      while (extraOffset + 4 <= extraEnd) {
        const fieldId = readUint16(data, extraOffset);
        const fieldSize = readUint16(data, extraOffset + 2);
        if (fieldId === 0x0001) {
          let p = extraOffset + 4;
          if (readUint32(data, offset + 24) === 0xFFFFFFFF) p += 8;
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

  for (const [filename, fileData] of entries) {
    if (filename.toLowerCase().endsWith('.json')) {
      return new TextDecoder().decode(fileData);
    }
  }

  for (const [filename, fileData] of entries) {
    if (filename.toLowerCase().endsWith('.lxmc')) {
      try {
        const inflated = gunzipSync(fileData);
        return new TextDecoder().decode(inflated);
      } catch { /* 解压失败则继续尝试其他文件 */
      }
    }
  }

  for (const [, fileData] of entries) {
    const text = new TextDecoder().decode(fileData);
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return text;
    }
  }

  if (files.length === 1) {
    return new TextDecoder().decode(entries.get(files[0])!);
  }

  const fileList = files.length > 0 ? files.map(f => `"${f}"`).join(', ') : '(空)';
  throw new Error(`ZIP 中未找到可识别的备份文件。包含: ${fileList}`);
}
