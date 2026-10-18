// 移植自移动端 lib/src/cloud/providers/mobile139_provider.dart
// 移动云盘（139）provider（webviewCookie：登录页 Cookie 全收）。
//
// 登录凭据 → 账号构建与移动端同构（completeLogin）；桌面端没有 WebView
// 捕获通道，由设置页 Cookie 粘贴弹窗提供 captured.cookies。业务（列目录/
// 分享/转存/直链）经 cloudRemote 桥转发内嵌 Rust（src-tauri/src/cloud/mobile139.rs）。

import { cookieHeader } from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustSearchFiles, rustShareDirectLink, rustTransferShare, rustValidate } from '../cloudRemote';
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

/** URI 解码容错（Cookie 值可能含非法 % 序列）。 */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** pollScript 产出解析；平台通道偶发返回转义形态（{\"auth\":...}）：
 * 包回引号整体解码还原（对齐移动端 _parseAuthJson）。 */
function parseAuthJson(raw: string): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(raw);
    if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
      return j as Record<string, unknown>;
    }
  } catch {
    /* 继续转义重试 */
  }
  if (raw.includes('\\"')) {
    try {
      const dec: unknown = JSON.parse(`"${raw}"`);
      if (typeof dec === 'string') {
        const j: unknown = JSON.parse(dec);
        if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
          return j as Record<string, unknown>;
        }
      }
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

/** "Basic " + base64("pc:账号:token") 且 token ≥4 段 '|'（与 pollScript
 * 校验同口径，对齐移动端 _validBasic）。 */
function validBasic(v: string): boolean {
  if (!v.startsWith('Basic ')) return false;
  try {
    const bin = atob(v.substring(6));
    const dec = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
    if (!dec.startsWith('pc:')) return false;
    const seg = dec.split(':');
    return seg.length >= 3 && (seg[2] ?? '').split('|').length >= 4;
  } catch {
    return false;
  }
}

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
    // 直达网页版登录页（/w/ SPA 的 / 路由即登录）；桌面端仅作提示值。
    return 'https://yun.139.com/w/#/';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      // 全收（cookieNames 空 = 非空即采），登录完成由 URL 判定。
      doneUrlPattern: /yun\.139\.com/,
      pollIntervalMs: 500,
    });
  }

  // ── 登录 ──────────────────────────────────────────────

  override async completeLogin(captured: CloudCaptureResult): Promise<CloudAccount> {
    let auth = '';
    const raw = captured.token ?? '';
    if (raw !== '') {
      const parsed = parseAuthJson(raw);
      auth = String(parsed?.['auth'] ?? '');
    }
    // 兜底：pollScript 未命中的平台差异下，原生 Cookie 通道可能已拿到
    // authorization（值可能经 escape/encodeURIComponent 转义）。
    if (!validBasic(auth)) {
      const c = captured.cookies['authorization'] ?? '';
      const dec = c === '' ? '' : safeDecode(c);
      auth = validBasic(c) ? c : validBasic(dec) ? dec : '';
    }
    if (!validBasic(auth)) {
      throw new CloudException('未捕获到登录凭据，请重新登录');
    }
    const authorization = auth.substring(6);
    const cookie = cookieHeader(captured.cookies);
    // 139 账号即手机号（凭据形态 pc:<手机号>:<sig>）；官方 web 端个人
    // 标识同样使用脱敏手机号（未提供面向网页的昵称接口），据此显示。
    let nick = '移动云盘';
    try {
      const bin = atob(authorization);
      const dec = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
      const seg = dec.split(':');
      if (seg.length >= 2 && (seg[1] ?? '').length >= 7) {
        const p = seg[1]!;
        nick = `${p.substring(0, 3)}****${p.substring(p.length - 4)}`;
      }
    } catch {
      /* 昵称兜底 */
    }
    return new CloudAccount({
      provider: this.id,
      accountId: (await md5Hex(authorization)).substring(0, 12),
      nickname: nick,
      cred: {
        'authorization': authorization,
        ...(cookie !== '' ? { 'cookie': cookie } : {}),
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
