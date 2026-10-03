import { describe, expect, it } from 'vitest';

import source from './StatisticsPage.vue?raw';
import settingsSource from '../settings/SettingsTheme.vue?raw';
import homeTabsSource from '../home/HomeDiscoverTabs.vue?raw';
import homeAreaSource from '../home/panels/HomeDiscoverArea.vue?raw';
import { condense, expectSourceContains, expectSourceNotContains } from '../../testing/sourceText';

const condensedSource = condense(source);

// 内联排行榜自带 <template>/</template>（我的名次行 / 未登录行两处），所以「扁平分支」
// 切片一律用 lastIndexOf('</template>') 取最外层模板闭合；用 indexOf 会在第一条内层
// </template> 处截断，把内联排行榜后半段漏掉。

describe('StatisticsPage style follows the appearance setting', () => {
  it('keeps both card looks, with the flat one verbatim from the pre-restyle version', () => {
    expectSourceContains(source, 'const HOME_CARD_CLASS =');
    // 逐字对照 3110e0da^ 里的原始卡片字符串，防止日后被顺手“现代化”
    expectSourceContains(
      source,
      "const FLAT_CARD_CLASS = 'rounded-2xl border border-gray-200/40 bg-white/20 px-4 py-3 dark:border-gray-800/40 dark:bg-black/10';",
    );
  });

  it('reads the reactive useGlassSwitch flag instead of hard-coding one look', () => {
    expectSourceContains(source, 'useSettingsStore');
    expectSourceContains(source, 'computed(() => settingsStore.theme.useGlassSwitch)');
  });

  it('branches all five surfaces on isGlass', () => {
    // 1) 卡片类名
    expectSourceContains(source, ':class="isGlass ? HOME_CARD_CLASS : FLAT_CARD_CLASS"');
    // 2) 图标方块 + 装饰角标整块 v-if（含玻璃质感升级加的顶部 inset 亮线）
    expectSourceContains(source, '<div v-if="isGlass" class="shrink-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] bg-blue-500/10 p-2 text-blue-500 dark:bg-blue-500/15 dark:text-blue-400">');
    // 3) 指标数字 font-bold / font-black
    expectSourceContains(source, ':class="isGlass ? \'font-bold\' : \'font-black\'"');
    // 4) 标题 text-lg italic / text-sm
    expectSourceContains(source, ':class="isGlass ? \'text-lg font-bold italic\' : \'text-sm font-bold\'"');
    // 5) 区间切换器：两套类串逐字保留（控件本身另由 v-if="isGlass" 限到玻璃档）
    expectSourceContains(source, '\'border border-gray-200/40 bg-white/20 p-0.5 dark:border-gray-800/40 dark:bg-black/10\'');
  });

  it('never uses the glass card unconditionally', () => {
    expectSourceNotContains(source, ':class="HOME_CARD_CLASS"');
  });
});

describe('the time-range switcher is gated to the glass look', () => {
  // 用户给的扁平档参考稿里没有「全部 / 7天 / 30天 / 今年」这一行——它由 58c03b25 引入，
  // 当时渲染在 v-if 链之外，两种观感都会出现。这里钉住它只属于玻璃档。
  const flatStart = condensedSource.indexOf(condense('经典扁平模式'));
  const flat = condensedSource.slice(flatStart, condensedSource.lastIndexOf(condense('</template>')));
  const glass = condensedSource.slice(0, flatStart);

  it('renders the switcher only when isGlass is on', () => {
    // 切换器整块（含外层 mb-3 包裹层）挂在 isGlass 上：扁平档连包裹层都不渲染，
    // 因此扁平档既没有那一行按钮，也不会留下多余的 mb-3 间距。
    expectSourceContains(source, '<div v-if="isGlass" class="mb-3 flex items-center justify-between gap-3">');
    // 仍只有这一处区间控件——没被删除，也没被挪进扁平分支
    expectSourceContains(source, 'v-for="range in RANGES"');
    expectSourceContains(source, ':aria-label="t(\'stats.rangeLabel\')"');
    expectSourceContains(glass, '<div v-if="isGlass" class="mb-3 flex items-center justify-between gap-3">');
  });

  it('keeps the switcher markup and behaviour, restyled with the lighter glass idiom', () => {
    // 玻璃类串：3110e0da 引入，玻璃质感升级时加了顶部 inset 亮线 + 增透
    // （backdrop-saturate-150）；后按实机反馈「像 Win7 Aero 而非 iOS 液态玻璃」整体转
    // Liquid Glass：卡面填充压到近全透（浅 /16、深 /6）+ 镜面点 + 内圈棱线，靠边缘折射
    // 而非加白造存在感；扁平类串逐字取自旧版，不动
    expectSourceContains(source, '\'border border-white/20 bg-white/16 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.50)] backdrop-blur-md backdrop-saturate-150 dark:bg-white/6 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]\'');
    expectSourceContains(source, '\'border border-gray-200/40 bg-white/20 p-0.5 dark:border-gray-800/40 dark:bg-black/10\'');
    // 点击与选中态绑定原样保留
    expectSourceContains(source, '@click="selectRange(range.value)"');
    expectSourceContains(source, ':class="range.value === selectedRange');
    // 区间数据流仍走 store 的 refreshBehaviorOnly，没被删
    expectSourceContains(source, 'statisticsStore.refreshBehaviorOnly(range)');
  });

  it('leaves the flat data block untouched by the range control', () => {
    // 扁平分支切片（数据块）里不得出现任何区间切换器相关标记
    expectSourceNotContains(flat, 'RANGES');
    expectSourceNotContains(flat, 'selectRange');
    expectSourceNotContains(flat, 'rangeLabel');
    expectSourceNotContains(flat, 'mb-3 flex items-center justify-between gap-3');
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
  const flatStart = condensedSource.indexOf(condense('经典扁平模式'));
  const flat = condensedSource.slice(flatStart, condensedSource.lastIndexOf(condense('</template>')));
  const glass = condensedSource.slice(0, flatStart);

  it('splits the data block into a glass branch and a flat v-else-if branch', () => {
    expectSourceContains(source, '<!-- 玻璃模式：3110e0da 的观感');
    expectSourceContains(source, 'v-else-if="stats && behaviorStats && isGlass"');
    // 扁平分支是链上最后一个 v-else-if，整段不含 isGlass —— 形态完全不依赖运行时开关
    expectSourceContains(flat, 'v-else-if="stats && behaviorStats"');
    expectSourceNotContains(flat, 'isGlass');
  });

  it('renders the eight metrics, each a label above a number', () => {
    // 第一行：总歌曲 / 歌曲总时长 / 库大小 / 无损占比
    for (const label of ['TEXT.totalSongs', 'TEXT.songTotalDuration', 'TEXT.librarySize', 'TEXT.losslessRatio']) {
      expectSourceContains(flat, `{{ ${label} }}`);
    }
    // 第二行：总听歌时长 / 今日听歌时长 / 播放次数 / 常听歌曲
    for (const label of ['TEXT.totalListenDuration', 'TEXT.todayListenDuration', 'TEXT.playCount', 'TEXT.longestPlayed']) {
      expectSourceContains(flat, `{{ ${label} }}`);
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
      expectSourceContains(source, entry);
    }
  });

  it('uses the original two-row four-column grid markup', () => {
    expectSourceContains(flat, '<div class="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1.3fr] gap-x-[clamp(0.75rem,2vw,2rem)] items-end">');
    expectSourceContains(flat, '<div class="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1.3fr] gap-x-[clamp(0.75rem,2vw,2rem)]">');
    expectSourceContains(flat, '<section class="px-[clamp(1rem,2.5vw,3rem)] pt-[clamp(0.25rem,0.5vw,0.5rem)] pb-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up">');
    expectSourceContains(flat, '<section class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 100ms;">');
  });

  it('has no icon tiles, no card chrome and no charts in the flat branch', () => {
    expectSourceNotContains(flat, 'FLAT_CARD_CLASS');
    expectSourceNotContains(flat, 'HOME_CARD_CLASS');
    // 改造引入的三层壳与图标方块在扁平分支里必须一个都不存在
    expectSourceNotContains(flat, 'group relative overflow-hidden');
    expectSourceNotContains(flat, 'relative flex items-start gap-3');
    for (const icon of ['<Headphones', '<Music', '<Calendar', '<Database', '<Clock', '<Play', '<TrendingUp', '<Disc3']) {
      expectSourceNotContains(flat, icon);
    }
    // 四类图表是改造后（58c03b25）才有的，扁平档逐字还原旧版，一个都不出现
    for (const chart of ['<StatsTrendChart', '<StatsHourChart', '<StatsTopBars', '<StatsCompositionRing']) {
      expectSourceNotContains(flat, chart);
    }
    expectSourceNotContains(flat, '<div class="animate-fade-in-up"');
  });

  it('leaves the glass branch wrappers intact', () => {
    expectSourceContains(glass, 'group relative overflow-hidden');
    expectSourceContains(glass, 'relative flex items-start gap-3');
    expectSourceContains(glass, '<div class="animate-fade-in-up" style="animation-delay: 60ms;">');
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
  const flatStart = condensedSource.indexOf(condense('经典扁平模式'));
  const flat = condensedSource.slice(flatStart, condensedSource.lastIndexOf(condense('</template>')));

  it('puts the pseudo-element carrier and the four-layer tokens on the glass card string', () => {
    expectSourceContains(source, "const HOME_CARD_CLASS = 'glass-card ");
    // 第 1 层（inset 顶高光 + 内圈棱线 + inset 底影）+ 第 4 层（近距接触影 + 深广投影 +
    // 增透折射）进类串。内圈棱线是 Liquid Glass 的「倒角反光」，Aero 没有。
    expectSourceContains(source, 'shadow-[inset_0_1px_0_rgba(255,255,255,0.50),inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_-1px_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.06),0_10px_30px_rgba(15,23,42,0.16)]');
    expectSourceContains(source, 'backdrop-blur-lg backdrop-saturate-150');
    // 深色档：填充压到近乎全透（/4、边框 white/15），靠镜面点 + 内圈棱线 + 三层阴影造厚度
    expectSourceContains(source, 'dark:border-white/15 dark:bg-white/4 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),inset_0_0_0_1px_rgba(255,255,255,0.07),inset_0_-1px_1px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.35),0_14px_36px_rgba(0,0,0,0.50)]');
  });

  it('adds the ::before refraction layer and the ::after hover sheen in the scoped block', () => {
    // 第 2 层：边缘折射高光 + 四角镜面点（左上最亮 → 右上次之 → 右下/左下极弱）
    expectSourceContains(scopedStyle, '.glass-card::before');
    expectSourceContains(scopedStyle, 'radial-gradient');
    expectSourceContains(scopedStyle, '.dark .glass-card::before');
    // 镜面点必须是「小而亮、衰减极快」而非 Aero 的大范围柔光晕：小半径 + transparent 100%
    expectSourceContains(scopedStyle, 'transparent 100%');
    expectSourceNotContains(scopedStyle, 'transparent 55%');
    // 半径必须用绝对像素：radial-gradient 的百分比相对元素尺寸解析，同一 38% 在小指标卡
    // (~250px) 是 95px 的点、在趋势卡(~1000px) 却是 380px 的糊面——实机截图证实「卡越大
    // 越白」。故钉死 px 定值，并禁止镜面点回退到百分比半径（Aero 配方回潮的根源）。
    expectSourceContains(scopedStyle, 'radial-gradient(110px 86px at 0% 0%');
    expectSourceContains(scopedStyle, 'radial-gradient(90px 70px at 100% 0%');
    expect(scopedStyle).not.toMatch(/radial-gradient\(\d+% \d+% at/);
    // 第 3 层：hover 掠射光泽，transition 触发而非循环动画
    expectSourceContains(scopedStyle, '.glass-card::after');
    expectSourceContains(scopedStyle, '.glass-card:hover::after');
    expectSourceContains(scopedStyle, 'background-position');
    expectSourceNotContains(scopedStyle, 'animation');
    // 两个伪元素都绝不拦截鼠标
    expect(scopedStyle.match(/pointer-events:\s*none/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // 层序（修复"发白"）：眩光层在玻璃底色之上、内容之下——isolate 建堆叠上下文防负
    // z-index 逃逸到祖先背景后，两个伪元素均 z-index: -1（白纱罩内容即回归）
    expectSourceContains(scopedStyle, 'isolation: isolate');
    expect(scopedStyle.match(/z-index:\s*-1/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // 注意用正则而非 toContain('z-index: 1')：排行榜吸底行的 z-index: 10 会被子串误伤
    expect(scopedStyle).not.toMatch(/z-index:\s*1(?!\d)/);
  });

  it('disables the hover sheen under prefers-reduced-motion', () => {
    const reduced = scopedStyle.slice(scopedStyle.indexOf('@media (prefers-reduced-motion: reduce)'));
    expectSourceContains(reduced, '.glass-card::after');
  });

  it('keeps the new polish out of the flat look', () => {
    // 扁平分支切片里不得出现任何玻璃质感标记（负向，防渗漏）
    expectSourceNotContains(flat, 'glass-card');
    expectSourceNotContains(flat, 'backdrop-saturate-150');
    expectSourceNotContains(flat, 'shadow-[inset_');
  });
});

describe('Settings appearance section title', () => {
  it('renames the section to 组件样式 (zh / en)', () => {
    expectSourceContains(settingsSource, "switchStyleTitle: '组件样式',");
    expectSourceContains(settingsSource, "switchStyleTitle: 'Component Style',");
    expectSourceNotContains(settingsSource, '开关样式');
    expectSourceNotContains(settingsSource, "switchStyleTitle: 'Switch Style'");
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
  const flatStart = condensedSource.indexOf(condense('经典扁平模式'));
  const flat = condensedSource.slice(flatStart, condensedSource.lastIndexOf(condense('</template>')));
  const glassBranch = condensedSource.slice(condensedSource.indexOf(condense('<!-- 玻璃模式：3110e0da 的观感')), flatStart);

  it('renders the leaderboard inline inside the flat branch, next to the metrics', () => {
    // 内联排行榜整段逐字取自 04cacc5c^（排行榜拆成独立 tab 之前那版统计页）
    expectSourceContains(flat, '<section v-if="theme.showLeaderboard" class="px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1vw,0.875rem)] animate-fade-in-up" style="animation-delay: 400ms;">');
    expectSourceContains(flat, '{{ TEXT.leaderboard }}');
    expectSourceContains(flat, 'v-for="p in PERIOD_OPTIONS"');
    expectSourceContains(flat, 'class="leaderboard-row animate-fade-in-up"');
    expectSourceContains(flat, 'class="leaderboard-row is-me is-sticky animate-fade-in-up"');
    expectSourceContains(flat, '@contextmenu="handleLeaderboardContextMenu($event, item)"');
    expectSourceContains(flat, 'class="leaderboard-row leaderboard-row--login is-me is-sticky w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EC4141]/50"');
    // 指标与排行榜在同一扁平分支里并存
    expectSourceContains(flat, '{{ TEXT.totalSongs }}');
    expectSourceContains(flat, '{{ TEXT.longestPlayed }}');
  });

  it('keeps the inline leaderboard out of the glass branch', () => {
    // 玻璃档排行榜仍是独立页，统计页玻璃分支里不得混入内联排行榜标记
    expectSourceNotContains(glassBranch, 'leaderboard-row');
    expectSourceNotContains(glassBranch, 'PERIOD_OPTIONS');
    expectSourceNotContains(glassBranch, 'theme.showLeaderboard');
    expectSourceNotContains(glassBranch, 'leaderboard-period-tabs');
  });

  it('loads the inline leaderboard only in the flat look', () => {
    // 同一组件两档共用：内联排行榜的数据加载在玻璃档直接短路，玻璃档与本页改造前一致
    expectSourceContains(source, 'if (isGlass.value) return;');
    expectSourceContains(source, 'void loadLeaderboard();');
    expectSourceContains(source, 'await loadLeaderboard(true);');
  });

  it('hides the standalone leaderboard entry in the flat look only', () => {
    // 独立的「排行榜」子标签：仅在「显示排行榜」且玻璃档时出现
    expectSourceContains(homeTabsSource, 'if (theme.value.showLeaderboard && theme.value.useGlassSwitch) {');
    expectSourceContains(homeTabsSource, "{ key: 'leaderboard', label: isEnglish.value ? 'Leaderboard' : '排行榜' }");
    // discover 区域仍挂载独立 LeaderboardPage（玻璃档路径保留），扁平档回落到统计页
    expectSourceContains(homeAreaSource, 'import LeaderboardPage from');
    expectSourceContains(homeAreaSource, '<LeaderboardPage v-else-if="effectivePage === \'leaderboard\'" key="leaderboard" class="min-h-0 flex-1" />');
    expectSourceContains(homeAreaSource, "props.activePage === 'leaderboard' && !theme.value.useGlassSwitch ? 'statistics' : props.activePage");
  });
});
