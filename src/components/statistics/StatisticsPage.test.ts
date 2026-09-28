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

describe('flat branch renders the pre-restyle (3110e0da^) markup verbatim', () => {
  // 源码级（?raw）字符串钉桩 —— 说清它能证明什么、不能证明什么：
  // - 能证明：模板源码里「经典扁平」分支包含 / 不包含下面这些确切标记；玻璃分支仍保留
  //   3110e0da 引入的外壳（没有被这次拆分误删）。
  // - 不能证明：浏览器里的真实盒模型 / CSS 计算 / hover 观感，也不能证明 Vue 运行期
  //   确实把 isGlass=false 渲染成那条 v-else-if 分支（那要靠实机）。
  //   但足以让“扁平分支退回改造前标记”这一具体回归无法悄悄复活。
  // 注：改造前那个常量名叫 CARD_CLASS，本页改名为 FLAT_CARD_CLASS（字符串值一字未改）。
  const flatStart = source.indexOf('经典扁平模式');
  const flat = source.slice(flatStart, source.indexOf('</template>'));
  const glass = source.slice(0, flatStart);

  it('splits the data block into a glass branch and a flat v-else-if branch', () => {
    expect(source).toContain('<!-- 玻璃模式：3110e0da 的观感');
    expect(source).toContain('v-else-if="stats && behaviorStats && isGlass"');
    // 扁平分支是链上最后一个 v-else-if，整段不含 isGlass —— 形态完全不依赖运行时开关
    expect(flat).toContain('v-else-if="stats && behaviorStats"');
    expect(flat).not.toContain('isGlass');
  });

  it('renders the original plain KPI card, with no icon box / flex wrapper', () => {
    expect(flat).toContain('<div :class="FLAT_CARD_CLASS">');
    expect(flat).toContain('<p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t(\'stats.listenDuration\') }}</p>');
    // 改造引入的三层壳与图标方块在扁平分支里必须一个都不存在
    expect(flat).not.toContain('group relative overflow-hidden');
    expect(flat).not.toContain('relative flex items-start gap-3');
    expect(flat).not.toContain('min-w-0');
    for (const icon of ['<Headphones', '<Music', '<Calendar', '<Database', '<Clock', '<Play', '<TrendingUp', '<Disc3']) {
      expect(flat).not.toContain(icon);
    }
  });

  it('keeps the entrance animation on the card section itself (no outer wrapper div)', () => {
    expect(flat).toContain('<section :class="FLAT_CARD_CLASS" class="animate-fade-in-up" style="animation-delay: 60ms;">');
    expect(flat).toContain('<section :class="FLAT_CARD_CLASS" class="animate-fade-in-up" style="animation-delay: 120ms;">');
    expect(flat).toContain('<section :class="FLAT_CARD_CLASS" class="animate-fade-in-up" style="animation-delay: 240ms;">');
    expect(flat).not.toContain('<div class="animate-fade-in-up" style="animation-delay:');
  });

  it('keeps the original heading and overview-grid markup', () => {
    expect(flat).toContain('<h3 class="text-sm font-bold text-gray-800 dark:text-gray-200">');
    expect(flat).toContain('<section class="grid grid-cols-2 gap-3 md:grid-cols-4 animate-fade-in-up">');
    expect(flat).toContain('<section class="grid grid-cols-1 gap-3 md:grid-cols-3 animate-fade-in-up" style="animation-delay: 180ms;">');
  });

  it('leaves the glass branch wrappers intact', () => {
    expect(glass).toContain('group relative overflow-hidden');
    expect(glass).toContain('relative flex items-start gap-3');
    expect(glass).toContain('<div class="animate-fade-in-up" style="animation-delay: 60ms;">');
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
