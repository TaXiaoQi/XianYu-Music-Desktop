// 移植自移动端 lib/src/cloud/providers/aliyun_provider.dart
// 阿里云盘 provider（webviewToken：oauth 页轮询 localStorage 抓
// refresh_token）。
//
// 桌面端无 WebView 登录：completeLogin 引导去手机端绑定，凭据走云同步。
// 关键点：refresh_token 单次有效，rust 刷新后的轮换凭据经响应
// rotated_cred 带回、由 cloudRemote 统一回写本地凭据存储。

import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustTransferShare, rustValidate } from '../cloudRemote';
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

const CLIENT_ID = '25dzX3vbYqktVxyX';

export class AliyunProvider extends CloudProvider {
  override get id(): string {
    return 'aliyun';
  }

  override get displayName(): string {
    return '阿里云盘';
  }

  override get rootPath(): string {
    return 'root';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.WebviewToken;
  }

  override get directLinkTtl(): number {
    return 4 * 60 * 60 * 1000;
  }

  override get webviewLoginUrl(): string {
    return (
      'https://auth.aliyundrive.com/v2/oauth/authorize?login_type=custom' +
      '&response_type=code' +
      `&redirect_uri=${encodeUri('https://www.aliyundrive.com/sign/callback')}` +
      `&client_id=${CLIENT_ID}` +
      `&state=${encodeUri('{"origin":"*"}')}#/login`
    );
  }

  /** 轮询脚本：必须是返回字符串的 JS 表达式（IIFE）。
   * 遍历 localStorage/sessionStorage 找 refresh_token（键名兼容多种）。 */
  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      pollScript: `(() => {
  var keys = ['token','TOKEN','loginToken','login_token','auth_token',
              'aliyundrive_token','alipan_token','accountToken'];
  var stores = [window.localStorage, window.sessionStorage];
  for (var s = 0; s < stores.length; s++) {
    for (var i = 0; i < keys.length; i++) {
      var raw = null;
      try { raw = stores[s].getItem(keys[i]); } catch (e) {}
      if (!raw) continue;
      var obj = raw;
      try { obj = JSON.parse(raw); } catch (e) {}
      var rt = '', uid = '', nick = '';
      var found = (function scan(o, depth) {
        if (!o || typeof o !== 'object' || depth > 3) return false;
        if (o.refresh_token) {
          rt = String(o.refresh_token);
          uid = o.user_id ? String(o.user_id) : '';
          nick = (o.nick_name || o.name || '').toString();
          return true;
        }
        if (o.data && scan(o.data, depth + 1)) return true;
        if (o.content && scan(o.content, depth + 1)) return true;
        return false;
      })(obj, 0);
      if (found) {
        return JSON.stringify({rt: rt, uid: uid, nick: nick});
      }
    }
  }
  return "";
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

// ── 文件内辅助 ───────────────────────────────────────────

/** Dart Uri.encodeQueryComponent 对应物（webviewLoginUrl 拼 query 用）。 */
function encodeUri(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}
