
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import type { QualityKey } from '../../types';

const AUDIO_EXT_PATTERN = /^\.(mp3|flac|wav|m4a|aac|ape|ogg|wma)$/;

const LOSSY_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wma']);

export function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot === -1) return '';
    const ext = pathname.slice(dot).toLowerCase();
    return AUDIO_EXT_PATTERN.test(ext) ? ext : '';
  } catch {
    return '';
  }
}

export function isDegradedLossless(quality: QualityKey, url: string): boolean {
  if (!QUALITY_META[quality]?.isLossless) return false;
  const ext = extFromUrl(url);
  if (!ext) return false;
  return LOSSY_EXTENSIONS.has(ext);
}

// 酷狗「蝰蛇」音效流（quviper_atmos 全景声 / quviper_clear 超清母带）是
// 酷狗自研 VIPER 编码伪装的 .flac 后缀，标准 FLAC 解码得到错乱 PCM——
// 表现为破音/撕裂（atmos 档还会解出伪 6ch、clear 档伪 96kHz）。客户端
// 无 VIPER 解码器，解析命中这类流时视为该档不可用，降级尝试下一档
// （hires/quhigh 等标准流正常）。
export function isViperEncodedStream(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('quviper_atmos_') || u.includes('quviper_clear_');
}

export function resolveActualQuality(quality: QualityKey, url: string): QualityKey {
  if (!isDegradedLossless(quality, url)) return quality;

  const claimedIdx = ALL_QUALITY_KEYS.indexOf(quality);
  if (claimedIdx <= 0) return quality;

  for (let i = claimedIdx - 1; i >= 0; i--) {
    const candidate = ALL_QUALITY_KEYS[i];
    if (!QUALITY_META[candidate].isLossless) return candidate;
  }

  return quality;
}
