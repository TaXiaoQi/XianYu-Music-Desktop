// 移植自移动端 lib/src/cloud/providers/thunder_provider.dart
// 迅雷云盘 provider（httpPassword：v3/login 账密接口，password 传 md5）。
//
// XCloud 架构（与 PikPak 同构）：files/share/restore 接口形状一致。

import {
  asArray,
  asInt,
  asRecord,
  asString,
  cloudGet,
  cloudPostJson,
  encodeQueryComponent,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import {
  CloudAccount,
  CloudDirectLink,
  CloudException,
  CloudFile,
  CloudListResult,
  CloudLoginField,
  CloudLoginKind,
  CloudShareParse,
} from '../cloudTypes';
import { parseUrlToProvider } from '../shareLinkParser';
import { HttpLoginGate, md5Hex, uuidV4 } from './httpLoginSupport';

const UA =
  'ANDROID-com.xunlei.downloadprovider/8.31.0.9726 netWorkType/5G ' +
  'appid/40 deviceName/Xiaomi_M2004j7ac deviceModel/M2004J7AC ' +
  'Oauth2Client/0.9';
const CLIENT_ID = 'Xq00jqW5m1PrHnV8';

function h(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Referer': 'https://pan.xunlei.com/',
    'Content-Type': 'application/json',
  };
  if (accessToken !== '') {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

/** XCloud 列目录 filters 参数（与 Dart jsonEncode 输出一致）。 */
const LIST_FILTERS = JSON.stringify({
  phase: { in: ['PHASE_TYPE_COMPLETE'] },
  trashed: { in: false },
});

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
    return CloudLoginKind.HttpPassword;
  }

  override get directLinkTtl(): number {
    return 30 * 60 * 1000;
  }

  override get loginFields(): CloudLoginField[] {
    return [
      new CloudLoginField({ key: 'username', label: '手机号 / 邮箱' }),
      new CloudLoginField({ key: 'password', label: '密码', obscure: true }),
    ];
  }

  // ── 登录 ──────────────────────────────────────────────

  override async loginWithFields(fields: Record<string, string>): Promise<CloudAccount> {
    const username = (fields['username'] ?? '').trim();
    const password = fields['password'] ?? '';
    if (username === '' || password === '') {
      throw new CloudException('请填写账号和密码');
    }
    HttpLoginGate.instance.ensureAllowed(this.id);
    HttpLoginGate.instance.recordAttempt(this.id);
    try {
      const deviceId = uuidV4();
      const resp = await cloudPostJson(
        'https://xluser-ssl.xunlei.com/xluser.core.login/v3/login',
        {
          body: {
            'client_id': CLIENT_ID,
            'action': 'login',
            'username': username,
            'password': await md5Hex(password),
            'deviceid': deviceId,
          },
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
        },
      );
      if (!resp.isOk) {
        HttpLoginGate.instance.recordFailure(this.id);
        throw new CloudException('登录失败');
      }
      const accessToken = asString(resp.json['access_token'] ?? '');
      const refreshToken = asString(resp.json['refresh_token'] ?? '');
      if (accessToken === '') {
        HttpLoginGate.instance.recordFailure(this.id);
        throw new CloudException(
          asString(resp.json['error_description'] ?? resp.json['error'] ?? '账号或密码错误'),
        );
      }
      const userId = asString(resp.json['sub'] ?? resp.json['user_id'] ?? '');
      HttpLoginGate.instance.recordSuccess(this.id);
      return new CloudAccount({
        provider: this.id,
        accountId: userId === '' ? (await md5Hex(username)).substring(0, 12) : userId,
        nickname: username,
        cred: {
          'accessToken': accessToken,
          'refreshToken': refreshToken,
          'userId': userId,
        },
        boundAt: new Date(),
      });
    } catch (e) {
      if (e instanceof CloudException) throw e;
      HttpLoginGate.instance.recordFailure(this.id);
      throw new CloudException('登录失败，请稍后再试');
    }
  }

  /** refresh 换新 access_token（best-effort；失败抛过期让用户重绑）。 */
  private async _refreshToken(cred: Record<string, string>): Promise<string | null> {
    const refreshToken = cred['refreshToken'];
    if (refreshToken == null || refreshToken === '') return null;
    try {
      const resp = await cloudPostJson(
        'https://xluser-ssl.xunlei.com/xluser.core.auth.token/v1/auth/token',
        {
          body: {
            'refresh_token': refreshToken,
            'client_id': CLIENT_ID,
            'grant_type': 'refresh_token',
          },
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
        },
      );
      if (!resp.isOk) return null;
      const at = asString(resp.json['access_token'] ?? '');
      return at === '' ? null : at;
    } catch {
      return null;
    }
  }

  /** 带一次静默 refresh 的鉴权头取值（401 时由调用方判断）。 */
  private async _auth(cred: Record<string, string>): Promise<string> {
    const cached = cred['accessToken'] ?? '';
    if (cached !== '') return cached;
    const fresh = await this._refreshToken(cred);
    if (fresh == null) throw new CloudException('登录已过期，请重新绑定');
    return fresh;
  }

  override async validate(cred: Record<string, string>): Promise<boolean> {
    try {
      const at = await this._auth(cred);
      const resp = await cloudGet('https://api-pan.xunlei.com/drive/v1/about', {
        headers: h(at),
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
    const at = await this._auth(cred);
    const resp = await cloudGet(
      'https://api-pan.xunlei.com/drive/v1/files' +
        `?parent_id=${encodeQueryComponent(path)}&limit=100` +
        `&page_token=${encodeQueryComponent(cursor ?? '')}` +
        `&filters=${encodeQueryComponent(LIST_FILTERS)}`,
      { headers: h(at) },
    );
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const files: CloudFile[] = [];
    for (const item of asArray(resp.json['files'])) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['id'] ?? ''),
          name: asString(e['name'] ?? ''),
          isDir: e['kind'] === 'drive#folder',
          size: asInt(e['size']) ?? 0,
          parentId: path,
        }),
      );
    }
    const next = asString(resp.json['next_page_token'] ?? '');
    return new CloudListResult({
      files,
      nextCursor: next === '' ? null : next,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const shareId = info?.shareId ?? url;
    const resp = await cloudGet(
      'https://api-pan.xunlei.com/drive/v1/share/detail' +
        `?share_id=${encodeQueryComponent(shareId)}` +
        `&pass_code=${encodeQueryComponent(pwd ?? '')}`,
      { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' } },
    );
    if (!resp.isOk) throw new CloudException('分享链接解析失败');
    // 迅雷该接口可能多包一层 {"share": {...}}，兼容两种形状。
    const data: Record<string, unknown> = asRecord(resp.json['share'])
      ? resp.json
      : { 'share': resp.json };
    const share = asRecord(data['share']) ?? {};
    const passCodeToken = asString(share['pass_code_token'] ?? '');
    if (passCodeToken === '' && (pwd ?? '') !== '') {
      throw new CloudException('提取码错误');
    }
    const list = asArray(resp.json['list'] ?? resp.json['files']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['file_id'] ?? e['id'] ?? ''),
          name: asString(e['name'] ?? ''),
          isDir: e['kind'] === 'drive#folder',
          size: asInt(e['size']) ?? 0,
        }),
      );
    }
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId,
      shareToken: passCodeToken,
      passcode: pwd,
      directPlayable: false,
    });
  }

  override async transferShareFiles(
    cred: Record<string, string>,
    share: CloudShareParse,
  ): Promise<CloudFile[]> {
    const at = await this._auth(cred);
    const token = share.shareToken;
    if (token == null || token === '') throw new CloudException('请先填写提取码');
    const resp = await cloudPostJson(
      'https://api-pan.xunlei.com/drive/v1/share/restore',
      {
        body: {
          'share_id': share.shareId,
          'pass_code_token': token,
          'file_list': share.files.map((f) => ({ 'file_id': f.id, 'name': f.name })),
        },
        headers: h(at),
      },
    );
    if (!resp.isOk) throw new CloudException('转存失败');
    // 转存后 id 变化：按文件名回查根目录。
    const listed = await this.listDir(cred, '');
    const byName = new Map(listed.files.map((f) => [f.name, f]));
    const out: CloudFile[] = [];
    for (const f of share.files) {
      const hit = byName.get(f.name);
      if (hit != null) out.push(hit);
    }
    if (out.length === 0) throw new CloudException('转存失败');
    return out;
  }

  // ── 直链 ──────────────────────────────────────────────

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const at = await this._auth(cred);
    const resp = await cloudGet(
      `https://api-pan.xunlei.com/drive/v1/files/${encodeQueryComponent(file.id)}`,
      { headers: h(at) },
    );
    if (!resp.isOk) throw new CloudException('直链获取失败');
    const url = asString(resp.json['web_content_link'] ?? '');
    if (url === '') {
      // 部分文件在 medias[].link.url 兜底。
      const medias = asArray(resp.json['medias']);
      for (const item of medias) {
        const m = asRecord(item);
        if (!m) continue;
        const alt = asString(asRecord(m['link'])?.['url'] ?? '');
        if (alt !== '') {
          return new CloudDirectLink({
            url: alt,
            headers: { 'User-Agent': UA, 'Referer': 'https://pan.xunlei.com/' },
            fileName: file.name,
            size: file.size,
            expireAt: new Date(Date.now() + 30 * 60 * 1000),
          });
        }
      }
      throw new CloudException('直链获取失败');
    }
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': UA, 'Referer': 'https://pan.xunlei.com/' },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  }
}
