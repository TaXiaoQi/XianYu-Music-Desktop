import { describe, expect, it } from 'vitest';

import source from './SettingsFooterLayout.vue?raw';

describe('SettingsFooterLayout visual editor', () => {
  it('uses the footer preview itself as the drag editor', () => {
    expect(source).toContain('效果实时预览');
    expect(source).toContain('@pointerdown="startItemDrag($event, { type: \'bar\'');
    expect(source).toContain(':data-footer-preview-slot="slot"');
    expect(source).not.toContain('左侧容器');
    expect(source).not.toContain('中间左侧');
    expect(source).not.toContain('收纳菜单');
  });

  it('lets every configurable control be dragged into a slot or the "more" palette', () => {
    expect(source).toContain("startItemDrag($event, { type: 'bar'");
    expect(source).toContain("startItemDrag($event, { type: 'palette'");
    expect(source).toContain('data-collapse-target');
    expect(source).toContain(':data-palette-index="index"');
  });
});
