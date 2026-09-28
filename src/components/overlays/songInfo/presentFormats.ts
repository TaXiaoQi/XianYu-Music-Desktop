// 元数据展示用的格式化工具（空值统一回退为占位文案）
import { formatFileSize } from '../../../utils/format';

const MISSING_TEXT = '无';

export const presentDuration = (seconds?: number): string => {
  if (!seconds) return MISSING_TEXT;
  const wholeSeconds = Math.floor(seconds);
  const minutePart = Math.floor(wholeSeconds / 60);
  const secondPart = String(wholeSeconds % 60).padStart(2, '0');
  return `${minutePart}:${secondPart}`;
};

export const presentSize = (bytes?: number): string => {
  if (bytes === undefined || bytes <= 0) return MISSING_TEXT;
  return formatFileSize(bytes);
};

export const presentBitrate = (bitrate?: number): string =>
  (!bitrate ? '待扫描' : `${Math.round(bitrate)} kbps`);

export const presentSampleRate = (rate?: number): string =>
  (!rate ? MISSING_TEXT : `${(rate / 1000).toFixed(1)} kHz`);

export const presentTimestamp = (epochSeconds?: number): string => {
  if (!epochSeconds) return MISSING_TEXT;
  return new Date(epochSeconds * 1000).toLocaleString();
};
