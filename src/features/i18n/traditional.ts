import { Converter } from 'opencc-js/cn2t';

import type { AppLanguage } from '../../types';

/**
 * 简繁转换服务。
 *
 * 使用 opencc-js 的 cn2t 子集（简体 → 繁体），转换目标为台湾正体并使用台湾常用词汇
 * （from: 'cn', to: 'twp'）。转换器实例懒加载并缓存，避免重复构建字典。
 *
 * 注意：简繁并非一一对应，转换是单向的（简 → 繁）。切回简体应通过刷新页面
 * 重新渲染原始简体文本，而非反向转换。
 */

type ConverterFn = (text: string) => string;

let converter: ConverterFn | null = null;

/** 短文本转换结果缓存，避免对相同文本（如重复出现的 UI 标签）反复转换。 */
const conversionCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 5000;
/** 超过此长度的文本不缓存（多为歌词整段/长描述，命中率低且占内存）。 */
const MAX_CACHEABLE_LENGTH = 64;

function getConverter(): ConverterFn {
  if (!converter) {
    converter = Converter({ from: 'cn', to: 'twp' });
  }
  return converter;
}

/** 判断字符串是否包含需要转换的中文字符（CJK 统一表意文字）。 */
function containsHan(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

/**
 * 将简体中文文本转换为繁体（台湾正体）。
 *
 * - 空串、无中文字符的文本原样返回（跳过转换开销）。
 * - 短文本结果进入缓存。
 */
export function toTraditional(text: string): string {
  if (!text || !containsHan(text)) return text;

  const cacheable = text.length <= MAX_CACHEABLE_LENGTH;
  if (cacheable) {
    const cached = conversionCache.get(text);
    if (cached !== undefined) return cached;
  }

  const converted = getConverter()(text);

  if (cacheable) {
    if (conversionCache.size >= MAX_CACHE_ENTRIES) {
      conversionCache.clear();
    }
    conversionCache.set(text, converted);
  }

  return converted;
}

/** 当前语言是否为繁体中文。 */
export function isTraditionalLanguage(language: AppLanguage): boolean {
  return language === 'zh-TW';
}
