import { describe, expect, it } from 'vitest';

import source from './Settings.vue?raw';

/**
 * 设置页新增一个 tab 要登记五处：`SettingsTabId` 联合类型、`VALID_TABS`、`settingsLoaders`、
 * `baseTabs`，以及模板里那条**手写的 v-if 渲染链**。
 *
 * 漏掉前四处都会立刻报错，唯独漏掉最后一条不会——模板会安静地掉进 v-else 的「施工中」占位。
 * 睡眠定时的 tab 就这么漏过一次（常量没声明、渲染链没有对应分支，四项验证与构建依然全绿）。
 * 这里把它钉住：VALID_TABS 里每个 id 都必须在模板里有对应分支。
 */

/** 有意做成「施工中」占位的 tab 写在这里（目前没有） */
const INTENTIONAL_PLACEHOLDER_TABS: string[] = [];

const validTabs = (() => {
  const match = source.match(/const VALID_TABS[^=]*=\s*\[([^\]]+)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
})();

describe('Settings 页 tab 登记一致性', () => {
  it('能解析出 VALID_TABS（防止正则失效后断言变空转）', () => {
    expect(validTabs.length).toBeGreaterThan(10);
  });

  it('每个 tab 在模板渲染链里都有对应分支', () => {
    const missing = validTabs.filter(tab => (
      !INTENTIONAL_PLACEHOLDER_TABS.includes(tab)
      && !source.includes(`activeTab === '${tab}'`)
    ));
    expect(missing).toEqual([]);
  });
});
