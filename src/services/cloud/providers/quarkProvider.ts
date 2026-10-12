// 移植自移动端 lib/src/cloud/providers/quark_provider.dart
// 夸克网盘：继承 QuarkUcBase，仅声明品牌常量（业务经 cloudRemote 桥
// 转发内嵌 Rust，免速兜底路由在 rust 侧 quark_uc.rs 内实现）。

import { CloudCaptureRule } from '../cloudTypes';
import { QuarkUcBase } from './quarkUcBase';

export class QuarkProvider extends QuarkUcBase {
  override get id(): string {
    return 'quark';
  }

  override get displayName(): string {
    return '夸克网盘';
  }

  override get apiHost(): string {
    return 'drive-pc.quark.cn';
  }

  override get webHost(): string {
    return 'pan.quark.cn';
  }

  override get pr(): string {
    return 'quark';
  }

  override get uaBrand(): string {
    return 'quark-cloud-drive';
  }

  override get webviewLoginUrl(): string {
    // passport.quark.cn 域名 DNS 不存在，从网盘首页登录。
    return 'https://pan.quark.cn/';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      cookieNames: ['kps', 'sign'],
      cookieDomains: ['pan.quark.cn'],
      pollIntervalMs: 500,
    });
  }
}
