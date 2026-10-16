// 移植自移动端 lib/src/cloud/providers/thunder_provider.dart
// 迅雷云盘 provider（webviewToken：pan.xunlei.com 网页登录捕获）。
//
// 2026-10-16 迁移：X App 账密通道（thunderx 参数 + BuildCustomUserAgent
// 定制串）与网页版用户表按 client 维度隔离（X 参数报 not_found(5)），且
// API 直调 auth/signin 有 IP/账号维度风控（review 4002，6h 不冷却）。
//
// 桌面端无 WebView 登录：completeLogin 引导去手机端绑定，凭据走云同步。
// 关键点：refresh_token 单次有效，rust 刷新后的轮换凭据经响应
// rotated_cred 带回、由 cloudRemote 统一回写本地凭据存储。
//
// 业务经 cloudRemote 桥转发内嵌 Rust
//（src-tauri/src/cloud/thunder.rs，XCloud 架构与 PikPak 同构）。

import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustSearchFiles, rustTransferShare, rustValidate } from '../cloudRemote';
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

// 网页版 client（pan.xunlei.com）：用户表按 client 维度隔离。
const CLIENT_ID = 'Xqp0kJBXWhwaTpB6';

export class ThunderProvider extends CloudProvider {
  override get id(): string {
    return 'thunder';
  }

  override get displayName(): string {
    return '迅雷云盘';
  }

  override get rootPath(): string {
    return '';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.WebviewToken;
  }

  override get directLinkTtl(): number {
    return 30 * 60 * 1000;
  }

  override get webviewLoginUrl(): string {
    return 'https://pan.xunlei.com/';
  }

  /** 轮询脚本：必须是返回字符串的 JS 表达式（IIFE）。
   * credentials（含 refresh_token）出现即认为登录完成。 */
  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      pollScript: `(() => {
  try {
    var raw = window.localStorage.getItem('credentials_${CLIENT_ID}');
    if (!raw) return "";
    var o = JSON.parse(raw);
    var rt = String(o.refresh_token || '');
    if (!rt) return "";
    var dev = '';
    try { dev = String(window.localStorage.getItem('deviceid') || ''); } catch (e2) {}
    var nick = String(o.user_name || o.nick_name || '');
    if (!nick) {
      try {
        var up = JSON.parse(window.localStorage.getItem('USER_PRIVILEGE_USER_SECURITY_TOKEN_expiration') || 'null');
        var tok = up && up.user_security_token ? String(up.user_security_token) : '';
        if (tok) {
          var pl = window.atob(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          var u = JSON.parse(window.atob(pl)).username;
          if (u) nick = String(u);
        }
      } catch (e3) {}
    }
    return JSON.stringify({
      at: String(o.access_token || ''),
      rt: rt,
      uid: String(o.user_id || o.sub || ''),
      nick: nick,
      dev: dev
    });
  } catch (e) { return ""; }
})()`,
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
