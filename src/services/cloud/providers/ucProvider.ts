// 移植自移动端 lib/src/cloud/providers/uc_provider.dart
// UC 网盘：继承 QuarkUcBase，仅声明品牌常量（接口与夸克同构）。
// 登录为 WebView 范式：桌面端走内嵌 WebView 登录窗（Cookie 原生捕获）。

import { QuarkUcBase } from './quarkUcBase';

export class UcProvider extends QuarkUcBase {
  override get id(): string {
    return 'uc';
  }

  override get displayName(): string {
    return 'UC网盘';
  }

  override get apiHost(): string {
    return 'pc-api.uc.cn';
  }

  override get webHost(): string {
    return 'drive.uc.cn';
  }

  override get captureCookieDomains(): string[] {
    return ['uc.cn', 'drive.uc.cn', 'pc.uc.cn', 'passport.uc.cn'];
  }

  // 营销页横向溢出，登录卡在右侧视口外，窗口内滚到最右直接露出
  override get alignLoginRight(): boolean {
    return true;
  }

  // 2026-10-16 起 ucpro 通道收紧拒 Web Cookie（401 guest，PC 实测），
  // UC 切 UCBrowser 通道（对 Web Cookie 宽容，OpenList 同款）。
  override get pr(): string {
    return 'UCBrowser';
  }

  override get uaBrand(): string {
    return 'uc-cloud-drive';
  }
}
