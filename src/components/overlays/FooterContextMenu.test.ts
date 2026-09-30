import { it, describe, expect } from 'vitest';

import footerMenuMarkup from './FooterContextMenu.vue?raw';
import pointerAwaySource from './contextMenu/onPointerAway.ts?raw';

// 行为规格（逐字冻结）：底部播放条右键菜单必须提供的全部入口文案。
const requiredEntryLabels = [
  '收藏到歌单',
  '查看歌手',
  '查看专辑',
  '修改歌曲封面',
  '更改歌词 (LRC)',
  '打开文件所在目录',
  '查看歌曲信息',
];

describe('播放条右键菜单入口', () => {
  it.each(requiredEntryLabels)('菜单提供入口文案：%s', (entryLabel) => {
    expect(footerMenuMarkup).toContain(entryLabel);
  });
});

describe('播放条右键菜单关闭行为', () => {
  it('uses capture-phase pointerdown to dismiss on outside presses', () => {
    expect(footerMenuMarkup).toContain('watchPointerAway');
    expect(pointerAwaySource).toContain("window.addEventListener('pointerdown', onPress, true)");
    expect(pointerAwaySource).toContain("window.removeEventListener('pointerdown', onPress, true)");
  });
});
