// 内置 lx 直连兜底的平台开关：对应平台需有启用插件才可用
// （歌单导入内置链与宿主兜底链共用；搜索/lx:// 播放链路已天然受插件启停控制）。

import { getStoredPlugins } from './pluginEngine';
import { isQishuiSource } from './playlistImportQishui';

export type HostDirectPlatform = 'kg' | 'qishui' | 'wy' | 'tx' | 'kw' | 'mg';

/** 判断该平台是否允许使用内置 lx 直连兜底：
 *  - wy/tx/kw/kg/mg：存在启用的 lx 插件声明该音源（p.sources 含平台 id）
 *  - qishui：存在任意已启用且匹配汽水的插件（lx 用 sources 含 qs；
 *    musicfree/anime 用 isQishuiSource 判定——汽水插件一般是 anime/musicfree 格式） */
export function hasEnabledLxPluginFor(platform: HostDirectPlatform): boolean {
  const plugins = getStoredPlugins().filter(p => p.enabled);
  if (platform === 'qishui') {
    return plugins.some(p =>
      p.format === 'lx'
        ? p.sources.includes('qs')
        : isQishuiSource(p.name, p.sources || []),
    );
  }
  return plugins.some(p => p.format === 'lx' && p.sources.includes(platform));
}
