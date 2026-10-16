// 移植自移动端 lib/src/cloud/providers/quark_provider.dart
// 夸克网盘：继承 QuarkUcBase，仅声明品牌常量（业务经 cloudRemote
// 桥转发内嵌 Rust，免速兜底路由在 rust 侧 quark_uc.rs 内实现）。
// 登录为 WebView 范式：桌面端不做网页登录，引导去手机端绑定（凭据云同步）。

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

  // pr=ucpro 网关通道（pr=quark 客户端通道风控拒 Web Cookie；UC 侧
  // 2026-10-16 起也切 UCBrowser，与夸克通道不再相同）。
  override get pr(): string {
    return 'ucpro';
  }

  override get uaBrand(): string {
    return 'quark-cloud-drive';
  }
}
