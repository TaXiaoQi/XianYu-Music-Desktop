// 移植自移动端 lib/src/cloud/providers/aliyun_provider.dart
// 阿里云盘 provider（webviewToken：oauth 页轮询 localStorage 抓
// refresh_token）。
//
// 桌面端无 WebView 登录：completeLogin 引导去手机端绑定，凭据走云同步。
// 关键点：refresh_token 单次有效，每次刷新 access_token 后必须把新
// refresh_token 经 updateCred 落盘，否则下次刷新全部失效。

import { CloudCredentialsStore } from '../cloudCredentialsStore';
import {
  asArray,
  asInt,
  asRecord,
  asString,
  cloudPostJson,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
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
import { parseUrlToProvider } from '../shareLinkParser';

const CLIENT_ID = '25dzX3vbYqktVxyX';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class AliyunProvider extends CloudProvider {
  private _h(accessToken: string): Record<string, string> {
    return {
      'User-Agent': UA,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  /** drive_id 实例内缓存（用户维度不变）。 */
  private _driveIdCache = new Map<string, string>();

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

  override async validate(cred: Record<string, string>): Promise<boolean> {
    try {
      const at = await this._accessToken(cred, false);
      const resp = await cloudPostJson('https://api.alipan.com/adrive/v2/user/getInfo', {
        body: {},
        headers: this._h(at),
      });
      return resp.isOk;
    } catch {
      return false;
    }
  }

  // ── 目录 ──────────────────────────────────────────────

  override async listDir(
    cred: Record<string, string>,
    path: string,
    cursor?: string | null,
  ): Promise<CloudListResult> {
    const at = await this._accessToken(cred, true);
    const driveId = await this._driveId(cred, at);
    const resp = await cloudPostJson('https://api.alipan.com/adrive/v3/file/list', {
      body: {
        'drive_id': driveId,
        'parent_file_id': path,
        'limit': 100,
        'marker': cursor ?? '',
        'order_by': 'name',
        'order_direction': 'ASC',
        'fields': '*',
      },
      headers: this._h(at),
    });
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const items = asArray(resp.json['items']);
    const files: CloudFile[] = [];
    for (const item of items) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['file_id'] ?? ''),
          name: asString(e['name'] ?? ''),
          isDir: e['type'] === 'folder',
          size: asInt(e['size']) ?? 0,
          parentId: asString(e['parent_file_id'] ?? ''),
        }),
      );
    }
    const nextMarker = asString(resp.json['next_marker'] ?? '');
    return new CloudListResult({
      files,
      nextCursor: nextMarker === '' ? null : nextMarker,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const shareId = info?.shareId ?? url;
    // 免提取码：匿名接口直接拿顶层文件。
    const anonResp = await cloudPostJson(
      'https://api.alipan.com/adrive/v2/share_link/get_share_by_anonymous',
      {
        body: { 'share_id': shareId },
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      },
    );
    let files: CloudFile[] = [];
    let shareToken: string | null = null;
    if (anonResp.isOk) {
      const infos = asArray(anonResp.json['file_infos']);
      for (const item of infos) {
        const e = asRecord(item);
        if (!e) continue;
        files.push(this._fileFromShareItem(e));
      }
    }
    // 匿名拿不到（目录分享/需提取码）→ share_token → 文件列表。
    if (files.length === 0) {
      const tokResp = await cloudPostJson(
        'https://api.alipan.com/adrive/v2/share_link/get_share_token',
        {
          body: { 'share_id': shareId, 'share_pwd': pwd ?? '' },
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
        },
      );
      if (!tokResp.isOk) throw new CloudException('分享链接解析失败');
      shareToken = asString(asRecord(tokResp.json['data'])?.['share_token'] ?? '');
      if (shareToken === '') throw new CloudException('提取码错误');
      const listResp = await cloudPostJson(
        'https://api.alipan.com/adrive/v3/share_link/file/list',
        {
          body: {
            'share_id': shareId,
            'share_token': shareToken,
            'parent_file_id': 'root',
            'limit': 100,
          },
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
        },
      );
      if (!listResp.isOk) throw new CloudException('分享文件列表获取失败');
      const items = asArray(listResp.json['items']);
      for (const item of items) {
        const e = asRecord(item);
        if (!e) continue;
        files.push(this._fileFromShareItem(e));
      }
    }
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId,
      shareToken,
      passcode: pwd,
      directPlayable: false,
    });
  }

  private _fileFromShareItem(e: Record<string, unknown>): CloudFile {
    return new CloudFile({
      id: asString(e['file_id'] ?? e['share_file_id'] ?? ''),
      name: asString(e['name'] ?? e['file_name'] ?? ''),
      isDir: e['type'] === 'folder',
      size: asInt(e['size']) ?? 0,
    });
  }

  override async transferShareFiles(
    cred: Record<string, string>,
    share: CloudShareParse,
  ): Promise<CloudFile[]> {
    const at = await this._accessToken(cred, true);
    const driveId = await this._driveId(cred, at);
    const token = share.shareToken;
    if (token == null || token === '') throw new CloudException('请先填写提取码');
    const resp = await cloudPostJson('https://api.alipan.com/adrive/v2/share_link/save_created', {
      body: {
        'share_id': share.shareId,
        'share_token': token,
        'auto_import': true,
        'to_drive_id': driveId,
        'to_parent_file_id': 'root',
        'file_list': share.files.map((f) => ({ 'share_file_id': f.id, 'file_name': f.name })),
      },
      headers: this._h(at),
    });
    if (!resp.isOk) throw new CloudException('转存失败');
    const list = asArray(resp.json['file_list']);
    const out: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      out.push(
        new CloudFile({
          id: asString(e['file_id'] ?? ''),
          name: asString(e['name'] ?? e['file_name'] ?? ''),
          isDir: e['type'] === 'folder',
          size: asInt(e['size']) ?? 0,
        }),
      );
    }
    if (out.length === 0) {
      // 接口不回新 id 时回退原 files（阿里 file_id 转存后不变）。
      return share.files;
    }
    return out;
  }

  // ── 直链 ──────────────────────────────────────────────

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const at = await this._accessToken(cred, true);
    const driveId = await this._driveId(cred, at);
    const resp = await cloudPostJson('https://api.alipan.com/adrive/v2/file/get_download_url', {
      body: { 'drive_id': driveId, 'file_id': file.id },
      headers: this._h(at),
    });
    if (!resp.isOk) throw new CloudException('直链获取失败');
    const url = asString(
      resp.json['url'] ?? asRecord(resp.json['data'])?.['url'] ?? '',
    );
    if (url === '') throw new CloudException('直链获取失败');
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': UA },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    });
  }

  // ── token 生命周期 ────────────────────────────────────

  /** 换 access_token；refresh_token 轮换后必须落盘（persist=true 时）。 */
  private async _accessToken(cred: Record<string, string>, persist: boolean): Promise<string> {
    const expireMs = parseIntSafe(cred['accessExpireMs']);
    const cached = cred['accessToken'];
    if (cached != null && cached !== '' && Date.now() < expireMs) {
      return cached;
    }
    const refreshToken = cred['refreshToken'];
    if (refreshToken == null || refreshToken === '') {
      throw new CloudException('登录凭据缺失，请重新绑定');
    }
    const resp = await cloudPostJson('https://auth.alipan.com/v2/account/token', {
      body: {
        'client_id': CLIENT_ID,
        'grant_type': 'refresh_token',
        'refresh_token': refreshToken,
      },
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    });
    if (!resp.isOk) throw new CloudException('登录已过期，请重新绑定');
    const data = resp.json;
    const newRefresh = asString(data['refresh_token'] ?? refreshToken);
    const access = asString(data['access_token'] ?? '');
    if (access === '') throw new CloudException('登录已过期，请重新绑定');
    const expiresIn = asInt(data['expires_in']) ?? 7200;
    const newCred: Record<string, string> = {
      'refreshToken': newRefresh,
      'userId': cred['userId'] ?? '',
      'nickname': cred['nickname'] ?? '',
      'accountId': cred['accountId'] ?? '',
      'accessToken': access,
      'accessExpireMs': `${Date.now() + expiresIn * 1000}`,
    };
    if (persist) {
      const targetId = cred['accountId'] ?? '';
      if (targetId !== '') {
        await CloudCredentialsStore.instance.updateCred(this.id, targetId, newCred);
      }
    }
    // 本次会话内也同步给调用方持有的 map（persist=false 时至少进程内生效）。
    for (const k of Object.keys(cred)) delete cred[k];
    Object.assign(cred, newCred);
    return access;
  }

  private async _driveId(cred: Record<string, string>, at: string): Promise<string> {
    const cached = this._driveIdCache.get(cred['userId'] ?? '');
    if (cached != null) return cached;
    const resp = await cloudPostJson('https://api.alipan.com/adrive/v2/user/getInfo', {
      body: {},
      headers: this._h(at),
    });
    const driveId = asString(
      asRecord(resp.json['data'])?.['default_drive_id'] ?? resp.json['default_drive_id'] ?? '',
    );
    if (driveId === '') throw new CloudException('网盘信息获取失败');
    this._driveIdCache.set(cred['userId'] ?? '', driveId);
    return driveId;
  }
}

// ── 文件内辅助 ───────────────────────────────────────────

/** Dart Uri.encodeQueryComponent 对应物（webviewLoginUrl 拼 query 用）。 */
function encodeUri(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

function parseIntSafe(s: string | undefined): number {
  if (s == null || s === '') return 0;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}
