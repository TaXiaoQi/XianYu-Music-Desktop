import { describe, expect, it } from 'vitest';

import { extractDuration, parseDuration, toPluginSearchResult } from './pluginResultMappers';
import type { PluginSource } from '../types';

function makePlugin(): PluginSource {
  return {
    id: 'test-plugin',
    name: '网易云音乐',
    format: 'musicfree',
    version: '1.0.0',
    author: 'tester',
    description: '',
    filePath: 'source.js',
    importedAt: 1,
    enabled: true,
    sources: ['网易云音乐'],
  };
}

describe('parseDuration', () => {
  it('parses numeric seconds into milliseconds', () => {
    expect(parseDuration(215)).toBe(215000);
  });

  it('parses numeric milliseconds directly', () => {
    expect(parseDuration(215000)).toBe(215000);
  });

  it('parses duration string formatted as mm:ss', () => {
    expect(parseDuration('03:35')).toBe(215000);
    expect(parseDuration('3:35')).toBe(215000);
  });

  it('parses duration string formatted as hh:mm:ss', () => {
    expect(parseDuration('01:02:03')).toBe(3723000);
  });

  it('parses numeric string in seconds or milliseconds', () => {
    expect(parseDuration('215')).toBe(215000);
    expect(parseDuration('215000')).toBe(215000);
  });

  it('returns 0 for empty or invalid values', () => {
    expect(parseDuration(0)).toBe(0);
    expect(parseDuration(null)).toBe(0);
    expect(parseDuration(undefined)).toBe(0);
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('invalid')).toBe(0);
  });
});

describe('extractDuration', () => {
  it('extracts duration from item dt property (Netease format)', () => {
    const item = { id: '1', title: '歌', dt: 215000 };
    expect(extractDuration(item)).toBe(215000);
  });

  it('extracts duration from rawData nested dt property', () => {
    const item = { id: '1', title: '歌', rawData: { dt: 215000 } };
    expect(extractDuration(item)).toBe(215000);
  });

  it('extracts duration from interval string property', () => {
    const item = { id: '1', title: '歌', interval: '04:15' };
    expect(extractDuration(item)).toBe(255000);
  });

  it('prefers top-level valid duration over zero fallback', () => {
    const item = { id: '1', title: '歌', duration: 0, dt: 180000 };
    expect(extractDuration(item)).toBe(180000);
  });
});

describe('toPluginSearchResult duration mapping', () => {
  it('maps Netease dt field correctly onto search result duration', () => {
    const plugin = makePlugin();
    const item = {
      id: '1001',
      name: '助眠雨声',
      singer: '雨声',
      album: '自然声音',
      dt: 320000,
    };

    const result = toPluginSearchResult(item, plugin);
    expect(result.duration).toBe(320000);
  });
});
