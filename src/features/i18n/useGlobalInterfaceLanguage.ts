import { watch } from 'vue';

import { useI18n } from './index';
import { toEnglish } from './english';
import { toTraditional } from './traditional';
import type { AppLanguage } from '../../types';

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'TEXTAREA',
  'INPUT',
]);

const TRANSLATED_ATTRIBUTES = ['title', 'placeholder', 'aria-label'] as const;
const originalText = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const appliedAttributes = new WeakMap<Element, Map<string, string>>();

const hasHan = (value: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(value);

function shouldSkipElement(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.hasAttribute('data-no-translate')) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  return false;
}

function isInsideSkippedSubtree(node: Node): boolean {
  let current: Node | null = node.parentNode;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE && shouldSkipElement(current as Element)) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function translateSource(source: string, language: AppLanguage): string {
  if (language === 'zh-TW') return toTraditional(source);
  if (language === 'en-US') return toEnglish(source);
  return source;
}

function translateTextNode(node: Text, language: AppLanguage, force = false): void {
  const current = node.nodeValue ?? '';
  if (!current.trim() || isInsideSkippedSubtree(node)) return;

  const previouslyApplied = appliedText.get(node);
  if (!force && previouslyApplied === current) return;

  if (!force) {
    if (hasHan(current)) {
      originalText.set(node, current);
    } else {
      // Vue reused this node for an already-localized value. It is now the source of truth.
      originalText.delete(node);
      appliedText.delete(node);
      return;
    }
  }

  const source = originalText.get(node);
  if (!source) return;
  const translated = translateSource(source, language);
  if (translated === current) {
    appliedText.delete(node);
    return;
  }

  appliedText.set(node, translated);
  node.nodeValue = translated;
}

function translateElementAttributes(
  element: Element,
  language: AppLanguage,
  force = false,
): void {
  if (element.hasAttribute('data-no-translate')) return;

  let originals = originalAttributes.get(element);
  let applied = appliedAttributes.get(element);
  if (!originals) {
    originals = new Map<string, string>();
    originalAttributes.set(element, originals);
  }
  if (!applied) {
    applied = new Map<string, string>();
    appliedAttributes.set(element, applied);
  }

  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    if (!force && applied.get(attribute) === current) continue;

    if (!force) {
      if (hasHan(current)) {
        originals.set(attribute, current);
      } else {
        originals.delete(attribute);
        applied.delete(attribute);
        continue;
      }
    }

    const source = originals.get(attribute);
    if (!source) continue;
    const translated = translateSource(source, language);
    if (translated === current) {
      applied.delete(attribute);
      continue;
    }

    applied.set(attribute, translated);
    element.setAttribute(attribute, translated);
  }
}

function translateSubtree(root: Node, language: AppLanguage, force = false): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, language, force);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE) {
    const rootElement = root as Element;
    translateElementAttributes(rootElement, language, force);
    if (shouldSkipElement(rootElement)) return;

    rootElement
      .querySelectorAll('[title], [placeholder], [aria-label]')
      .forEach(element => translateElementAttributes(element, language, force));
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const value = node.nodeValue;
        if (!value?.trim() || isInsideSkippedSubtree(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let current = walker.nextNode();
  while (current) {
    translateTextNode(current as Text, language, force);
    current = walker.nextNode();
  }
}

/**
 * Localizes legacy interface text that has not yet been migrated to typed `t()` keys.
 * User-editable fields and explicitly marked data are excluded so track metadata is untouched.
 */
export function useGlobalInterfaceLanguage(): void {
  const { language } = useI18n();
  let observer: MutationObserver | null = null;
  let hasScannedDocument = false;

  const stopObserver = () => {
    observer?.disconnect();
    observer = null;
  };

  const startObserver = (activeLanguage: AppLanguage) => {
    stopObserver();
    translateSubtree(document.body, activeLanguage, hasScannedDocument);
    hasScannedDocument = true;

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          translateTextNode(mutation.target as Text, activeLanguage);
          continue;
        }
        if (mutation.type === 'attributes') {
          translateElementAttributes(mutation.target as Element, activeLanguage);
          continue;
        }
        for (const added of mutation.addedNodes) {
          translateSubtree(added, activeLanguage);
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [...TRANSLATED_ATTRIBUTES],
      characterData: true,
      childList: true,
      subtree: true,
    });
  };

  watch(
    language,
    (value) => {
      if (typeof document === 'undefined') return;
      startObserver(value);
    },
    { immediate: true },
  );
}
