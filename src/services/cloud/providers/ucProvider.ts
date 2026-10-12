// 移植自移动端 lib/src/cloud/providers/uc_provider.dart
// UC 网盘：继承 QuarkUcBase，仅声明品牌与扫码常量（接口与夸克同构）。

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

  override get casHost(): string {
    return 'api.open.uc.cn';
  }

  override get qrContentTemplate(): string {
    return (
      'https://broccoli.uc.cn/apps/ZY5qIZiK/routes/1hbcQwLhH' +
      '?uc_param_str=dsdnfrpfbivesscpgimibtbmnijblauputogpintnwktprchmt' +
      '&uc_biz_str=S%3Acustom%7CC%3Atitlebar_hover_2' +
      '&token={token}&client_id=381&ssb=weblogin'
    );
  }
}
