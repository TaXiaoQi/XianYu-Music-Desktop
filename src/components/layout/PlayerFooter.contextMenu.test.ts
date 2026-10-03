import { describe, it } from 'vitest';

import { expectSourceContains } from '../../testing/sourceText';
import source from './PlayerFooter.vue?raw';

describe('底栏右键菜单外部关闭', () => {
  it('closes the footer context menu from the footer window click handler', () => {
    expectSourceContains(source, "if (showContextMenu.value && !target.closest('.ctx-sheet'))");
    expectSourceContains(source, 'showContextMenu.value = false;');
  });
});
