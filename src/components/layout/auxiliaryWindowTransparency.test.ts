import { it, describe } from 'vitest';

import { expectSourceContains } from '../../testing/sourceText';
import miniPlayerWindowCode from './MiniPlayerWindow.vue?raw';
import trayMenuWindowCode from './TrayMenuWindow.vue?raw';

// 行为规格（逐字冻结）：辅助窗口的 webview 背景必须完全透明，托盘外壳点击空白处即隐藏。
const transparentBackgroundSnippet = 'setBackgroundColor([0, 0, 0, 0])';
const outsideClickDismissBinding = '@pointerdown.self="hideWindow"';

describe('辅助透明窗口', () => {
  it('迷你播放器 webview 背景强制透明', () => {
    expectSourceContains(miniPlayerWindowCode, transparentBackgroundSnippet);
  });

  it('自定义托盘菜单 webview 背景强制透明', () => {
    expectSourceContains(trayMenuWindowCode, transparentBackgroundSnippet);
  });

  it('点击托盘透明外壳中菜单面板以外的区域时隐藏托盘菜单', () => {
    expectSourceContains(trayMenuWindowCode, outsideClickDismissBinding);
  });
});
