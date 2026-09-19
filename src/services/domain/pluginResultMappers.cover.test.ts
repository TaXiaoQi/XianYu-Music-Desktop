import { describe, expect, it } from 'vitest';

import { extractCoverUrl, extractDurationMs } from './pluginResultMappers';

describe('extractCoverUrl netease picId fallback', () => {
  it('builds CDN url from reliable picId_str', () => {
    const url = extractCoverUrl({
      id: 509781655,
      name: '想你就写信 (Live)',
      al: {
        name: '中国新歌声第二季 第13期',
        picId: 109951163038292176, // unsafe number，应被忽略
        picId_str: '109951163038292176',
      },
    });
    expect(url).toBe(
      'https://p1.music.126.net/yD9vbpuILH-tqNRIaP640g==/109951163038292176.jpg',
    );
  });

  it('skips precision-lost number picId so async cover backfill can run', () => {
    expect(extractCoverUrl({
      al: { picId: 109951163038292176 },
    })).toBe('');
  });

  it('prefers existing picUrl over picId', () => {
    const url = extractCoverUrl({
      al: {
        picUrl: 'https://p2.music.126.net/existing.jpg',
        picId: 109951163038292176,
      },
    });
    expect(url).toBe('https://p2.music.126.net/existing.jpg');
  });

  it('supports raw / rawData nested fields in MF plugin result items', () => {
    const url = extractCoverUrl({
      title: '测试歌曲',
      rawData: {
        al: {
          picId_str: '109951163038292176',
        },
      },
    });
    expect(url).toBe(
      'https://p1.music.126.net/yD9vbpuILH-tqNRIaP640g==/109951163038292176.jpg',
    );
  });
});

describe('extractCoverUrl Baka plugin cover fields', () => {
  it('extracts coverImg (Baka top list / playlist cover)', () => {
    expect(extractCoverUrl({ coverImg: 'https://d.musicapp.migu.cn/cover.png' }))
      .toBe('https://d.musicapp.migu.cn/cover.png');
  });

  it('extracts imgUrl (camelCase variant)', () => {
    expect(extractCoverUrl({ imgUrl: 'https://example.com/img.jpg' }))
      .toBe('https://example.com/img.jpg');
  });

  it('extracts imgurl (lowercase variant)', () => {
    expect(extractCoverUrl({ imgurl: 'https://example.com/img.jpg' }))
      .toBe('https://example.com/img.jpg');
  });

  it('extracts picurl (lowercase variant)', () => {
    expect(extractCoverUrl({ picurl: 'https://example.com/pic.jpg' }))
      .toBe('https://example.com/pic.jpg');
  });

  it('extracts coverImg from rawData nested object', () => {
    expect(extractCoverUrl({ rawData: { coverImg: 'https://example.com/cover.png' } }))
      .toBe('https://example.com/cover.png');
  });

  it('upgrades http:// coverImg to https://', () => {
    expect(extractCoverUrl({ coverImg: 'http://example.com/cover.png' }))
      .toBe('https://example.com/cover.png');
  });
});

describe('extractCoverUrl nested netease shapes', () => {
  it('extracts al.picUrl nested under song', () => {
    expect(extractCoverUrl({ song: { al: { picUrl: 'https://p3.music.126.net/song.jpg' } } }))
      .toBe('https://p3.music.126.net/song.jpg');
  });

  it('extracts picId_str nested under rawData.data.album to build CDN url', () => {
    const url = extractCoverUrl({
      rawData: { data: { album: { picId_str: '109951163038292176' } } },
    });
    expect(url).toBe(
      'https://p1.music.126.net/yD9vbpuILH-tqNRIaP640g==/109951163038292176.jpg',
    );
  });
});

describe('extractDurationMs', () => {
  it('reads direct ms value', () => {
    expect(extractDurationMs({ duration: 253000 })).toBe(253000);
  });

  it('treats sub-thousand seconds as seconds', () => {
    expect(extractDurationMs({ duration: 240 })).toBe(240000);
  });

  it('reads dt under nested song (netease native field)', () => {
    expect(extractDurationMs({ song: { dt: 253000 } })).toBe(253000);
  });

  it('reads duration under nested data', () => {
    expect(extractDurationMs({ data: { duration: 200 } })).toBe(200000);
  });

  it('reads mm:ss string', () => {
    expect(extractDurationMs({ duration: '04:13' })).toBe(253000);
  });

  it('returns 0 when no duration present anywhere', () => {
    expect(extractDurationMs({ title: 'x', artist: 'y' })).toBe(0);
  });
});
