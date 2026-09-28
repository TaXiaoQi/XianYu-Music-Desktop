import { describe, expect, it } from 'vitest';

import source from './StatisticsPage.vue?raw';
import settingsSource from '../settings/SettingsTheme.vue?raw';
import homeTabsSource from '../home/HomeDiscoverTabs.vue?raw';
import homeAreaSource from '../home/panels/HomeDiscoverArea.vue?raw';

// 内联排行榜自带 <template>/</template>（我的名次行 / 未登录行两处），所以「扁平分支」
// 切片一律用 lastIndexOf('</template>') 取最外层模板闭合；用 indexOf 会在第一条内层
// </template> 处截断，把内联排行榜后半段漏掉。

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
    // 2) 图标方块 + 装饰角标整块 v-if（含玻璃质感升级加的顶部 inset 亮线）
    expect(source).toContain('<div v-if="isGlass" class="shrink-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] bg-blue-500/10 p-2 text-blue-500 dark:bg-blue-500/15 dark:text-blue-400">');
    // 3) 指标数字 font-bold / font-black
    expect(source).toContain(':class="isGlass ? \'font-bold\' : \'font-black\'"');
    // 4) 标题 text-lg italic / text-sm
    expect(source).toContain(':class="isGlass ? \'text-lg font-bold italic\' : \'text-sm font-bold\'"');
    // 5) 区间切换器：两套类串逐字保留（控件本身另由 v-if="isGlass" 限到玻璃档）
    expect(source).toContain('\'border border-gray-200/40 bg-white/20 p-0.5 dark:border-gray-800/40 dark:bg-black/10\'');
  });

  it('never uses the glass card unconditionally', () => {
    expect(source).not.toContain(':class="HOME_CARD_CLASS"');
  });
});

describe('the time-range switcher is gated to the glass look', () => {
  // 用户给的扁平档参考稿里没有「全部 / 7天 / 30天 / 今年」这一行——它由 58c03b25 引入，
  // 当时渲染在 v-if 链之外，两种观感都会出现。这里钉住它只属于玻璃档。
  const flatStart = source.indexOf('经典扁平模式');
  const flat = source.slice(flatStart, source.lastIndexOf('</template>'));
  const glass = source.slice(0, flatStart);

  it('renders the switcher only when isGlass is on', () => {
    // 切换器整块（含外层 mb-3 包裹层）挂在 isGlass 上：扁平档连包裹层都不渲染，
    // 因此扁平档既没有那一行按钮，也不会留下多余的 mb-3 间距。
    expect(source).toContain('<div v-if="isGlass" class="mb-3 flex items-center justify-between gap-3">');
    // 仍只有这一处区间控件——没被删除，也没被挪进扁平分支
    expect(source).toContain('v-for="range in RANGES"');
    expect(source).toContain(':aria-label="t(\'stats.rangeLabel\')"');
    expect(glass).toContain('<div v-if="isGlass" class="mb-3 flex items-center justify-between gap-3">');
  });

  it('keeps the switcher markup and behaviour, restyled with the lighter glass idiom', () => {
    // 玻璃类串：3110e0da 引入，玻璃质感升级时加了顶部 inset 亮线 + 增透
    // （backdrop-saturate-150）；深色档因"不够透亮"已整体提亮（填充 /12、亮线 0.22）；
    // 扁平类串逐字取自旧版，不动
    expect(source).toContain('\'border border-white/20 bg-white/40 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-md backdrop-saturate-150 dark:bg-white/12 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]\'');
    expect(source).toContain('\'border border-gray-200/40 bg-white/20 p-0.5 dark:border-gray-800/40 dark:bg-black/10\'');
    // 点击与选中态绑定原样保留
    expect(source).toContain('@click="selectRange(range.value)"');
    expect(source).toContain(':class="range.value === selectedRange');
    // 区间数据流仍走 store 的 refreshBehaviorOnly，没被删
    expect(source).toContain('statisticsStore.refreshBehaviorOnly(range)');
  });

  it('leaves the flat data block untouched by the range control', () => {
    // 扁平分支切片（数据块）里不得出现任何区间切换器相关标记
    expect(flat).not.toContain('RANGES');
    expect(flat).not.toContain('selectRange');
    expect(flat).not.toContain('rangeLabel');
    expect(flat).not.toContain('mb-3 flex items-center justify-between gap-3');
  });
});

describe('flat branch renders the pre-restyle (58c03b25^ = 04cacc5c) markup verbatim', () => {
  // 源码级（?raw）字符串钉桩 —— 说清它能证明什么、不能证明什么：
  // - 能证明：模板源码里「经典扁平」分支逐字包含 58c03b25^（= 04cacc5c）那版统计页的
  //   八项指标标记（标签绑定 + 两行四列网格类 + 数字绑定），且该分支里不再有图标方块、
  //   卡片外壳、动画外层壳与图表；玻璃分支仍原样保留 3110e0da 的外壳。
  // - 不能证明：浏览器里的真实盒模型 / CSS 计算 / hover 观感，也不能证明 Vue 运行期
  //   确实把 isGlass=false 渲染成那条 v-else-if 分支（那要靠实机）。
  //   但足以让“扁平分支退回 3110e0da^ 的四卡看板”或“八项变四项”这类回归无法悄悄复活。
  // 注：8 项指标的原始中文文案存在脚本里的 TEXT 表（逐字取自旧版），玻璃分支仍走 t('stats.*')。
  const flatStart = source.indexOf('经典扁平模式');
  const flat = source.slice(flatStart, source.lastIndexOf('</template>'));
  const glass = source.slice(0, flatStart);

  it('splits the data block into a glass branch and a flat v-else-if branch', () => {
    expect(source).toContain('<!-- 玻璃模式：3110e0da 的观感');
    expect(source).toContain('v-else-if="stats && behaviorStats && isGlass"');
    // 扁平分支是链上最后一个 v-else-if，整段不含 isGlass —— 形态完全不依赖运行时开关
    expect(flat).toContain('v-else-if="stats && behaviorStats"');
    expect(flat).not.toContain('isGlass');
  });

  it('renders the eight metrics, each a label above a number', () => {
    // 第一行：总歌曲 / 歌曲总时长 / 库大小 / 无损占比
    for (const label of ['TEXT.totalSongs', 'TEXT.songTotalDuration', 'TEXT.librarySize', 'TEXT.losslessRatio']) {
      expect(flat).toContain(`{{ ${label} }}`);
    }
    // 第二行：总听歌时长 / 今日听歌时长 / 播放次数 / 常听歌曲
    for (const label of ['TEXT.totalListenDuration', 'TEXT.todayListenDuration', 'TEXT.playCount', 'TEXT.longestPlayed']) {
      expect(flat).toContain(`{{ ${label} }}`);
    }
  });

  it('keeps the original zh label text (the flat look is quoted, not reconstructed)', () => {
    for (const entry of [
      "totalSongs: '总歌曲',",
      "songTotalDuration: '歌曲总时长',",
      "librarySize: '库大小',",
      "losslessRatio: '无损占比',",
      "totalListenDuration: '总听歌时长',",
      "todayListenDuration: '今日听歌时长',",
      "playCount: '播放次数',",
      "longestPlayed: '常听歌曲',",
    ]) {
      expect(source).toContain(entry);
    }
  });

  it('uses the original two-row four-column grid markup', () => {
    expect(flat).toContain('<div class="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1.3fr] gap-x-[clamp(0.75rem,2vw,2rem)] items-end">');
    expect(flat).toContain('<div class="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1.3fr] gap-x-[clamp(0.75rem,2vw,2rem)]">');
    expect(flat).toContain('<section class="px-[clamp(1rem,2.5vw,3rem)] pt-[clamp(0.25rem,0.5vw,0.5rem)] pb-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up">');
    expect(flat).toContain('<section class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 100ms;">');
  });

  it('has no icon tiles, no card chrome and no charts in the flat branch', () => {
    expect(flat).not.toContain('FLAT_CARD_CLASS');
    expect(flat).not.toContain('HOME_CARD_CLASS');
    // 改造引入的三层壳与图标方块在扁平分支里必须一个都不存在
    expect(flat).not.toContain('group relative overflow-hidden');
    expect(flat).not.toContain('relative flex items-start gap-3');
    for (const icon of ['<Headphones', '<Music', '<Calendar', '<Database', '<Clock', '<Play', '<TrendingUp', '<Disc3']) {
      expect(flat).not.toContain(icon);
    }
    // 四类图表是改造后（58c03b25）才有的，扁平档逐字还原旧版，一个都不出现
    for (const chart of ['<StatsTrendChart', '<StatsHourChart', '<StatsTopBars', '<StatsCompositionRing']) {
      expect(flat).not.toContain(chart);
    }
    expect(flat).not.toContain('<div class="animate-fade-in-up"');
  });

  it('leaves the glass branch wrappers intact', () => {
    expect(glass).toContain('group relative overflow-hidden');
    expect(glass).toContain('relative flex items-start gap-3');
    expect(glass).toContain('<div class="animate-fade-in-up" style="animation-delay: 60ms;">');
  });
});

describe('glass look gains layered glass polish (corner refraction + hover sheen)', () => {
  // 源码级（?raw）字符串钉桩 —— 说清它能证明什么、不能证明什么：
  // - 能证明：HOME_CARD_CLASS 挂上 glass-card 且类串含双层 inset 高光 + 深外影 +
  //   backdrop-blur-lg/backdrop-saturate-150（深色档高光 alpha 更低）；scoped 块里
  //   ::before（边缘折射渐变 + 四角光斑，含 .dark 变体）与 ::after（hover 掠射光泽）
  //   在场且 pointer-events:none；掠射光泽走 background-position 位移（transition，
  //   不是循环 animation），prefers-reduced-motion 下整层禁用；扁平切片不含 glass-card。
  // - 不能证明：浏览器里的真实合成观感——inset 高光的实际亮度、四角光斑的位置与
  //   过渡是否自然、hover 扫光的轨迹与时序、backdrop-blur/saturate 在不同页面底上
  //   的折射效果，都要实机肉眼校（数值类改动，预期要人工调一轮）。
  // 在最后一个 </template> 之后找 scoped 样式块：对 script/template 注释里出现
  // 的同形字面量免疫，避免切片混入模板内容
  const scopedStyleStart = source.indexOf('<style scoped>', source.lastIndexOf('</template>'));
  const scopedStyle = source.slice(scopedStyleStart, source.indexOf('</style>', scopedStyleStart));
  const flatStart = source.indexOf('经典扁平模式');
  const flat = source.slice(flatStart, source.lastIndexOf('</template>'));

  it('puts the pseudo-element carrier and the four-layer tokens on the glass card string', () => {
    expect(source).toContain("const HOME_CARD_CLASS = 'glass-card ");
    // 第 1 层（inset 顶/底高光）+ 第 4 层（深外影 + 增透折射）进类串
    expect(source).toContain('shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(255,255,255,0.10),0_8px_24px_rgba(15,23,42,0.10)]');
    expect(source).toContain('backdrop-blur-lg backdrop-saturate-150');
    // 深色档：高光 alpha 调低 + 外阴影加深
    // 深色档：填充与边框提亮（/12、white/25）+ 顶/底亮线加强，解决"不够透亮"
    expect(source).toContain('dark:border-white/25 dark:bg-white/12 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.38),inset_0_-1px_0_rgba(255,255,255,0.14),0_10px_28px_rgba(0,0,0,0.35)]');
  });

  it('adds the ::before refraction layer and the ::after hover sheen in the scoped block', () => {
    // 第 2 层：边缘折射渐变 + 四角光斑（左上最亮 → 右上次之 → 右下/左下极弱）
    expect(scopedStyle).toContain('.glass-card::before');
    expect(scopedStyle).toContain('radial-gradient');
    expect(scopedStyle).toContain('.dark .glass-card::before');
    // 第 3 层：hover 掠射光泽，transition 触发而非循环动画
    expect(scopedStyle).toContain('.glass-card::after');
    expect(scopedStyle).toContain('.glass-card:hover::after');
    expect(scopedStyle).toContain('background-position');
    expect(scopedStyle).not.toContain('animation');
    // 两个伪元素都绝不拦截鼠标
    expect(scopedStyle.match(/pointer-events:\s*none/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // 层序（修复"发白"）：眩光层在玻璃底色之上、内容之下——isolate 建堆叠上下文防负
    // z-index 逃逸到祖先背景后，两个伪元素均 z-index: -1（白纱罩内容即回归）
    expect(scopedStyle).toContain('isolation: isolate');
    expect(scopedStyle.match(/z-index:\s*-1/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // 注意用正则而非 toContain('z-index: 1')：排行榜吸底行的 z-index: 10 会被子串误伤
    expect(scopedStyle).not.toMatch(/z-index:\s*1(?!\d)/);
  });

  it('disables the hover sheen under prefers-reduced-motion', () => {
    const reduced = scopedStyle.slice(scopedStyle.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.glass-card::after');
  });

  it('keeps the new polish out of the flat look', () => {
    // 扁平分支切片里不得出现任何玻璃质感标记（负向，防渗漏）
    expect(flat).not.toContain('glass-card');
    expect(flat).not.toContain('backdrop-saturate-150');
    expect(flat).not.toContain('shadow-[inset_');
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

describe('flat look folds the leaderboard in, glass look keeps it standalone', () => {
  // 源码级（?raw）字符串钉桩 —— 说清它能证明什么、不能证明什么：
  // - 能证明：模板源码里「经典扁平」分支的标记确实同时含八项指标与内联排行榜整段
  //   （标题 + 日/周/总榜切换 + 行/名次/头像 + 吸底「我的名次」/未登录行）；玻璃分支的
  //   模板标记里没有任何内联排行榜标记；独立排行榜入口（HomeDiscoverTabs 的子标签、
  //   HomeDiscoverArea 的 LeaderboardPage 挂载）改为按 useGlassSwitch 条件化——玻璃档
  //   保留、扁平档隐藏/回落；内联排行榜的数据加载在玻璃档短路，玻璃档不新增请求。
  // - 不能证明：浏览器里两档的真实渲染结果（v-if 的运行期求值、吸底/滚动的实际观感、
  //   排行榜数据是否真的返回），这些要靠实机。
  const flatStart = source.indexOf('经典扁平模式');
  const flat = source.slice(flatStart, source.lastIndexOf('</template>'));
  const glassBranch = source.slice(source.indexOf('<!-- 玻璃模式：3110e0da 的观感'), flatStart);

  it('renders the leaderboard inline inside the flat branch, next to the metrics', () => {
    // 内联排行榜整段逐字取自 04cacc5c^（排行榜拆成独立 tab 之前那版统计页）
    expect(flat).toContain('<section v-if="theme.showLeaderboard" class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 400ms;">');
    expect(flat).toContain('{{ TEXT.leaderboard }}');
    expect(flat).toContain('v-for="p in PERIOD_OPTIONS"');
    expect(flat).toContain('class="leaderboard-row animate-fade-in-up"');
    expect(flat).toContain('class="leaderboard-row is-me is-sticky animate-fade-in-up"');
    expect(flat).toContain('@contextmenu="handleLeaderboardContextMenu($event, item)"');
    expect(flat).toContain('class="leaderboard-row leaderboard-row--login is-me is-sticky w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EC4141]/50"');
    // 指标与排行榜在同一扁平分支里并存
    expect(flat).toContain('{{ TEXT.totalSongs }}');
    expect(flat).toContain('{{ TEXT.longestPlayed }}');
  });

  it('keeps the inline leaderboard out of the glass branch', () => {
    // 玻璃档排行榜仍是独立页，统计页玻璃分支里不得混入内联排行榜标记
    expect(glassBranch).not.toContain('leaderboard-row');
    expect(glassBranch).not.toContain('PERIOD_OPTIONS');
    expect(glassBranch).not.toContain('theme.showLeaderboard');
    expect(glassBranch).not.toContain('leaderboard-period-tabs');
  });

  it('loads the inline leaderboard only in the flat look', () => {
    // 同一组件两档共用：内联排行榜的数据加载在玻璃档直接短路，玻璃档与本页改造前一致
    expect(source).toContain('if (isGlass.value) return;');
    expect(source).toContain('void loadLeaderboard();');
    expect(source).toContain('await loadLeaderboard(true);');
  });

  it('hides the standalone leaderboard entry in the flat look only', () => {
    // 独立的「排行榜」子标签：仅在「显示排行榜」且玻璃档时出现
    expect(homeTabsSource).toContain('if (theme.value.showLeaderboard && theme.value.useGlassSwitch) {');
    expect(homeTabsSource).toContain("{ key: 'leaderboard', label: isEnglish.value ? 'Leaderboard' : '排行榜' }");
    // discover 区域仍挂载独立 LeaderboardPage（玻璃档路径保留），扁平档回落到统计页
    expect(homeAreaSource).toContain('import LeaderboardPage from');
    expect(homeAreaSource).toContain('<LeaderboardPage v-else-if="effectivePage === \'leaderboard\'" key="leaderboard" class="min-h-0 flex-1" />');
    expect(homeAreaSource).toContain("props.activePage === 'leaderboard' && !theme.value.useGlassSwitch ? 'statistics' : props.activePage");
  });
});
