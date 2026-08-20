import { describe, expect, it } from 'vitest';

import { extractDuration, extractDurationMs, extractResultList, parseDuration, toPluginSearchResult } from './pluginResultMappers';
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

  it('parses long-video seconds (Bilibili collection 1000~59999s) as seconds, not milliseconds', () => {
    // B 站"歌曲大全"合集视频普遍 4~5.5 小时（14400~19980 秒），
    // 旧启发式（>1000 判毫秒）会把 5.5 小时合集显示成 19.9 秒
    expect(parseDuration(19930)).toBe(19930000);
    expect(parseDuration(1200)).toBe(1200000);
    expect(parseDuration('19930')).toBe(19930000);
  });

  it('treats 60000 boundary as milliseconds (1-minute audio in ms)', () => {
    expect(parseDuration(60000)).toBe(60000);
    expect(parseDuration(59999)).toBe(59999000);
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

  it('extracts duration from duration field in seconds (Baka QQ/网易云/酷我 format)', () => {
    const item = { id: '1', title: '歌', duration: 215 };
    expect(extractDuration(item)).toBe(215000);
  });

  it('extracts duration from durationSeconds field', () => {
    const item = { id: '1', title: '歌', durationSeconds: 255 };
    expect(extractDuration(item)).toBe(255000);
  });

  it('extracts duration from intervalSeconds field', () => {
    const item = { id: '1', title: '歌', intervalSeconds: 180 };
    expect(extractDuration(item)).toBe(180000);
  });

  it('extracts duration from nested al.dt field (Netease album node)', () => {
    const item = { id: '1', title: '歌', al: { dt: 240000 } };
    expect(extractDuration(item)).toBe(240000);
  });

  it('extracts duration from durationMs field', () => {
    const item = { id: '1', title: '歌', durationMs: 215000 };
    expect(extractDuration(item)).toBe(215000);
  });

  it('extracts duration from dur field', () => {
    const item = { id: '1', title: '歌', dur: 215 };
    expect(extractDuration(item)).toBe(215000);
  });

  it('extracts duration from len field', () => {
    const item = { id: '1', title: '歌', len: 240000 };
    expect(extractDuration(item)).toBe(240000);
  });

  it('extracts duration from nested song.duration inside rawData', () => {
    const item = { id: '1', title: '歌', rawData: { song: { duration: 215 } } };
    expect(extractDuration(item)).toBe(215000);
  });

  it('extracts duration from nested music.duration inside rawData', () => {
    const item = { id: '1', title: '歌', rawData: { music: { duration: 223 } } };
    expect(extractDuration(item)).toBe(223000);
  });

  it('extracts duration from nested data.duration inside rawData', () => {
    const item = { id: '1', title: '歌', rawData: { data: { duration: 300 } } };
    expect(extractDuration(item)).toBe(300000);
  });

  it('extracts duration from nested detail.duration inside rawData', () => {
    const item = { id: '1', title: '歌', rawData: { detail: { duration: 269 } } };
    expect(extractDuration(item)).toBe(269000);
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

describe('detail page data flow (extractResultList → toPluginSearchResult)', () => {
  const plugin = makePlugin();

  it('QQ 歌手详情页：formatMusicItem 返回 duration(秒)，列表在 data 字段', () => {
    const result = {
      isEnd: true,
      data: [
        { id: '1', name: '晴天', singer: '周杰伦', album: '叶惠美', duration: 269 },
        { id: '2', name: '七里香', singer: '周杰伦', album: '七里香', duration: 302 },
      ],
    };
    const list = extractResultList(result);
    expect(list.length).toBe(2);
    const mapped = list.map((item) => toPluginSearchResult(item, plugin));
    expect(mapped[0].duration).toBe(269000);
    expect(mapped[1].duration).toBe(302000);
  });

  it('网易云 专辑详情页：duration 在 musicList 字段', () => {
    const result = {
      albumItem: { id: 'a1', name: '专辑' },
      musicList: [
        { id: '1', name: '歌1', singer: '歌手', album: '专辑', duration: 223 },
        { id: '2', name: '歌2', singer: '歌手', album: '专辑', duration: 240 },
      ],
    };
    const list = extractResultList(result);
    expect(list.length).toBe(2);
    const mapped = list.map((item) => toPluginSearchResult(item, plugin));
    expect(mapped[0].duration).toBe(223000);
    expect(mapped[1].duration).toBe(240000);
  });

  it('酷我 歌单详情页：duration 在 musicList 字段', () => {
    const result = {
      isEnd: true,
      musicList: [
        { id: '1', name: '歌1', artist: '歌手', album: '专辑', duration: 215 },
        { id: '2', name: '歌2', artist: '歌手', album: '专辑', duration: 300 },
      ],
    };
    const list = extractResultList(result);
    expect(list.length).toBe(2);
    const mapped = list.map((item) => toPluginSearchResult(item, plugin));
    expect(mapped[0].duration).toBe(215000);
    expect(mapped[1].duration).toBe(300000);
  });

  it('歌曲无 duration 字段时返回 0（mfResultToSong 会显示 --:--）', () => {
    const item = { id: '1', name: '歌', singer: '歌手', album: '专辑' };
    const mapped = toPluginSearchResult(item, plugin);
    expect(mapped.duration).toBe(0);
  });
});
