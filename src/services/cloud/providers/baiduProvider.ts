// 移植自移动端 lib/src/cloud/providers/baidu_provider.dart
// 百度网盘 provider（webviewCookie：BDUSS/STOKEN）。
//
// 桌面端无 WebView 登录：completeLogin 引导去手机端绑定，凭据走云同步。
// 注意：分享列表/转存接口必须带登录态（BDUSS），故 parseShareLink 内
// 直接读本地绑定凭据；业务一律经 cloudRemote 桥转发内嵌 Rust。

import { CloudCredentialsStore } from '../cloudCredentialsStore';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustTransferShare, rustValidate } from '../cloudRemote';
import {
  CloudAccount,
  CloudCaptureResult,
  CloudCaptureRule,
  CloudDirectLink,
  CloudException,
  CloudFile,
  CloudListResult,
  CloudLoginKind,
  CloudShareParse,
} from '../cloudTypes';

export class BaiduProvider extends CloudProvider {
  override get id(): string {
    return 'baidu';
  }

  override get displayName(): string {
    return '百度网盘';
  }

  override get rootPath(): string {
    return '/';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.WebviewCookie;
  }

  override get directLinkTtl(): number {
    return 8 * 60 * 60 * 1000;
  }

  override get webviewLoginUrl(): string {
    return 'https://pan.baidu.com/';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      cookieNames: ['BDUSS', 'STOKEN'],
      cookieDomains: ['pan.baidu.com'],
      doneUrlPattern: /pan\.baidu\.com\/(disk|main|share)/,
      pollIntervalMs: 500,
    });
  }

  // ── 登录 ──────────────────────────────────────────────

  override async completeLogin(_captured: CloudCaptureResult): Promise<CloudAccount> {
    throw new Error('该盘需在手机端网页登录');
  }

  // ── 业务（rust 桥转发）─────────────────────────────────

  override async validate(cred: Record<string, string>): Promise<boolean> {
    return rustValidate(this.id, cred);
  }

  override async listDir(
    cred: Record<string, string>,
    path: string,
    cursor?: string | null,
  ): Promise<CloudListResult> {
    return rustListDir(this.id, cred, path, cursor);
  }

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    // 解析需登录态（BDUSS）；未绑定账号时在此抛出，行为与原实现一致。
    const cred = await this._soleCredOrThrow();
    return rustParseShare(this.id, url, pwd, cred);
  }

  override async transferShareFiles(
    cred: Record<string, string>,
    share: CloudShareParse,
  ): Promise<CloudFile[]> {
    return rustTransferShare(this.id, cred, share);
  }

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    return rustDirectLink(this.id, cred, file);
  }

  /** 分享列表/转存需要登录态；未绑定直接报。 */
  private async _soleCredOrThrow(): Promise<Record<string, string>> {
    const cred = await CloudCredentialsStore.instance.soleCredFor(this.id);
    if (cred == null) throw new CloudException('请先绑定百度网盘');
    return cred;
  }
}
