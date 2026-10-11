// 移植自移动端 lib/src/cloud/providers/ecloud189_provider.dart
// 天翼云盘（189）provider（smsPassword：账密 + 短信二次验证）。
//
// logbox RSA 加密登录链；响应要求二次验证时自动发短信并暂存会话，
// 带验证码重登走 submitForSecondAuth → portal 换会话。portal
// loginUrl.action 换会话是 302 跳转链，桌面端代理 follow=0 时逐跳
// 采 Cookie 的 GET 循环自实现（同移动端 appRequest 逐跳语义）。

import { pluginApi } from '../../tauri/pluginApi';
import {
  asArray,
  asInt,
  asRecord,
  asString,
  cloudGet,
  cloudPostForm,
  cookieHeader,
  delay,
  encodeQueryComponent,
  getHeader,
  parseIntOr,
  resolveFinalUrl,
  splitSetCookieValues,
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
import { HttpLoginGate, rsaPkcs1Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 登录响应要求二次验证的内部信号。 */
class NeedSmsException extends Error {}

class SmsSession {
  readonly cookies: Record<string, string>;
  readonly ssKey: string;

  constructor(cookies: Record<string, string>, ssKey: string) {
    this.cookies = cookies;
    this.ssKey = ssKey;
  }
}

export class Ecloud189Provider extends CloudProvider {
  /** 二次验证暂存：username → 会话（cookies + ssKey）。 */
  private static readonly _pendingSms = new Map<string, SmsSession>();

  override get id(): string {
    return 'ecloud189';
  }

  override get displayName(): string {
    return '天翼云盘';
  }

  override get rootPath(): string {
    return '-11';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.SmsPassword;
  }

  override get loginFields(): CloudLoginField[] {
    return [
      new CloudLoginField({ key: 'username', label: '手机号', isPhone: true }),
      new CloudLoginField({ key: 'password', label: '密码', obscure: true }),
      new CloudLoginField({ key: 'smsCode', label: '短信验证码', isSmsCode: true }),
    ];
  }

  private _h(cookie: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Referer': 'https://cloud.189.cn/',
    };
    if (cookie !== '') headers['Cookie'] = cookie;
    return headers;
  }

  // ── 登录 ──────────────────────────────────────────────

  override async loginWithFields(fields: Record<string, string>): Promise<CloudAccount> {
    const username = (fields['username'] ?? '').trim();
    const password = fields['password'] ?? '';
    const smsCode = (fields['smsCode'] ?? '').trim();
    if (username === '' || password === '') {
      throw new CloudException('请填写手机号和密码');
    }
    // 带验证码的第二次尝试：走二次验证通道。
    const pending = Ecloud189Provider._pendingSms.get(username);
    if (pending) {
      if (smsCode === '') {
        throw new CloudException('请填写短信验证码');
      }
      return this._submitSmsSecondAuth(pending, smsCode);
    }
    HttpLoginGate.instance.ensureAllowed(this.id);
    HttpLoginGate.instance.recordAttempt(this.id);
    try {
      const account = await this._passwordLogin(username, password);
      HttpLoginGate.instance.recordSuccess(this.id);
      return account;
    } catch (e) {
      if (e instanceof NeedSmsException) {
        // 自动发短信验证码，等待用户填码重试（不计入失败退避）。
        throw new CloudException('短信验证码已发送，请填写后重试');
      }
      if (e instanceof CloudException) {
        HttpLoginGate.instance.recordFailure(this.id);
        throw e;
      }
      HttpLoginGate.instance.recordFailure(this.id);
      throw new CloudException('账号或密码错误');
    }
  }

  private async _passwordLogin(username: string, password: string): Promise<CloudAccount> {
    // 1. 取 RSA 公钥参数。
    const confResp = await cloudGet('https://open.e.189.cn/api/logbox/config/encryptConf.do', {
      headers: { 'User-Agent': UA },
    });
    if (!confResp.isOk) throw new CloudException('登录服务不可用');
    const conf = asRecord(confResp.json['data']);
    if (!conf) throw new CloudException('登录服务不可用');
    const pubKey = asString(conf['pubKey'] ?? '');
    const pre = asString(conf['pre'] ?? '');
    if (pubKey === '') throw new CloudException('登录服务不可用');
    // 2. RSA 加密账密提交。
    const jar: Record<string, string> = { ...confResp.setCookiePairs };
    const loginResp = await cloudPostForm(
      'https://open.e.189.cn/api/logbox/oauth2/loginSubmit.do',
      {
        'version': '2.0',
        'appKey': 'cloud',
        'accountType': '01',
        'userName': rsaPkcs1Hex(pre + username, pubKey, '10001'),
        'password': rsaPkcs1Hex(pre + password, pubKey, '10001'),
        'paramId': '',
        'returnUrl': '',
        'mailSuffix': '@189.cn',
      },
      {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://open.e.189.cn/',
          'Cookie': cookieHeader(jar),
        },
      },
    );
    this._mergeSetCookies(jar, loginResp);
    if (!loginResp.isOk) throw new CloudException('登录失败');
    const body = loginResp.json;
    const result = asInt(body['result']) ?? -1;
    // 需要短信二次验证：自动发码并暂存会话。
    const ssKey = asString(asRecord(body['data'])?.['setToken']);
    if (result === 1001 || result === 1002) {
      const session = new SmsSession(jar, ssKey);
      Ecloud189Provider._pendingSms.set(username, session);
      await this._sendSms(session);
      throw new NeedSmsException();
    }
    if (result !== 0) {
      throw new CloudException(asString(body['msg'] ?? '账号或密码错误'));
    }
    // 3. 换 PC 会话（302 跳转链，逐跳采 Cookie）。
    const returnUrl = asString(body['toUrl'] ?? '');
    const cookie = await this._exchangePortalSession(jar, returnUrl);
    const userId = asString(body['userId'] ?? username);
    return new CloudAccount({
      provider: this.id,
      accountId: userId,
      nickname: username,
      cred: { 'cookie': cookie },
      boundAt: new Date(),
    });
  }

  private async _sendSms(session: SmsSession): Promise<void> {
    await cloudPostForm(
      'https://open.e.189.cn/api/logbox/oauth2/sendSmsCodeForSecondAuth.do',
      { 'ssKey': session.ssKey },
      {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://open.e.189.cn/',
          'Cookie': cookieHeader(session.cookies),
        },
      },
    );
  }

  private async _submitSmsSecondAuth(session: SmsSession, smsCode: string): Promise<CloudAccount> {
    const resp = await cloudPostForm(
      'https://open.e.189.cn/api/logbox/oauth2/submitForSecondAuth.do',
      { 'ssKey': session.ssKey, 'smsCode': smsCode },
      {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://open.e.189.cn/',
          'Cookie': cookieHeader(session.cookies),
        },
      },
    );
    if (!resp.isOk) throw new CloudException('验证码校验失败');
    const body = resp.json;
    const result = asInt(body['result']) ?? -1;
    if (result !== 0) {
      throw new CloudException(asString(body['msg'] ?? '验证码错误'));
    }
    this._mergeSetCookies(session.cookies, resp);
    const returnUrl = asString(body['toUrl'] ?? '');
    const cookie = await this._exchangePortalSession(session.cookies, returnUrl);
    return new CloudAccount({
      provider: this.id,
      accountId: '189',
      nickname: '天翼账号',
      cred: { 'cookie': cookie },
      boundAt: new Date(),
    });
  }

  /** portal 会话交换：302 跳转链上每跳都可能下发新 Cookie，
   * 代理手动重定向只暴露最终跳的响应头，这里 follow=0 逐跳采。 */
  private async _exchangePortalSession(jar: Record<string, string>, returnUrl: string): Promise<string> {
    if (returnUrl === '') return cookieHeader(jar);
    let url = returnUrl;
    for (let hop = 0; hop < 8; hop++) {
      const headers: Record<string, string> = {
        'User-Agent': UA,
        'Referer': 'https://cloud.189.cn/',
      };
      const cookieStr = cookieHeader(jar);
      if (cookieStr !== '') headers['Cookie'] = cookieStr;
      const resp = await pluginApi.pluginHttpRequest('GET', url, headers, '', 15000, 0);
      for (const [name, value] of Object.entries(resp.headers ?? {})) {
        if (name.toLowerCase() !== 'set-cookie') continue;
        for (const raw of splitSetCookieValues(String(value))) {
          const head = raw.split(';')[0] ?? '';
          const eq = head.indexOf('=');
          if (eq <= 0) continue;
          jar[head.slice(0, eq).trim()] = head.slice(eq + 1).trim();
        }
      }
      const loc = getHeader(resp.headers ?? {}, 'location');
      if (loc == null || loc === '') break;
      url = new URL(loc, url).toString();
    }
    return cookieHeader(jar);
  }

  private _mergeSetCookies(jar: Record<string, string>, resp: { setCookiePairs: Record<string, string> }): void {
    Object.assign(jar, resp.setCookiePairs);
  }

  override async validate(cred: Record<string, string>): Promise<boolean> {
    try {
      const resp = await cloudGet(
        'https://cloud.189.cn/api/open/file/listFiles.action?folderId=-11&pageNum=1&pageSize=1',
        { headers: this._h(cred['cookie'] ?? '') },
      );
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
    const page = parseIntOr(cursor, 1);
    const resp = await cloudGet(
      'https://cloud.189.cn/api/open/file/listFiles.action' +
        '?folderId=' +
        encodeQueryComponent(path) +
        '&pageNum=' +
        page +
        '&pageSize=60',
      { headers: this._h(cred['cookie'] ?? '') },
    );
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const data = asRecord(resp.json['data']);
    const ao = data ? asRecord(data['fileListAO']) : null;
    const list = asArray(ao?.['fileList']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['id'] ?? ''),
          name: asString(e['name'] ?? ''),
          isDir: e['dir'] === true || e['isdir'] === true,
          size: asInt(e['size']) ?? 0,
          parentId: path,
        }),
      );
    }
    const hasNext = files.length >= 60;
    return new CloudListResult({
      files,
      nextCursor: hasNext ? `${page + 1}` : null,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const shareCode = info?.shareId ?? url;
    const headers = { 'User-Agent': UA };
    const infoResp = await cloudGet(
      'https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action' +
        '?shareCode=' +
        encodeQueryComponent(shareCode),
      { headers },
    );
    if (!infoResp.isOk) throw new CloudException('分享链接解析失败');
    const data = asRecord(infoResp.json['data']);
    if (!data) throw new CloudException('分享已失效');
    const shareId = asString(data['shareId'] ?? '');
    const fileId = asString(data['fileId'] ?? '-1');
    const isDir = data['isDir'] === true || data['isDir'] === 1;
    // 有提取码：checkAccessCode 校验。
    if (pwd != null && pwd !== '') {
      const chk = await cloudPostForm(
        'https://cloud.189.cn/api/open/share/checkAccessCode.action',
        {
          'shareCode': shareCode,
          'accessCode': pwd,
        },
        { headers },
      );
      if (!chk.isOk) throw new CloudException('提取码错误');
    }
    let files: CloudFile[] = [];
    if (!isDir) {
      files = [
        new CloudFile({
          id: fileId,
          name: asString(data['fileName'] ?? ''),
          size: asInt(data['fileSize']) ?? 0,
        }),
      ];
    } else {
      const listResp = await cloudGet(
        'https://cloud.189.cn/api/open/share/listShareDir.action' +
          '?shareId=' +
          encodeQueryComponent(shareId) +
          '&fileId=' +
          encodeQueryComponent(fileId) +
          '&pageNum=1&pageSize=60',
        { headers },
      );
      if (!listResp.isOk) throw new CloudException('分享文件列表获取失败');
      const ldata = asRecord(listResp.json['data']);
      const entries = asArray(ldata?.['fileShareResponseInfos']);
      for (const item of entries) {
        const e = asRecord(item);
        if (!e) continue;
        files.push(
          new CloudFile({
            id: asString(e['fileId'] ?? ''),
            name: asString(e['fileName'] ?? ''),
            isDir: e['isDir'] === true || e['isDir'] === 1,
            size: asInt(e['fileSize']) ?? 0,
          }),
        );
      }
    }
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId,
      passcode: pwd,
      directPlayable: false,
    });
  }

  override async transferShareFiles(
    cred: Record<string, string>,
    share: CloudShareParse,
  ): Promise<CloudFile[]> {
    const headers = {
      'User-Agent': UA,
      'Cookie': cred['cookie'] ?? '',
    };
    const resp = await cloudPostForm(
      'https://cloud.189.cn/api/open/share/createBatchTask.action',
      {
        'type': 'SHARE_SAVE',
        'taskInfos': JSON.stringify(
          share.files.map((f) => ({
            'fileId': f.id,
            'fileName': f.name,
            'isDir': f.isDir,
            'shareId': share.shareId,
          })),
        ),
        'targetFolderId': '-11',
      },
      { headers },
    );
    if (!resp.isOk) throw new CloudException('转存失败');
    const taskId = asString(asRecord(resp.json['data'])?.['taskId'] ?? '');
    if (taskId === '') throw new CloudException('转存失败');
    for (let i = 0; i < 20; i++) {
      await delay(800);
      const tResp = await cloudGet(
        'https://cloud.189.cn/api/open/batch/checkBatchTask.action?taskId=' +
          encodeQueryComponent(taskId),
        { headers },
      );
      if (!tResp.isOk) continue;
      const state = asString(asRecord(tResp.json['data'])?.['taskStatus']);
      if (state === '2') {
        return share.files;
      }
    }
    throw new CloudException('转存失败');
  }

  // ── 直链 ──────────────────────────────────────────────

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const resp = await cloudGet(
      'https://cloud.189.cn/api/open/file/getFileDownloadUrl.action' +
        '?fileId=' +
        encodeQueryComponent(file.id),
      { headers: this._h(cred['cookie'] ?? '') },
    );
    if (!resp.isOk) throw new CloudException('直链获取失败');
    const url = asString(asRecord(resp.json['data'])?.['fileDownloadUrl'] ?? '');
    if (url === '') throw new CloudException('直链获取失败');
    const finalUrl = await resolveFinalUrl(url, { 'User-Agent': UA });
    return new CloudDirectLink({
      url: finalUrl,
      headers: { 'User-Agent': UA },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  }
}
