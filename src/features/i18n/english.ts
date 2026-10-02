import { exactEnglishTranslations } from './englishExactTranslations';
import { dynamicEnglishTranslations } from './englishDynamicTranslations';

const containsHan = (value: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(value); // 实现

export const toEnglish = (text: string): string => { // 实现
  if (!text || !containsHan(text)) return text; // 实现

  const leading = text.match(/^\s*/)?.[0] ?? ''; // 实现
  const trailing = text.match(/\s*$/)?.[0] ?? ''; // 实现
  const normalized = text.trim().replace(/\s+/g, ' '); // 实现
  if (!normalized) return text; // 实现

  const exact = exactEnglishTranslations[normalized]; // 实现
  if (exact) return `${leading}${exact}${trailing}`; // 实现

  for (const rule of dynamicEnglishTranslations) { // 实现
    const matches = normalized.match(rule.pattern); // 实现
    if (matches) { // 实现
      return `${leading}${rule.replace(...matches)}${trailing}`; // 实现
    }
  }

  return text; // 实现
};

export const hasEnglishTranslation = (text: string): boolean => ( // 实现
  toEnglish(text) !== text // 实现
);
