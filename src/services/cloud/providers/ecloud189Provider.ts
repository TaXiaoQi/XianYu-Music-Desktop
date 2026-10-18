// 移植自移动端 lib/src/cloud/providers/ecloud189_provider.dart
// 天翼云盘（189）provider（smsPassword：账密 + 设备短信二次校验）。
//
// 现役登录链（2026-10 实测，对齐 web 前端 v5.0）留在 TS：
//   1. GET cloud.189.cn/api/portal/loginUrl.action —— 302 跳链逐跳采
//      Cookie，落点 open.e.189.cn 登录页 URL 携带 lt / reqId / appId；
//   2. POST appConf.do（version 2.0 + appKey）→ pageKey/paramId/returnUrl
//      等页面参数（initData）；
//   3. POST encryptConf.do（appId）→ pre 前缀 + pubKey（base64 SPKI）；
//   4. POST loginSubmit.do —— 账密 RSA-PKCS1（hex）+ pre 前缀，密码字段
//      名为 epd，returnUrl 需 encodeURIComponent；result 0 直接过，
//      result -133「设备ID不存在」为新客户端强制设备短信二次校验：
//      用响应里的加密 mobile 调 sendSmsCodeForSecondAuth.do 发码，用户
//      填码后 submitForSecondAuth.do（验证码放 epd 字段）→ toUrl 换会话。
// 老协议（paramId 空 + password 字段 + ssKey）已全面失效（-20099/-149）。
// 业务（列目录/分享/转存/直链）经 cloudRemote 桥转发内嵌 Rust
// （src-tauri/src/cloud/ecloud189.rs）。

import { pluginApi } from '../../tauri/pluginApi';
import {
  asInt,
  asRecord,
  asString,
  cloudPostForm,
  cookieHeader,
  getHeader,
  splitSetCookieValues,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustSearchFiles, rustTransferShare, rustValidate } from '../cloudRemote';
import {
  CloudAccount,
  CloudDirectLink,
  CloudException,
  CloudFile,
  CloudListResult,
  CloudLoginField,
  CloudLoginKind,
  CloudShareParse,
  CloudSmsRequiredException,
} from '../cloudTypes';
import { HttpLoginGate, parseSpki, rsaPkcs1Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** loginUrl.action 跳链落点：cookie jar + 会话参数。 */
interface LoginEntry {
  cookies: Record<string, string>;
  loginUrl: string;
  lt: string;
  reqId: string;
  appId: string;
}

/** appConf.do 页面参数（initData，登录全程复用）。 */
interface AppConf {
  appKey: string;
  pageKey: string;
  accountType: string;
  returnUrl: string;
  mailSuffix: string;
  clientType: string;
  isOauth2: string;
  state: string;
  paramId: string;
}

/** 设备二次校验暂存会话。 */
interface SmsSession {
  cookies: Record<string, string>;
  loginUrl: string;
  lt: string;
  reqId: string;
  mobileEnc: string;
  conf: AppConf;
  pre: string;
  modHex: string;
  expHex: string;
  username: string;
}

function readConf(d: Record<string, unknown>): AppConf {
  return {
    appKey: asString(d['appKey'] ?? ''),
    pageKey: asString(d['pageKey'] ?? ''),
    accountType: asString(d['accountType'] ?? '01'),
    returnUrl: asString(d['returnUrl'] ?? ''),
    mailSuffix: asString(d['mailSuffix'] ?? '@189.cn'),
    clientType: asString(d['clientType'] ?? 100),
    isOauth2: asString(d['isOauth2'] ?? true).toLowerCase(),
    state: asString(d['state'] ?? ''),
    paramId: asString(d['paramId'] ?? ''),
  };
}

export class Ecloud189Provider extends CloudProvider {
  /** 设备二次校验暂存：username → 会话。 */
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
    ];
  }

  // ── 登录 ──────────────────────────────────────────────

  override async loginWithFields(fields: Record<string, string>): Promise<CloudAccount> {
    const username = (fields['username'] ?? '').trim();
    const password = fields['password'] ?? '';
    if (username === '' || password === '') {
      throw new CloudException('请填写手机号和密码');
    }
    HttpLoginGate.instance.ensureAllowed(this.id);
    HttpLoginGate.instance.recordAttempt(this.id);
    try {
      const account = await this._passwordLogin(username, password);
      HttpLoginGate.instance.recordSuccess(this.id);
      return account;
    } catch (e) {
      if (e instanceof CloudSmsRequiredException) {
        // 已自动发码并暂存会话；UI 弹窗收码后走 submitSmsCode。
        throw e;
      }
      if (e instanceof CloudException) {
        HttpLoginGate.instance.recordFailure(this.id);
        throw e;
      }
      HttpLoginGate.instance.recordFailure(this.id);
      throw new CloudException('账号或密码错误');
    }
  }

  /** 提交设备二次校验验证码（UI 收到 [CloudSmsRequiredException] 后调用）。 */
  override async submitSmsCode(username: string, smsCode: string): Promise<CloudAccount> {
    const pending = Ecloud189Provider._pendingSms.get(username);
    if (!pending) {
      throw new CloudException('登录会话已失效，请重新登录');
    }
    try {
      const account = await this._submitDeviceAuth(pending, smsCode);
      HttpLoginGate.instance.recordSuccess(this.id);
      return account;
    } catch (e) {
      if (e instanceof CloudException) {
        HttpLoginGate.instance.recordFailure(this.id);
      }
      throw e;
    }
  }

  /** 重发设备校验验证码（UI 弹窗「发送验证码」按钮调用）。 */
  override async resendDeviceSms(username: string): Promise<void> {
    const pending = Ecloud189Provider._pendingSms.get(username);
    if (!pending) {
      throw new CloudException('登录会话已失效，请重新登录');
    }
    await this._sendDeviceSms(pending);
  }

  private _sessionHeaders(s: { loginUrl: string; lt: string; reqId: string }): Record<string, string> {
    return {
      'User-Agent': UA,
      'lt': s.lt,
      'reqid': s.reqId,
      'Referer': s.loginUrl,
      'Origin': 'https://open.e.189.cn',
    };
  }

  /** 现役账密登录全链；要求设备短信二次校验时发码并暂存会话。 */
  private async _passwordLogin(username: string, password: string): Promise<CloudAccount> {
    // 1. loginUrl.action：302 跳链逐跳采 Cookie，落点取 lt/reqId/appId。
    const entry = await this._openLoginPage();
    const jar = entry.cookies;
    const hdr = this._sessionHeaders(entry);
    // 2. appConf → 页面参数（initData）。
    const confResp = await cloudPostForm(
      'https://open.e.189.cn/api/logbox/oauth2/appConf.do',
      { 'version': '2.0', 'appKey': entry.appId },
      { headers: { ...hdr, 'Cookie': cookieHeader(jar) } },
    );
    if (!confResp.isOk) throw new CloudException('登录服务不可用');
    const confData = asRecord(confResp.json['data']);
    if (!confData) throw new CloudException('登录服务不可用');
    const conf = readConf(confData);
    this._mergeSetCookies(jar, confResp);
    // 3. encryptConf → pre 前缀 + pubKey（base64 SPKI）。
    const ecResp = await cloudPostForm(
      'https://open.e.189.cn/api/logbox/config/encryptConf.do',
      { 'appId': entry.appId },
      { headers: { ...hdr, 'Cookie': cookieHeader(jar) } },
    );
    if (!ecResp.isOk) throw new CloudException('登录服务不可用');
    const ecd = asRecord(ecResp.json['data']);
    const pre = asString(ecd?.['pre'] ?? '{RSA}');
    const pubKey = asString(ecd?.['pubKey'] ?? '');
    if (pubKey === '') throw new CloudException('登录服务不可用');
    this._mergeSetCookies(jar, ecResp);
    const [modHex, expHex] = parseSpki(pubKey);
    // 4. loginSubmit（现役字段：密码字段名 epd，RSA hex，returnUrl 编码）。
    const resp = await cloudPostForm(
      'https://open.e.189.cn/api/logbox/oauth2/loginSubmit.do',
      {
        'version': 'v2.0',
        'apToken': '',
        'appKey': conf.appKey !== '' ? conf.appKey : entry.appId,
        'pageKey': conf.pageKey,
        'accountType': conf.accountType,
        'userName': pre + rsaPkcs1Hex(username, modHex, expHex),
        'epd': pre + rsaPkcs1Hex(password, modHex, expHex),
        'captchaType': '',
        'validateCode': '',
        'smsValidateCode': '',
        'captchaToken': '',
        'returnUrl': encodeURIComponent(conf.returnUrl),
        'mailSuffix': conf.mailSuffix,
        'dynamicCheck': 'FALSE',
        'clientType': conf.clientType,
        'cb_SaveName': '3',
        'isOauth2': conf.isOauth2,
        'state': conf.state,
        'paramId': conf.paramId,
      },
      { headers: { ...hdr, 'Cookie': cookieHeader(jar) } },
    );
    this._mergeSetCookies(jar, resp);
    if (!resp.isOk) throw new CloudException('登录失败');
    const body = resp.json;
    const result = asInt(body['result']) ?? -1;
    const toUrl = asString(body['toUrl'] ?? '');
    // 新客户端强制设备短信二次校验：暂存会话，发码由 UI 手动触发。
    if (result === -133) {
      const mobileEnc = asString(body['mobile'] ?? '');
      if (mobileEnc === '') {
        throw new CloudException(asString(body['msg'] ?? '需要设备验证'));
      }
      const session: SmsSession = {
        cookies: jar,
        loginUrl: entry.loginUrl,
        lt: entry.lt,
        reqId: entry.reqId,
        mobileEnc,
        conf,
        pre,
        modHex,
        expHex,
        username,
      };
      Ecloud189Provider._pendingSms.set(username, session);
      // 不自动发码：由 UI 弹窗内的「发送验证码」按钮手动触发 resendDeviceSms。
      throw new CloudSmsRequiredException(username);
    }
    if (result !== 0) {
      throw new CloudException(asString(body['msg'] ?? '账号或密码错误'));
    }
    // 5. toUrl 换 PC 会话（302 跳转链，逐跳采 Cookie）。
    const cookie = await this._exchangePortalSession(jar, toUrl);
    const userId = asString(body['userId'] ?? username);
    return new CloudAccount({
      provider: this.id,
      accountId: userId,
      nickname: username,
      cred: { 'cookie': cookie },
      boundAt: new Date(),
    });
  }

  /** loginUrl.action 跳链：逐跳 GET 采 Cookie，落点 URL 带 lt/reqId/appId。 */
  private async _openLoginPage(): Promise<LoginEntry> {
    let url =
      'https://cloud.189.cn/api/portal/loginUrl.action' +
      '?redirectURL=https%3A%2F%2Fcloud.189.cn%2Fmain.action';
    const jar: Record<string, string> = {};
    let last = url;
    for (let hop = 0; hop < 8; hop++) {
      last = url;
      const loc = await this._hopGet(url, jar, 'https://cloud.189.cn/');
      if (loc == null || loc === '') break;
      url = new URL(loc, url).toString();
    }
    const u = new URL(last);
    const lt = u.searchParams.get('lt') ?? '';
    const reqId = u.searchParams.get('reqId') ?? '';
    const appId = u.searchParams.get('appId') ?? '';
    if (lt === '' || reqId === '') {
      throw new CloudException('登录服务不可用');
    }
    return { cookies: jar, loginUrl: last, lt, reqId, appId };
  }

  /** 逐跳 GET：只采 Set-Cookie 与 Location，不跟随（follow=0）。 */
  private async _hopGet(url: string, jar: Record<string, string>, referer: string): Promise<string | null> {
    const headers: Record<string, string> = { 'User-Agent': UA, 'Referer': referer };
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
    return getHeader(resp.headers ?? {}, 'location');
  }

  /** 设备二次校验发码：mobile 用登录响应返回的加密串。 */
  private async _sendDeviceSms(s: SmsSession): Promise<void> {
    const resp = await cloudPostForm(
      'https://open.e.189.cn/api/logbox/oauth2/sendSmsCodeForSecondAuth.do',
      { 'mobile': s.mobileEnc, 'appKey': s.conf.appKey },
      { headers: { ...this._sessionHeaders(s), 'Cookie': cookieHeader(s.cookies) } },
    );
    if (!resp.isOk) throw new CloudException('验证码发送失败');
    const result = asInt(resp.json['result']) ?? -1;
    if (result !== 0) {
      throw new CloudException(asString(resp.json['msg'] ?? '验证码发送失败'));
    }
  }

  /** 设备二次校验提交：验证码放 epd（RSA hex + pre 前缀）。 */
  private async _submitDeviceAuth(s: SmsSession, smsCode: string): Promise<CloudAccount> {
    const resp = await cloudPostForm(
      'https://open.e.189.cn/api/logbox/oauth2/submitForSecondAuth.do',
      {
        'mobile': s.mobileEnc,
        'appKey': s.conf.appKey,
        'userName': s.pre + rsaPkcs1Hex(s.username, s.modHex, s.expHex),
        'epd': s.pre + rsaPkcs1Hex(smsCode, s.modHex, s.expHex),
        'accountType': s.conf.accountType,
        'returnUrl': encodeURIComponent(s.conf.returnUrl),
        'isOauth2': s.conf.isOauth2,
        'cb_SaveName': '3',
        'state': s.conf.state,
        'paramId': s.conf.paramId,
      },
      { headers: { ...this._sessionHeaders(s), 'Cookie': cookieHeader(s.cookies) } },
    );
    if (!resp.isOk) throw new CloudException('验证码校验失败');
    const body = resp.json;
    const result = asInt(body['result']) ?? -1;
    if (result !== 0) {
      throw new CloudException(asString(body['msg'] ?? '验证码错误'));
    }
    Ecloud189Provider._pendingSms.delete(s.username);
    const toUrl = asString(body['toUrl'] ?? '');
    const cookie = await this._exchangePortalSession(s.cookies, toUrl);
    return new CloudAccount({
      provider: this.id,
      accountId: asString(body['userId'] ?? s.username),
      nickname: s.username,
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
      const loc = await this._hopGet(url, jar, 'https://cloud.189.cn/');
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
