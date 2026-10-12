// 移植自移动端 lib/src/cloud/providers/ecloud189_provider.dart
// 天翼云盘（189）provider（smsPassword：账密 + 短信二次验证）。
//
// logbox RSA 加密登录链留在 TS；业务（列目录/分享/转存/直链）经
// cloudRemote 桥转发内嵌 Rust（src-tauri/src/cloud/ecloud189.rs）。
// portal loginUrl.action 换会话是 302 跳转链，桌面端代理 follow=0 时
// 逐跳采 Cookie 的 GET 循环自实现（同移动端 appRequest 逐跳语义）。

import { pluginApi } from '../../tauri/pluginApi';
import {
  asInt,
  asRecord,
  asString,
  cloudGet,
  cloudPostForm,
  cookieHeader,
  getHeader,
  splitSetCookieValues,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustTransferShare, rustValidate } from '../cloudRemote';
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
