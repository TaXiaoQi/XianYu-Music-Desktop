import source from './FooterContextMenu.vue?raw';
import { describe, expect, it } from 'vitest';

describe('FooterContextMenu entries', () => {
  it('shows the current song actions used by the player footer menu', () => {
    expect(source).toContain('收藏到歌单');
    expect(source).toContain('查看歌手');
    expect(source).toContain('查看专辑');
    expect(source).toContain('修改歌曲封面');
    expect(source).toContain('更改歌词 (LRC)');
    expect(source).toContain('打开文件所在目录');
    expect(source).toContain('查看歌曲信息');
  });
});
