import { describe, expect, it } from 'vitest';

import { normalizeMediaRequestHeaders, sanitizeMediaUrl } from './mediaUrl';

describe('sanitizeMediaUrl', () => {
  it('清理插件返回 URL 的包装符和尾逗号', () => {
    const result = sanitizeMediaUrl('`https://music.haitangw.cc/kgqq/kg.php?type=mp3&id=abc&level=hires,`');

    expect(result).toBe('https://music.haitangw.cc/kgqq/kg.php?type=mp3&id=abc&level=hires');
  });

  it('为酷狗代理直链补齐默认防盗链请求头', () => {
    const headers = normalizeMediaRequestHeaders(
      'https://music.haitangw.cc/kgqq/kg.php?type=mp3&id=abc&level=hires',
      null,
    );

    expect(headers).toMatchObject({
      Accept: 'audio/*,*/*;q=0.8',
      Referer: 'https://music.haitangw.cc/',
      Origin: 'https://music.haitangw.cc',
    });
  });

  it('为网易云直链补齐默认防盗链请求头', () => {
    const headers = normalizeMediaRequestHeaders(
      'https://m701.music.126.net/20260101000000/example/song.mp3',
      {},
    );

    expect(headers).toMatchObject({
      Accept: 'audio/*,*/*;q=0.8',
      Referer: 'https://music.163.com/',
      Origin: 'https://music.163.com',
    });
  });

  it('不覆盖插件显式返回的请求头', () => {
    const headers = normalizeMediaRequestHeaders(
      'https://m.kugou.com/song.mp3',
      {
        referer: 'https://custom.example/',
        Cookie: 'token=abc',
      },
    );

    expect(headers?.referer).toBe('https://custom.example/');
    expect(headers?.Cookie).toBe('token=abc');
    expect(headers?.Accept).toBe('audio/*,*/*;q=0.8');
  });
});
