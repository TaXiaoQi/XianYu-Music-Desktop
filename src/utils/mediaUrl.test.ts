import { describe, expect, it } from 'vitest';

import { sanitizeMediaUrl } from './mediaUrl';

describe('sanitizeMediaUrl', () => {
  it('清理插件返回 URL 的包装符和尾逗号', () => {
    const result = sanitizeMediaUrl('`https://music.haitangw.cc/kgqq/kg.php?type=mp3&id=abc&level=hires,`');

    expect(result).toBe('https://music.haitangw.cc/kgqq/kg.php?type=mp3&id=abc&level=hires');
  });
});
