// 移植自移动端 lib/src/cloud/providers/pan123_provider.dart
// 123 云盘 provider（qrCode 主通道 + 账密兜底；分享免转存直链
// directPlayable=true）。
//
// DownloadUrl 字段实测可能是 JSON 串（{url:...}）或纯 URL，统一防御解析。

import {
  asArray,
  asInt,
  asRecord,
  asString,
  cloudGet,
  cloudPostJson,
  encodeQueryComponent,
  parseIntOr,
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
  CloudQrLoginSession,
  CloudShareParse,
} from '../cloudTypes';
import { parseUrlToProvider } from '../shareLinkParser';
import { HttpLoginGate, md5Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class Pan123Provider extends CloudProvider {
  private _h(token: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Referer': 'https://www.123pan.com/',
      'Platform': 'web',
    };
    if (token !== '') headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  override get id(): string {
    return 'pan123';
  }

  override get displayName(): string {
    return '123云盘';
  }

  override get rootPath(): string {
    return '0';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.QrCode;
  }

  override get directLinkTtl(): number {
    return 60 * 60 * 1000;
  }

  override get loginFields(): CloudLoginField[] {
    return [
      new CloudLoginField({ key: 'passport', label: '手机号 / 邮箱' }),
      new CloudLoginField({ key: 'password', label: '密码', obscure: true }),
    ];
  }

  // ── 登录 ──────────────────────────────────────────────

  override async createQrLogin(): Promise<CloudQrLoginSession> {
    const resp = await cloudGet('https://login.123pan.com/api/user/qr-code/generate', {
      headers: { 'User-Agent': UA },
    });
    if (!resp.isOk) throw new CloudException('二维码获取失败');
    const data = asRecord(resp.json['data']);
    if (!data) throw new CloudException('二维码获取失败');
    const qr = asString(data['qr'] ?? '');
    const uniId = asString(data['uniID'] ?? '');
    if (qr === '' || uniId === '') throw new CloudException('二维码获取失败');
    return new CloudQrLoginSession({ qrContent: qr, state: uniId });
  }

  override async pollQrLogin(session: CloudQrLoginSession): Promise<CloudAccount | null> {
    const resp = await cloudGet(
      'https://login.123pan.com/api/user/qr-code/result' +
        '?uniID=' +
        encodeQueryComponent(session.state),
      { headers: { 'User-Agent': UA } },
    );
    if (!resp.isOk) return null;
    const data = asRecord(resp.json['data']);
    if (!data) return null;
    const status = asInt(data['status']) ?? 0;
    if (status !== 2) return null; // 未确认。
    const token = asString(data['token'] ?? data['accessToken'] ?? '');
    if (token === '') throw new CloudException('二维码已过期，请刷新');
    const user = asRecord(data['user']);
    const uid = asString(user?.['id'] ?? '');
    const nick = asString(user?.['nickname'] ?? user?.['Passport'] ?? '');
    return new CloudAccount({
      provider: this.id,
      accountId: uid === '' ? (await md5Hex(token)).substring(0, 12) : uid,
      nickname: nick === '' ? '123云盘' : nick,
      cred: { 'token': token },
      boundAt: new Date(),
    });
  }

  override async loginWithFields(fields: Record<string, string>): Promise<CloudAccount> {
    const passport = (fields['passport'] ?? '').trim();
    const password = fields['password'] ?? '';
    if (passport === '' || password === '') {
      throw new CloudException('请填写账号和密码');
    }
    HttpLoginGate.instance.ensureAllowed(this.id);
    HttpLoginGate.instance.recordAttempt(this.id);
    try {
      const resp = await cloudPostJson('https://user.123pan.cn/api/user/sign_in', {
        body: {
          'passport': passport,
          'password': password,
          'remember': true,
        },
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      });
      const code = asInt(resp.json['code']) ?? -1;
      if (code !== 200) {
        HttpLoginGate.instance.recordFailure(this.id);
        throw new CloudException(asString(resp.json['message'] ?? '账号或密码错误'));
      }
      const token = asString(asRecord(resp.json['data'])?.['token'] ?? '');
      if (token === '') {
        HttpLoginGate.instance.recordFailure(this.id);
        throw new CloudException('登录失败');
      }
      HttpLoginGate.instance.recordSuccess(this.id);
      return new CloudAccount({
        provider: this.id,
        accountId: (await md5Hex(token)).substring(0, 12),
        nickname: passport,
        cred: { 'token': token },
        boundAt: new Date(),
      });
    } catch (e) {
      if (e instanceof CloudException) throw e;
      HttpLoginGate.instance.recordFailure(this.id);
      throw new CloudException('登录失败，请稍后再试');
    }
  }

  override async validate(cred: Record<string, string>): Promise<boolean> {
    const token = cred['token'] ?? '';
    for (const host of ['https://www.123pan.com', 'https://123pan.com']) {
      try {
        const resp = await cloudGet(`${host}/b/api/user/info`, { headers: this._h(token) });
        if (resp.isOk && (asInt(resp.json['code']) ?? -1) === 200) {
          return true;
        }
      } catch {
        // 尝试下一个域。
      }
    }
    return false;
  }

  // ── 目录 ──────────────────────────────────────────────

  override async listDir(
    cred: Record<string, string>,
    path: string,
    cursor?: string | null,
  ): Promise<CloudListResult> {
    const page = parseIntOr(cursor, 1);
    const resp = await cloudGet(
      'https://www.123pan.com/b/api/file/list/new' +
        '?parentFileId=' +
        encodeQueryComponent(path) +
        '&page=' +
        page +
        '&limit=100&orderBy=file_id&orderDirection=asc' +
        '&trashed=false&OnlyAbnormal=false&SearchData=false',
      { headers: this._h(cred['token'] ?? '') },
    );
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const data = asRecord(resp.json['data']);
    const list = asArray(data?.['InfoList']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['fileId'] ?? ''),
          name: asString(e['filename'] ?? ''),
          isDir: asInt(e['type']) === 1,
          size: asInt(e['size']) ?? 0,
          parentId: asString(e['parentFileId'] ?? path),
        }),
      );
    }
    const hasNext = files.length >= 100;
    return new CloudListResult({
      files,
      nextCursor: hasNext ? `${page + 1}` : null,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const shareKey = info?.shareId ?? url;
    const resp = await cloudGet(
      'https://www.123pan.com/b/api/share/get' +
        '?shareKey=' +
        encodeQueryComponent(shareKey) +
        '&PassCode=' +
        encodeQueryComponent(pwd ?? '') +
        '&orderBy=file_id&orderDirection=asc',
      { headers: { 'User-Agent': UA } },
    );
    if (!resp.isOk) throw new CloudException('分享链接解析失败');
    const code = asInt(resp.json['code']) ?? -1;
    if (code !== 0) {
      throw new CloudException(
        asString(resp.json['message'] ?? (pwd != null && pwd !== '' ? '提取码错误' : '分享已失效')),
      );
    }
    const data = asRecord(resp.json['data']);
    const list = asArray(data?.['InfoList']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['FileId'] ?? e['fileId'] ?? ''),
          name: asString(e['FileName'] ?? e['filename'] ?? ''),
          isDir: asInt(e['Type']) === 1,
          size: asInt(e['Size']) ?? 0,
        }),
      );
    }
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId: shareKey,
      // 123 分享直链需复用提取码，shareToken 暂存 pwd。
      shareToken: pwd,
      passcode: pwd,
      directPlayable: true,
    });
  }

  /** 分享免转存直链（download/info 批量接口取单个文件）。 */
  override async getShareDirectLink(
    _cred: Record<string, string> | null,
    share: CloudShareParse,
    file: CloudFile,
  ): Promise<CloudDirectLink> {
    const pwd = share.passcode ?? share.shareToken ?? '';
    const resp = await cloudGet(
      'https://www.123pan.com/b/api/share/download/info' +
        '?shareKey=' +
        encodeQueryComponent(share.shareId ?? '') +
        '&PassCode=' +
        encodeQueryComponent(pwd) +
        '&fileIds=' +
        encodeQueryComponent(JSON.stringify([{ 'FileId': file.id }])),
      { headers: { 'User-Agent': UA } },
    );
    if (!resp.isOk) throw new CloudException('分享直链获取失败');
    const code = asInt(resp.json['code']) ?? -1;
    if (code !== 0) throw new CloudException('分享直链获取失败');
    const url = this._extractDownloadUrl(resp.json['data']);
    if (url === '') throw new CloudException('分享直链获取失败');
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': UA },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }

  // directPlayable=true，不支持转存。
  override async transferShareFiles(
    _cred: Record<string, string>,
    _share: CloudShareParse,
  ): Promise<CloudFile[]> {
    throw new Error('该盘分享不支持转存');
  }

  // ── 直链 ──────────────────────────────────────────────

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const resp = await cloudGet(
      'https://www.123pan.com/b/api/file/download_info' +
        '?driveId=0&fileId=' +
        encodeQueryComponent(file.id) +
        '&Referer=',
      { headers: this._h(cred['token'] ?? '') },
    );
    if (!resp.isOk) throw new CloudException('直链获取失败');
    const code = asInt(resp.json['code']) ?? -1;
    if (code !== 0) throw new CloudException('直链获取失败');
    const url = this._extractDownloadUrl(resp.json['data']);
    if (url === '') throw new CloudException('直链获取失败');
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': UA },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }

  /** DownloadUrl 可能是纯 URL、JSON 串或嵌套 data，统一防御解析。 */
  private _extractDownloadUrl(data: unknown): string {
    if (typeof data === 'string') {
      if (data.startsWith('http')) return data;
      try {
        return this._extractDownloadUrl(JSON.parse(data));
      } catch {
        return '';
      }
    }
    const rec = asRecord(data);
    if (rec) {
      for (const key of ['DownloadUrl', 'downloadUrl', 'download_url']) {
        const v = rec[key];
        if (typeof v === 'string' && v.startsWith('http')) return v;
        if (typeof v === 'string' && v !== '') {
          const inner = this._extractDownloadUrl(v);
          if (inner !== '') return inner;
        }
      }
      const backup = rec['backup_download_url'] ?? rec['BackupDownloadUrl'];
      if (typeof backup === 'string' && backup.startsWith('http')) {
        return backup;
      }
    }
    return '';
  }
}
