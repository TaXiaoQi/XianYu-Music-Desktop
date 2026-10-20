import { exactEnglishTranslations } from './englishExactTranslations';
import { dynamicEnglishTranslations } from './englishDynamicTranslations';

const containsHan = (value: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(value);

export const toEnglish = (text: string): string => {
  if (!text || !containsHan(text)) return text;

  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trailing = text.match(/\s*$/)?.[0] ?? '';
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return text;

  const exact = exactEnglishTranslations[normalized];
  if (exact) return `${leading}${exact}${trailing}`;

  for (const rule of dynamicEnglishTranslations) {
    const matches = normalized.match(rule.pattern);
    if (matches) {
      return `${leading}${rule.replace(...matches)}${trailing}`;
    }
  }

  return text;
};

export const hasEnglishTranslation = (text: string): boolean => (
  toEnglish(text) !== text
);
