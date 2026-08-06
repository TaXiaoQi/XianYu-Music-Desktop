import { describe, expect, it } from 'vitest';

import {
  buildKuwoAlbumCoverUrl,
  encryptNeteasePicId,
  extractNeteasePicId,
  isReliableNeteasePicId,
  neteasePicIdToUrl,
  normalizeKuwoCoverUrl,
} from './coverUrl';

describe('neteasePicIdToUrl', () => {
  it('matches known CDN path from song detail API', () => {
    // 与 music.163.com/api/song/detail 返回的 album.picUrl 路径段一致
    expect(encryptNeteasePicId('109951168912558470')).toBe('iAwVf8ag_45csIUuh1wSZg==');
    expect(neteasePicIdToUrl('109951168912558470')).toBe(
      'https://p1.music.126.net/iAwVf8ag_45csIUuh1wSZg==/109951168912558470.jpg',
    );
  });

  it('returns empty for invalid or precision-lost ids', () => {
    expect(neteasePicIdToUrl(null)).toBe('');
    expect(neteasePicIdToUrl(undefined)).toBe('');
    expect(neteasePicIdToUrl(0)).toBe('');
    expect(neteasePicIdToUrl('0')).toBe('');
    expect(neteasePicIdToUrl('')).toBe('');
    // 超过 MAX_SAFE_INTEGER 的 number 已丢精度，拒绝拼 URL
    expect(isReliableNeteasePicId(109951163038292176)).toBe(false);
    expect(neteasePicIdToUrl(109951163038292176)).toBe('');
  });
});

describe('extractNeteasePicId', () => {
  it('prefers string picId_str and rejects unsafe number picId', () => {
    expect(extractNeteasePicId({ al: { picId: 109951163038292176 } })).toBe(null);
    expect(extractNeteasePicId({ album: { picId_str: '109951165671182684' } })).toBe('109951165671182684');
    expect(extractNeteasePicId({
      al: { picId: 109951163038292176, picId_str: '109951163038292176' },
    })).toBe('109951163038292176');
    expect(extractNeteasePicId({ picId: 0 })).toBe(null);
    expect(extractNeteasePicId(null)).toBe(null);
    // 安全整数 number 仍可用
    expect(extractNeteasePicId({ picId: 123456 })).toBe(123456);
  });
});

describe('buildKuwoAlbumCoverUrl', () => {
  it('upscales web_albumpic_short to img3 albumcover URL', () => {
    expect(buildKuwoAlbumCoverUrl('120/s3s94/93/211513640.jpg')).toBe(
      'https://img3.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg',
    );
  });

  it('returns empty for blank input', () => {
    expect(buildKuwoAlbumCoverUrl('')).toBe('');
    expect(buildKuwoAlbumCoverUrl(null)).toBe('');
  });
});

describe('normalizeKuwoCoverUrl', () => {
  it('rewrites kwcdn http URLs to stable https img3 host', () => {
    expect(
      normalizeKuwoCoverUrl('http://img1.kwcdn.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg'),
    ).toBe('https://img3.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg');
  });
});
