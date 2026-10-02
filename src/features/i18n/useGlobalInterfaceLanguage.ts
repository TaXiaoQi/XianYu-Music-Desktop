import { watch } from 'vue'; // 实现

import { useI18n } from './index'; // 实现
import { toEnglish } from './english'; // 实现
import { toTraditional } from './traditional';
import type { AppLanguage } from '../../types'; // 实现

const SKIP_TAGS = new Set([ // 实现
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'TEXTAREA',
  'INPUT',
]);

const TRANSLATED_ATTRIBUTES = ['title', 'placeholder', 'aria-label'] as const; // 实现
const originalText = new WeakMap<Text, string>(); // 实现
const appliedText = new WeakMap<Text, string>(); // 实现
const originalAttributes = new WeakMap<Element, Map<string, string>>(); // 实现
const appliedAttributes = new WeakMap<Element, Map<string, string>>(); // 实现

const hasHan = (value: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(value); // 实现

function shouldSkipElement(element: Element): boolean { // 实现
  if (SKIP_TAGS.has(element.tagName)) return true; // 实现
  if (element.hasAttribute('data-no-translate')) return true; // 实现
  if ((element as HTMLElement).isContentEditable) return true; // 实现
  return false; // 实现
}

function isInsideSkippedSubtree(node: Node): boolean { // 实现
  let current: Node | null = node.parentNode; // 实现
  while (current) { // 实现
    if (current.nodeType === Node.ELEMENT_NODE && shouldSkipElement(current as Element)) { // 实现
      return true; // 实现
    }
    current = current.parentNode; // 实现
  }
  return false; // 实现
}

function translateSource(source: string, language: AppLanguage): string { // 实现
  if (language === 'zh-TW') return toTraditional(source); // 实现
  if (language === 'en-US') return toEnglish(source); // 实现
  // zh-CN 是源码基准语言，文本本身已是大陆简体，原样返回即可。
  // 这里不能再过 toSimplified()：它走的是 OpenCC「台湾用语 → 大陆用语」反查表，
  // 做的是词汇替换而非单纯字形转换，会把已经正确的简体词改坏——
  // 实测 toSimplified('文件夹') === '文档夹'（台湾的「文件」= 大陆的「文档」）。
  // 该问题曾导致侧边栏「文件夹」在简中界面显示为「文档夹」。
  return source;
}

function translateTextNode(node: Text, language: AppLanguage, force = false): void { // 实现
  const current = node.nodeValue ?? ''; // 实现
  if (!current.trim() || isInsideSkippedSubtree(node)) return; // 实现

  const previouslyApplied = appliedText.get(node); // 实现
  if (!force && previouslyApplied === current) return; // 实现

  if (!force) { // 实现
    if (hasHan(current)) { // 实现
      originalText.set(node, current); // 实现
    } else {
      originalText.delete(node); // 实现
      appliedText.delete(node); // 实现
      return;
    }
  }

  const source = originalText.get(node); // 实现
  if (!source) return; // 实现
  const translated = translateSource(source, language); // 实现
  if (translated === current) { // 实现
    appliedText.delete(node); // 实现
    return;
  }

  appliedText.set(node, translated); // 实现
  node.nodeValue = translated; // 实现
}

function translateElementAttributes( // 实现
  element: Element, // 实现
  language: AppLanguage, // 实现
  force = false, // 实现
): void {
  if (element.hasAttribute('data-no-translate')) return; // 实现

  let originals = originalAttributes.get(element); // 实现
  let applied = appliedAttributes.get(element); // 实现
  if (!originals) { // 实现
    originals = new Map<string, string>(); // 实现
    originalAttributes.set(element, originals); // 实现
  }
  if (!applied) { // 实现
    applied = new Map<string, string>(); // 实现
    appliedAttributes.set(element, applied); // 实现
  }

  for (const attribute of TRANSLATED_ATTRIBUTES) { // 实现
    const current = element.getAttribute(attribute); // 实现
    if (!current) continue; // 实现
    if (!force && applied.get(attribute) === current) continue; // 实现

    if (!force) { // 实现
      if (hasHan(current)) { // 实现
        originals.set(attribute, current); // 实现
      } else {
        originals.delete(attribute); // 实现
        applied.delete(attribute); // 实现
        continue;
      }
    }

    const source = originals.get(attribute); // 实现
    if (!source) continue; // 实现
    const translated = translateSource(source, language); // 实现
    if (translated === current) { // 实现
      applied.delete(attribute); // 实现
      continue;
    }

    applied.set(attribute, translated); // 实现
    element.setAttribute(attribute, translated); // 实现
  }
}

function translateSubtree(root: Node, language: AppLanguage, force = false): void { // 实现
  if (root.nodeType === Node.TEXT_NODE) { // 实现
    translateTextNode(root as Text, language, force); // 实现
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) { // 实现
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE) { // 实现
    const rootElement = root as Element; // 实现
    translateElementAttributes(rootElement, language, force); // 实现
    if (shouldSkipElement(rootElement)) return; // 实现

    rootElement
      .querySelectorAll('[title], [placeholder], [aria-label]') // 实现
      .forEach(element => translateElementAttributes(element, language, force)); // 实现
  }

  const walker = document.createTreeWalker( // 实现
    root,
    NodeFilter.SHOW_TEXT, // 实现
    {
      acceptNode(node) { // 实现
        const value = node.nodeValue; // 实现
        if (!value?.trim() || isInsideSkippedSubtree(node)) { // 实现
          return NodeFilter.FILTER_REJECT; // 实现
        }
        return NodeFilter.FILTER_ACCEPT; // 实现
      },
    },
  );

  let current = walker.nextNode(); // 实现
  while (current) { // 实现
    translateTextNode(current as Text, language, force); // 实现
    current = walker.nextNode(); // 实现
  }
}

export function useGlobalInterfaceLanguage(): void { // 实现
  const { language } = useI18n(); // 实现
  let observer: MutationObserver | null = null; // 实现
  let hasScannedDocument = false; // 实现

  const stopObserver = () => { // 实现
    observer?.disconnect(); // 实现
    observer = null; // 实现
  };

  const startObserver = (activeLanguage: AppLanguage) => { // 实现
    stopObserver(); // 实现
    translateSubtree(document.body, activeLanguage, hasScannedDocument); // 实现
    hasScannedDocument = true; // 实现

    observer = new MutationObserver((mutations) => { // 实现
      for (const mutation of mutations) { // 实现
        if (mutation.type === 'characterData') { // 实现
          translateTextNode(mutation.target as Text, activeLanguage); // 实现
          continue;
        }
        if (mutation.type === 'attributes') { // 实现
          translateElementAttributes(mutation.target as Element, activeLanguage); // 实现
          continue;
        }
        for (const added of mutation.addedNodes) { // 实现
          translateSubtree(added, activeLanguage); // 实现
        }
      }
    });

    observer.observe(document.body, { // 实现
      attributes: true, // 实现
      attributeFilter: [...TRANSLATED_ATTRIBUTES], // 实现
      characterData: true, // 实现
      childList: true, // 实现
      subtree: true, // 实现
    });
  };

  watch(
    language,
    (value) => { // 实现
      if (typeof document === 'undefined') return; // 实现
      startObserver(value); // 实现
    },
    { immediate: true }, // 实现
  );
}
