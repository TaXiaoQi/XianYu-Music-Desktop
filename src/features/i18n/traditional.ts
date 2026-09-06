import { Converter } from 'opencc-js/cn2t';
import { Converter as T2CNConverter } from 'opencc-js/t2cn';

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

/**
 * 将台湾正体文本转换回简体中文。
 *
 * 正常切回简本路径下 Vue 会按 zh-CN 词表重渲染，无需反向转换；但全局 DOM 翻译层在
 * 繁体期间会把 t() 输出或已翻译的繁体文本误当成"原始文本"重新捕获，污染 originalText，
 * 导致切回简体时读到的源是繁体而永远停在繁体。此函数用于在 DOM 层兜底反向还原。
 * 与 toTraditional 一样单向可逆性受限，仅作为还原兜底，不进业务词法判断。
 */
let reverseConverter: ConverterFn | null = null;
const reverseConversionCache = new Map<string, string>();

function getReverseConverter(): ConverterFn {
  if (!reverseConverter) {
    reverseConverter = T2CNConverter({ from: 'twp', to: 'cn' });
  }
  return reverseConverter;
}

export function toSimplified(text: string): string {
  if (!text || !containsHan(text)) return text;

  const cacheable = text.length <= MAX_CACHEABLE_LENGTH;
  if (cacheable) {
    const cached = reverseConversionCache.get(text);
    if (cached !== undefined) return cached;
  }

  const converted = getReverseConverter()(text);

  if (cacheable) {
    if (reverseConversionCache.size >= MAX_CACHE_ENTRIES) {
      reverseConversionCache.clear();
    }
    reverseConversionCache.set(text, converted);
  }

  return converted;
}
