/**
 * 音源真实格式校验
 *
 * 背景：插件声称返回某个无损档位（flac / flac24bit / hires / master 等），
 * 但对没有对应版权的歌曲，部分音源会「静默降级」——直接返回一个 mp3 直链，
 * 仍标记为原档位。若信任这个标记：
 *   - 播放侧：UI 显示 HR/SQ，用户以为在听无损，实际是有损（欺骗性标记）
 *   - 下载侧：把 mp3 内容存成 .flac 扩展名（文件本身就是错的）
 *
 * 本模块提供播放与下载共用的单一判定入口，避免两侧各写一套、行为不一致
 * （历史上正是如此：下载校验、播放不校验，导致「能播 hires 却下不了」）。
 */

import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import type { QualityKey } from '../../types';

/** 可从 URL 推断的音频扩展名（含点，小写） */
const AUDIO_EXT_PATTERN = /^\.(mp3|flac|wav|m4a|aac|ape|ogg|wma)$/;

/** 明确属于有损压缩的扩展名——出现在无损档位上即表示音源降级 */
const LOSSY_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wma']);

/**
 * 从 URL 推断音频扩展名（含点，如 ".flac"）。
 *
 * 仅接受常见音频扩展名，避免把 query 参数或路径片段误判为扩展名。
 * 无法推断时返回空串（例如网易云的 `/xxx/yyy` 形式无扩展名直链）。
 */
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

/**
 * 判断某个无损档位的直链是否被音源静默降级为有损格式。
 *
 * 仅在「档位标称无损」且「URL 扩展名明确为有损格式」时返回 true。
 * URL 无扩展名时返回 false —— 无法证明降级，不做有罪推定，
 * 否则会把大量无扩展名直链的正常无损音源误判掉。
 *
 * @param quality 插件声称的档位
 * @param url 插件返回的直链
 */
export function isDegradedLossless(quality: QualityKey, url: string): boolean {
  if (!QUALITY_META[quality]?.isLossless) return false;
  const ext = extFromUrl(url);
  if (!ext) return false;
  return LOSSY_EXTENSIONS.has(ext);
}

/**
 * 依据直链真实格式修正插件声称的档位。
 *
 * 用于播放侧：音源把无损请求降级为 mp3 时，不能继续在 UI 上显示 HR/SQ，
 * 否则用户会以为自己在听无损。此时下调为与真实格式相符的最高有损档位。
 *
 * 选取策略：从声称档位向下找第一个「非无损」档位。这样 flac→320k、
 * flac24bit→320k（跳过中间的无损档），而不是一律硬编码成 320k，
 * 保留了档位表未来调整的适应性。
 *
 * 无法判定降级时原样返回声称档位。
 *
 * @param quality 插件声称的档位
 * @param url 插件返回的直链
 * @returns 修正后的档位
 */
export function resolveActualQuality(quality: QualityKey, url: string): QualityKey {
  if (!isDegradedLossless(quality, url)) return quality;

  const claimedIdx = ALL_QUALITY_KEYS.indexOf(quality);
  if (claimedIdx <= 0) return quality;

  // ALL_QUALITY_KEYS 按 rank 升序，向下查找最近的有损档位
  for (let i = claimedIdx - 1; i >= 0; i--) {
    const candidate = ALL_QUALITY_KEYS[i];
    if (!QUALITY_META[candidate].isLossless) return candidate;
  }

  return quality;
}
