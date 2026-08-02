import { describe, expect, it } from 'vitest';

import source from './SettingsFooterLayout.vue?raw';

describe('SettingsFooterLayout visual editor', () => {
  it('uses the footer preview itself as the drag editor', () => {
    expect(source).toContain('效果实时预览');
    expect(source).toContain('@pointerdown="startDragging($event, previewSlots[slot]!)"');
    expect(source).toContain(':data-footer-preview-slot="slot"');
    expect(source).not.toContain('左侧容器');
    expect(source).not.toContain('中间左侧');
    expect(source).not.toContain('收纳菜单');
  });

  it('provides a display switch for every configurable button', () => {
    expect(source).toContain('v-for="item in FOOTER_ITEMS"');
    expect(source).toContain('@click="toggleItemVisibility(item.key)"');
    expect(source).toContain("isItemVisible(item.key) ? 'footer-visibility-switch--on' : ''");
  });
});
