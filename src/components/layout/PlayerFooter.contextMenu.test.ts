import { describe, expect, it } from 'vitest';

import source from './PlayerFooter.vue?raw';

describe('底栏右键菜单外部关闭', () => {
  it('closes the footer context menu from the footer window click handler', () => {
    expect(source).toContain("if (showContextMenu.value && !target.closest('.ctx-sheet'))");
    expect(source).toContain('showContextMenu.value = false;');
  });
});
