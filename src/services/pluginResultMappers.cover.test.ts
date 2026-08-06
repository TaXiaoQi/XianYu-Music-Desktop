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

// Baka 系插件（长青SVIP音源、咪咕、QQ音乐等）使用 coverImg / imgUrl / imgurl / picurl
// 作为封面字段名，extractCoverUrl 需兼容这些字段以正确显示歌单/排行榜封面
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
