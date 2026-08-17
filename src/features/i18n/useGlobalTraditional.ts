import { watch } from 'vue';

import { toTraditional } from './traditional';
import { useI18n } from './index';

/**
 * 全局界面简繁转换。
 *
 * 当语言切换为繁体中文（zh-TW）时，遍历页面文本节点将简体原地转换为繁体，
 * 并用 MutationObserver 持续转换后续新增/变化的文本节点。
 *
 * 由于简繁并非一一对应，无法从繁体反推简体，因此切回简体（zh-CN / en-US）时
 * 通过刷新页面重新渲染原始文本（见 App 层的语言切换处理）。
 *
 * 排除策略（避免误转用户数据）：
 * - 表单元素：input / textarea / [contenteditable]
 * - 非文本容器：script / style / noscript / code / pre
 * - 显式标记：任何带 data-no-translate 的元素及其子树
 */

/** 不应转换其文本内容的标签（大写，用于 tagName 比对）。 */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'TEXTAREA',
  'INPUT',
]);

/** 已处理并写回的文本节点，避免 characterData 变化触发的自转换死循环。 */
const processedTextNodes = new WeakSet<Text>();

function shouldSkipElement(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.hasAttribute('data-no-translate')) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  return false;
}

/** 判断文本节点是否处于被排除的祖先内。 */
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

function convertTextNode(node: Text): void {
  const original = node.nodeValue;
  if (!original || !original.trim()) return;
  if (isInsideSkippedSubtree(node)) return;

  const converted = toTraditional(original);
  if (converted !== original) {
    node.nodeValue = converted;
  }
  // 无论是否变化都标记，避免重复扫描同一节点。
  processedTextNodes.add(node);
}

/** 遍历某个根节点下的所有文本节点并转换。 */
function convertSubtree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    convertTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE && shouldSkipElement(root as Element)) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(textNode) {
      const value = textNode.nodeValue;
      if (!value || !value.trim()) return NodeFilter.FILTER_REJECT;
      if (isInsideSkippedSubtree(textNode)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const pending: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    pending.push(current as Text);
    current = walker.nextNode();
  }
  for (const textNode of pending) {
    convertTextNode(textNode);
  }
}

let observer: MutationObserver | null = null;

function startObserving(): void {
  if (observer || typeof MutationObserver === 'undefined') return;

  // 首次启用：全量转换现有 DOM。
  convertSubtree(document.body);

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const target = mutation.target;
        if (target.nodeType === Node.TEXT_NODE && !processedTextNodes.has(target as Text)) {
          convertTextNode(target as Text);
        }
      } else if (mutation.type === 'childList') {
        for (const added of mutation.addedNodes) {
          convertSubtree(added);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function stopObserving(): void {
  observer?.disconnect();
  observer = null;
}

/**
 * 在主窗口挂载，随语言变化启停全局繁体转换。
 * 仅在语言为 zh-TW 时观察并转换 DOM；其它语言停止观察（原始文本由页面刷新恢复）。
 */
export function useGlobalTraditional(): void {
  const { isTraditional } = useI18n();

  watch(
    isTraditional,
    (traditional) => {
      if (typeof document === 'undefined') return;
      if (traditional) {
        startObserving();
      } else {
        stopObserving();
      }
    },
    { immediate: true },
  );
}
