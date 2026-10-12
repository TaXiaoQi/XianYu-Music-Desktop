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
    return 'drive-pc.uc.cn';
  }

  override get webHost(): string {
    return 'drive.uc.cn';
  }

  override get pr(): string {
    return 'ucpro';
  }

  override get uaBrand(): string {
    return 'uc-cloud-drive';
  }
}
