import { describe, expect, it } from 'vitest';

import source from './StatisticsPage.vue?raw';
import settingsSource from '../settings/SettingsTheme.vue?raw';

describe('StatisticsPage style follows the appearance setting', () => {
  it('keeps both card looks, with the flat one verbatim from the pre-restyle version', () => {
    expect(source).toContain('const HOME_CARD_CLASS =');
    // 逐字对照 3110e0da^ 里的原始卡片字符串，防止日后被顺手“现代化”
    expect(source).toContain(
      "const FLAT_CARD_CLASS = 'rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10';",
    );
  });

  it('reads the reactive useGlassSwitch flag instead of hard-coding one look', () => {
    expect(source).toContain('useSettingsStore');
    expect(source).toContain('computed(() => settingsStore.theme.useGlassSwitch)');
  });

  it('branches all five surfaces on isGlass', () => {
    // 1) 卡片类名
    expect(source).toContain(':class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS"');
    // 2) 图标方块 + 装饰角标整块 v-if
    expect(source).toContain('<div v-if="isGlass" class="shrink-0 rounded-lg bg-blue-500/10 p-2 text-blue-500 dark:bg-blue-500/15 dark:text-blue-400">');
    // 3) 指标数字 font-bold / font-black
    expect(source).toContain(':class="isGlass ? \'font-bold\' : \'font-black\'"');
    // 4) 标题 text-lg italic / text-sm
    expect(source).toContain(':class="isGlass ? \'text-lg font-bold italic\' : \'text-sm font-bold\'"');
    // 5) 区间切换器：（逐字保留改造前那串）
    expect(source).toContain('\'border border-gray-200/40 bg-white/20 p-0.5 dark:border-gray-800/40 dark:bg-black/10\'');
  });

  it('never uses the glass card unconditionally', () => {
    expect(source).not.toContain(':class="HOME_CARD_CLASS"');
  });
});

describe('Settings appearance section title', () => {
  it('renames the section from 开关样式 to 样式 (zh / en)', () => {
    expect(settingsSource).toContain("switchStyleTitle: '样式',");
    expect(settingsSource).toContain("switchStyleTitle: 'Style',");
    expect(settingsSource).not.toContain('开关样式');
    expect(settingsSource).not.toContain("switchStyleTitle: 'Switch Style'");
  });
});
