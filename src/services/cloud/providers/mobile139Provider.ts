// 移植自移动端 lib/src/cloud/providers/mobile139_provider.dart
// 移动云盘（139）provider（webviewCookie：登录页 Cookie 全收）。
//
// 桌面端无 WebView 登录：completeLogin 引导去手机端绑定，凭据走云同步。
// 业务（列目录/分享/转存/直链）经 cloudRemote 桥转发内嵌 Rust
//（src-tauri/src/cloud/mobile139.rs）。

import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustSearchFiles, rustShareDirectLink, rustTransferShare, rustValidate } from '../cloudRemote';
import {
  CloudAccount,
  CloudCaptureResult,
  CloudCaptureRule,
  CloudDirectLink,
  CloudFile,
  CloudListResult,
  CloudLoginKind,
  CloudShareParse,
} from '../cloudTypes';

export class Mobile139Provider extends CloudProvider {
  override get id(): string {
    return 'mobile139';
  }

  override get displayName(): string {
    return '移动云盘';
  }

  override get rootPath(): string {
    return 'root';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.WebviewCookie;
  }

  override get webviewLoginUrl(): string {
    return 'https://yun.139.com/';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      // 全收（cookieNames 空 = 非空即采），登录完成由 URL 判定。
      doneUrlPattern: /yun\.139\.com/,
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

  override get supportsSearch(): boolean {
    return true;
  }

  override async searchFiles(
    cred: Record<string, string>,
    keyword: string,
    cursor?: string | null,
  ): Promise<CloudListResult> {
    return rustSearchFiles(this.id, cred, keyword, cursor);
  }

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    return rustParseShare(this.id, url, pwd);
  }

  /** 分享免转存直链（dlFromOutLinkV3）。 */
  override async getShareDirectLink(
    cred: Record<string, string> | null,
    share: CloudShareParse,
    file: CloudFile,
  ): Promise<CloudDirectLink> {
    return rustShareDirectLink(this.id, cred, share, file);
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
