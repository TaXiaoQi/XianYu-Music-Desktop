import { Converter } from 'opencc-js/cn2t';
import { Converter as T2CNConverter } from 'opencc-js/t2cn';

import type { AppLanguage } from '../../types';


type ConverterFn = (text: string) => string;

let converter: ConverterFn | null = null;

const conversionCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 5000;
const MAX_CACHEABLE_LENGTH = 64;

function getConverter(): ConverterFn {
  if (!converter) {
    converter = Converter({ from: 'cn', to: 'twp' });
  }
  return converter;
}

function containsHan(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

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

export function isTraditionalLanguage(language: AppLanguage): boolean {
  return language === 'zh-TW';
}

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
