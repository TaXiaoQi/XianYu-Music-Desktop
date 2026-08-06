import { describe, expect, it } from 'vitest';

import { extractCoverUrl } from './pluginResultMappers';

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
