// 移植自移动端 lib/src/cloud/providers/uc_provider.dart
// UC 网盘：继承 QuarkUcBase，仅声明品牌常量（接口与夸克同构）。
// 登录为 WebView 范式：桌面端不做网页登录，引导去手机端绑定（凭据云同步）。

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

  // 2026-10-16 起 ucpro 通道收紧拒 Web Cookie（401 guest，PC 实测），
  // UC 切 UCBrowser 通道（对 Web Cookie 宽容，OpenList 同款）。
  override get pr(): string {
    return 'UCBrowser';
  }

  override get uaBrand(): string {
    return 'uc-cloud-drive';
  }
}
