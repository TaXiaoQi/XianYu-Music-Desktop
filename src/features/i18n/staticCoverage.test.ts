import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeTypes, parse as parseTemplate, type RootNode, type TemplateChildNode } from '@vue/compiler-dom';
import { parse as parseSfc } from '@vue/compiler-sfc';

import { toEnglish } from './english';

const hasHan = (value: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
const roots = ['components', 'views'].map(directory => resolve(process.cwd(), 'src', directory));
const ignoredSamples = new Set([
  '第一次参观卢浮宫',
  '我要离开家去往海岸线',
  '知难辞',
  '绛狐',
  '@知难辞',
  '@绛狐',
  'どうせ私なんかと',
  '反正像我这样的人',
  '夜航星',
]);

function collectVueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectVueFiles(path);
    return entry.isFile() && entry.name.endsWith('.vue') ? [path] : [];
  });
}

function collectStaticText(root: RootNode): string[] {
  const values: string[] = [];
  const visit = (node: RootNode | TemplateChildNode) => {
    if (node.type === NodeTypes.TEXT) {
      const normalized = node.content.trim().replace(/\s+/g, ' ');
      if (hasHan(normalized)) values.push(normalized);
      return;
    }
    if (node.type === NodeTypes.ELEMENT) {
      for (const prop of node.props) {
        if (
          prop.type === NodeTypes.ATTRIBUTE &&
          ['title', 'placeholder', 'aria-label'].includes(prop.name) &&
          prop.value &&
          hasHan(prop.value.content)
        ) {
          values.push(prop.value.content.trim().replace(/\s+/g, ' '));
        }
      }
    }
    if ('children' in node) node.children.forEach(visit);
    if (node.type === NodeTypes.IF) {
      node.branches.forEach(branch => branch.children.forEach(visit));
    }
    if (node.type === NodeTypes.FOR) node.children.forEach(visit);
  };
  visit(root);
  return values;
}

describe('English static interface coverage', () => {
  it('has translations for static Chinese interface text', () => {
    const missing = new Set<string>();
    for (const file of roots.flatMap(collectVueFiles)) {
      const source = readFileSync(file, 'utf8');
      const { descriptor } = parseSfc(source, { filename: file });
      if (!descriptor.template) continue;
      const template = parseTemplate(descriptor.template.content);
      for (const text of collectStaticText(template)) {
        if (!ignoredSamples.has(text) && toEnglish(text) === text) missing.add(text);
      }
    }

    expect([...missing].sort()).toEqual([]);
  });
});
