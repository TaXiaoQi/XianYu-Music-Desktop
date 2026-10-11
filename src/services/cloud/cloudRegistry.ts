// 移植自移动端 lib/src/cloud/cloud_registry.dart
// 网盘注册表：集中注册 11 盘实现，提供按 id 查找与分享链接归属识别。

import { CloudProvider } from './cloudProvider';
import { AliyunProvider } from './providers/aliyunProvider';
import { BaiduProvider } from './providers/baiduProvider';
import { Ecloud189Provider } from './providers/ecloud189Provider';
import { LanzouProvider } from './providers/lanzouProvider';
import { Mobile139Provider } from './providers/mobile139Provider';
import { Pan123Provider } from './providers/pan123Provider';
import { PikpakProvider } from './providers/pikpakProvider';
import { QuarkProvider } from './providers/quarkProvider';
import { ThunderProvider } from './providers/thunderProvider';
import { UcProvider } from './providers/ucProvider';
import { WeiyunProvider } from './providers/weiyunProvider';

export const cloudProviders: CloudProvider[] = [
  new BaiduProvider(),
  new AliyunProvider(),
  new QuarkProvider(),
  new UcProvider(),
  new Ecloud189Provider(),
  new Mobile139Provider(),
  new ThunderProvider(),
  new Pan123Provider(),
  new PikpakProvider(),
  new LanzouProvider(),
  new WeiyunProvider(),
];

/** 按 id 查找；未注册返回 null。 */
export function cloudProviderById(id: string): CloudProvider | null {
  for (const p of cloudProviders) {
    if (p.id === id) return p;
  }
  return null;
}
