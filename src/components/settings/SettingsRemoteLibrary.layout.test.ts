import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SettingsRemoteLibrary.vue', import.meta.url), 'utf8');

const styleBlock = source.match(/<style scoped>([\s\S]*)<\/style>/)?.[1] ?? '';
const remoteFormGridRule = styleBlock.match(/\.remote-form-grid\s*\{([\s\S]*?)\}/)?.[1] ?? '';
const remoteInputRule = styleBlock.match(/\.remote-input\s*\{([\s\S]*?)\}/)?.[1] ?? '';
const darkRemoteInputRule = styleBlock.match(/:global\(\.dark\) \.remote-input\s*\{([\s\S]*?)\}/)?.[1] ?? '';

describe('SettingsRemoteLibrary layout', () => {
  it('keeps the remote source fields in a single column', () => {
    expect(remoteFormGridRule).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(remoteFormGridRule).not.toContain('repeat(2');
    expect(source).not.toContain('remote-field remote-field--wide');
  });

  it('does not render the remote source form as a card container', () => {
    expect(styleBlock).not.toMatch(/\.remote-form,\s*\.remote-source-list,/);
    expect(styleBlock).not.toMatch(/:global\(\.dark\) \.remote-form,/);
    expect(styleBlock).not.toMatch(/\.remote-form\s*\{[\s\S]*(?:background|border-radius|padding)/);
  });

  it('uses translucent input surfaces instead of solid white fields', () => {
    expect(remoteInputRule).toContain('background: rgba(255, 255, 255, 0.36);');
    expect(remoteInputRule).toContain('border: 1px solid rgba(255, 255, 255, 0.34);');
    expect(remoteInputRule).not.toContain('background: rgba(255, 255, 255, 0.72);');
    expect(darkRemoteInputRule).toContain('background: rgba(255, 255, 255, 0.08);');
  });
});
