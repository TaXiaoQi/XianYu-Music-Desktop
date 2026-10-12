// 移植自移动端 lib/src/cloud/providers/weiyun_provider.dart
// 微云 provider（webviewToken 混合：openid 走 pollScript，会话走
// Cookie）。
//
// 登录捕获留在 TS；业务经 cloudRemote 桥转发内嵌 Rust
//（src-tauri/src/cloud/weiyun.rs）。

import { asRecord, cookieHeader } from '../cloudHttp';
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
import { md5Hex } from './httpLoginSupport';

export class WeiyunProvider extends CloudProvider {
  override get id(): string {
    return 'weiyun';
  }

  override get displayName(): string {
    return '腾讯微云';
  }

  override get rootPath(): string {
    return '';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.WebviewToken;
  }

  override get webviewLoginUrl(): string {
    return 'https://www.weiyun.com/';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      doneUrlPattern: /weiyun\.com/,
      pollScript: `(() => {
  var qq = null, wx = null;
  try { qq = localStorage.getItem('weiyun_qq_openid'); } catch (e) {}
  try { wx = localStorage.getItem('weiyun_wx_openid'); } catch (e) {}
  if ((qq && qq.length) || (wx && wx.length)) {
    return JSON.stringify({qq: qq, wx: wx});
  }
  return "";
})()`,
      pollIntervalMs: 500,
    });
  }

  // ── 登录 ──────────────────────────────────────────────

  override async completeLogin(captured: CloudCaptureResult): Promise<CloudAccount> {
    let openid = '';
    if (captured.token != null && captured.token !== '') {
      try {
        const rec = asRecord(JSON.parse(captured.token));
        if (rec) {
          openid = String(rec['qq'] ?? rec['wx'] ?? '');
        }
      } catch {
        // token 不是合法 JSON：忽略
      }
    }
    const cookie = cookieHeader(captured.cookies);
    if (openid === '' && cookie === '') {
      throw new CloudException('未捕获到登录凭据，请重新登录');
    }
    return new CloudAccount({
      provider: this.id,
      accountId: (await md5Hex(openid === '' ? cookie : openid)).substring(0, 12),
      nickname: '腾讯微云',
      cred: { 'cookie': cookie, 'openid': openid },
      boundAt: new Date(),
    });
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
    return rustParseShare(this.id, url, pwd);
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
}
