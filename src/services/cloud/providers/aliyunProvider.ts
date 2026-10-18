// 移植自移动端 lib/src/cloud/providers/aliyun_provider.dart
// 阿里云盘 provider（webviewToken：oauth 页轮询 localStorage 抓
// refresh_token）。
//
// 登录凭据 → 账号构建与移动端同构（completeLogin）；桌面端没有 WebView
// 捕获通道，由设置页 Token 粘贴弹窗提供 captured.token（包含 refresh_token
// 的 JSON 或裸 refresh_token）。关键点：refresh_token 单次有效，rust 刷新
// 后的轮换凭据经响应 rotated_cred 带回、由 cloudRemote 统一回写本地凭据存储。

import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustFileName, rustListDir, rustParseShare, rustSearchFiles, rustTransferShare, rustValidate } from '../cloudRemote';
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

  override async completeLogin(captured: CloudCaptureResult): Promise<CloudAccount> {
    const raw = captured.token ?? '';
    if (raw === '') {
      throw new CloudException('未捕获到登录凭据，请重新登录');
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // 平台通道偶发返回转义形态（{\"rt\":...}）：包回引号整体解码还原
      // 一层再试（对齐移动端）。
      let retry: Record<string, unknown> | null = null;
      if (raw.includes('\\"')) {
        try {
          const dec: unknown = JSON.parse(`"${raw}"`);
          if (typeof dec === 'string') {
            retry = JSON.parse(dec) as Record<string, unknown>;
          }
        } catch {
          /* 放弃 */
        }
      }
      if (retry !== null) {
        parsed = retry;
      } else {
        // 手填裸 refresh_token（非 JSON）直接当 rt 用。
        const bare = raw.trim();
        if (bare !== '' && !bare.includes('{')) {
          parsed = { 'rt': bare };
        } else {
          throw new CloudException('登录凭据解析失败，请重新登录');
        }
      }
    }
    // 新通道：官方 callback postMessage 的 tokenInfo（/token/get 响应，
    // 字段在顶层，data 里可能有包裹）；旧通道：pollScript 打包的
    // {rt, uid, nick}。两者兼容解析（对齐移动端）。
    const data = (parsed['data'] ?? null) !== null && typeof parsed['data'] === 'object' && !Array.isArray(parsed['data'])
      ? (parsed['data'] as Record<string, unknown>)
      : {};
    const fieldOf = (keys: string[]): string => {
      for (const k of keys) {
        const v = parsed[k] ?? data[k];
        if (v !== null && v !== undefined && String(v) !== '') return String(v);
      }
      return '';
    };

    const refreshToken = fieldOf(['rt', 'refresh_token']);
    if (refreshToken === '') {
      throw new CloudException('未捕获到登录凭据，请重新登录');
    }
    const uid = fieldOf(['uid', 'user_id']);
    const nick = fieldOf(['nick', 'nick_name', 'user_name', 'name']);
    const accountId = uid !== '' ? uid : refreshToken.substring(0, 12);
    return new CloudAccount({
      provider: this.id,
      accountId,
      nickname: nick !== '' ? nick : '阿里云盘',
      cred: {
        // accountId 冗余存一份：refresh 轮换落盘时按它定位账号。
        'refreshToken': refreshToken,
        'userId': uid,
        'nickname': nick,
        'accountId': accountId,
      },
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

  /** 本盘按 file_id 存目录（选择器持久化的是 id）：无路径尾段可取，走 file_get 查名。 */
  override async describeDirName(cred: Record<string, string>, dirPath: string): Promise<string | null> {
    if (dirPath.includes('/')) {
      return super.describeDirName(cred, dirPath);
    }
    return rustFileName(this.id, cred, dirPath);
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

// ── 文件内辅助 ───────────────────────────────────────────

/** Dart Uri.encodeQueryComponent 对应物（webviewLoginUrl 拼 query 用）。 */
function encodeUri(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}
