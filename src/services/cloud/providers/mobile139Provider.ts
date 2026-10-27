// 移植自移动端 lib/src/cloud/providers/mobile139_provider.dart
// 移动云盘（139）provider（smsPassword 自绘短信/服务密码登录 +
// webviewCookie Cookie 粘贴兜底，双通道；收码复用天翼同款公共弹窗）。
//
// 自绘短信通道（auth-rebuild 现役 API，2026-10 实测全链，与移动端全同构）：
//   ① POST /orchestration/auth-rebuild/key/v1.0/getRsaPublicKey —— 动态
//      RSA 公钥；前端随机 16 位 AESKey 经 RSA-PKCS1(base64) 放 mcloud-skey
//      header，服务端按 skey 无状态解密，会话可逐请求重建；
//   ② 业务 payload JSON → AES-128-ECB/PKCS7(base64) 包 encryptMsg；
//   ③ 短信登录（天翼同构弹窗范式）：表单提交开握手会话抛
//      CloudSmsRequiredException，弹窗内点「发送验证码」才发码
//      （getSmsVerifyCode，服务端回传 random）→ 填码 submitSmsCode
//      verifySmsCode → data.token；
//   ④ 服务密码登录：permission/login passPwd 通道（dycPwd = SHA1 大写）；
//   ⑤ authorization = "Basic " + base64("pc:手机号:token")，与网页登录
//      同构，业务（rust 桥）零改动。
//   公共 headers：mcloud-sign = MD5(MD5(b64(encodeURIComponent(body)
//   字符排序)) + MD5("ts:msgId"))大写，mcloud-client=10701 等。
// Cookie 兜底通道：桌面端无 WebView，由设置页 Cookie 粘贴弹窗提供
// captured.cookies，走 completeLogin（凭据校验/账号构建与移动端 WebView
// 捕获同一条链路）。业务（列目录/分享/转存/直链）经 cloudRemote 桥转发
// 内嵌 Rust（src-tauri/src/cloud/mobile139.rs）。

import { cloudPostRaw, cookieHeader } from '../cloudHttp';
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
  CloudLoginField,
  CloudLoginKind,
  CloudShareParse,
  CloudSmsRequiredException,
} from '../cloudTypes';
import {
  aesEcbPkcs7B64,
  HttpLoginGate,
  md5Hex,
  parseSpki,
  rsaPkcs1B64,
  sha1Hex,
} from './httpLoginSupport';

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
    // hcy 根目录约定为 "/"（SPA 同款；传 "root" 实测回空列表，rust 桥
    // 对两种历史写法均已归一）。
    return '/';
  }

  override get loginKind(): CloudLoginKind {
    // 自绘短信/服务密码登录为主通道（官方网页登录面板第一 tab）；
    // Cookie 粘贴（webviewCookie 捕获链的桌面端替代）保留为兜底：
    // 绑定弹窗内「Cookie 登录」切换。
    return CloudLoginKind.SmsPassword;
  }

  override get loginFields(): CloudLoginField[] {
    return [
      new CloudLoginField({ key: 'phone', label: '手机号', isPhone: true }),
      // 默认短信登录（发码+公共弹窗收码）；点切换展开服务密码框走
      // passPwd 通道，可随时切回。
      new CloudLoginField({
        key: 'password',
        label: '服务密码',
        obscure: true,
        optional: true,
        switchLabel: '使用服务密码登录',
        collapseLabel: '使用短信验证码登录',
      }),
    ];
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

  // ── 登录（smsPassword 主通道）──────────────────────────

  /// 139 自绘短信登录会话（进程内暂存；发码 → 校验两步共用）。
  private static _pendingSession: _SmsLoginSession | null = null;

  /** 天翼同构弹窗范式：表单收手机号 + 服务密码（选填）。密码非空走
   * passPwd 通道（permission/login，dycPwd = SHA1(密码) 大写）；留空
   * 抛 [CloudSmsRequiredException] 打开公共收码弹窗，弹窗内点
   * 「发送验证码」才真正发码（走 [resendDeviceSms]）。 */
  override async loginWithFields(fields: Record<string, string>): Promise<CloudAccount> {
    const phone = (fields['phone'] ?? '').trim();
    if (phone.length !== 11) {
      throw new CloudException('请输入 11 位手机号');
    }
    const password = (fields['password'] ?? '').trim();
    if (password !== '') {
      return this._loginByServicePassword(phone, password);
    }
    HttpLoginGate.instance.ensureAllowed(this.id);
    const sess = await this._openSession();
    // 会话先行（加密握手可复用），发码推迟到弹窗「发送验证码」；
    // random 由发码响应回填（submitSmsCode 前必经 resendDeviceSms）。
    Mobile139Provider._pendingSession = Object.assign(sess, { phone });
    throw new CloudSmsRequiredException(phone, `验证码将发送至 ${phone}`);
  }

  /** 服务密码登录：auth-rebuild permission/login passPwd 通道
   * （dycPwd = SHA1(服务密码) 大写，实测参数形态服务端认可）。 */
  private async _loginByServicePassword(phone: string, password: string): Promise<CloudAccount> {
    HttpLoginGate.instance.ensureAllowed(this.id);
    HttpLoginGate.instance.recordAttempt(this.id);
    const sess = await this._openSession();
    try {
      const dycPwd = (await sha1Hex(password)).toUpperCase();
      const resp = await this._postAuth(
        sess,
        'https://yun.139.com/orchestration/auth-rebuild/permission/v1.0/login',
        `{"dycPwd":"${dycPwd}","loginStyle":"passPwd","ifOpenAccount":1,` +
          `"verType":1,"clientEnv":"3","setCookie":0,"account":"${phone}"}`,
      );
      const data = (resp['data'] ?? {}) as Record<string, unknown>;
      const token = String(data['token'] ?? data['authToken'] ?? '');
      if (token === '') {
        throw new CloudException('登录未返回凭据，请重试');
      }
      HttpLoginGate.instance.recordSuccess(this.id);
      return await this._accountFromAuth(`Basic ${btoa(`pc:${phone}:${token}`)}`);
    } catch (e) {
      if (e instanceof CloudException) {
        HttpLoginGate.instance.recordFailure(this.id);
      }
      throw e;
    }
  }

  /** 提交短信验证码（公共收码弹窗「确定」后调用）。 */
  override async submitSmsCode(username: string, smsCode: string): Promise<CloudAccount> {
    const sess = Mobile139Provider._pendingSession;
    if (!sess || username !== sess.phone || (sess.random ?? '') === '') {
      throw new CloudException('登录会话已失效，请重新登录');
    }
    const code = smsCode.trim();
    if (code === '') {
      throw new CloudException('请输入短信验证码');
    }
    try {
      const resp = await this._postAuth(
        sess,
        'https://yun.139.com/orchestration/auth-rebuild/sms/v1.0/verifySmsCode',
        `{"account":"${username}","random":"${sess.random}","verifyCode":"${code}",` +
          `"recordID":"","reqType":"1","setCookie":0}`,
      );
      const data = (resp['data'] ?? {}) as Record<string, unknown>;
      const token = String(data['token'] ?? data['authToken'] ?? '');
      if (token === '') {
        throw new CloudException('登录未返回凭据，请重试');
      }
      Mobile139Provider._pendingSession = null;
      HttpLoginGate.instance.recordSuccess(this.id);
      return await this._accountFromAuth(`Basic ${btoa(`pc:${username}:${token}`)}`);
    } catch (e) {
      if (e instanceof CloudException) {
        HttpLoginGate.instance.recordFailure(this.id);
      }
      throw e;
    }
  }

  /** 弹窗内发送/重发验证码（「发送验证码」按钮调用）：首次发码也从
   * 这里走（弹窗驱动，表单提交不再自动发码）。 */
  override async resendDeviceSms(username: string): Promise<void> {
    const sess = Mobile139Provider._pendingSession;
    if (!sess || username !== sess.phone) {
      throw new CloudException('登录会话已失效，请重新登录');
    }
    HttpLoginGate.instance.ensureAllowed(this.id);
    try {
      await this._sendSms(sess, username);
      HttpLoginGate.instance.recordAttempt(this.id);
    } catch (e) {
      if (e instanceof CloudException) {
        HttpLoginGate.instance.recordFailure(this.id);
      }
      throw e;
    }
  }

  /** 发码：getSmsVerifyCode；回传 random 暂存进会话（verifySmsCode 必须
   * 原样回传）。风控拼图（mode != 0）= 免拼图次数用尽，提示走 Cookie
   * 粘贴兜底。 */
  private async _sendSms(sess: _SmsLoginSession, phone: string): Promise<void> {
    const resp = await this._postAuth(
      sess,
      'https://yun.139.com/orchestration/auth-rebuild/sms/v1.0/getSmsVerifyCode',
      `{"account":"${phone}","reqType":"1","mode":0}`,
    );
    const mode = String(resp['mode'] ?? '0');
    if (mode !== '0') {
      throw new CloudException('验证码获取过于频繁，请稍后再试或改用 Cookie 登录');
    }
    sess.random = String(resp['random'] ?? '');
  }

  /** 建加密会话：动态 RSA 公钥 → 随机 16 位 AESKey → RSA-PKCS1(base64)
   * 作 mcloud-skey（服务端按此还原 AESKey 解 encryptMsg）。 */
  private async _openSession(): Promise<_SmsLoginSession> {
    const resp = await this._postAuth(
      null,
      'https://yun.139.com/orchestration/auth-rebuild/key/v1.0/getRsaPublicKey',
      '{}',
    );
    const data = (resp['data'] ?? {}) as Record<string, unknown>;
    const pub = data['publicKey'];
    if (typeof pub !== 'string' || pub === '') {
      throw new CloudException('登录服务不可用');
    }
    const [mod, exp] = parseSpki(pub);
    const aesKey = randAlnum(16);
    return { aesKey, skey: rsaPkcs1B64(aesKey, mod, exp), random: null, phone: null };
  }

  /** auth-rebuild 统一请求：encryptMsg 包 payload + 全量公共 headers。
   * [sess] 为 null 时不带 mcloud-skey（getRsaPublicKey 本身）。 */
  private async _postAuth(
    sess: _SmsLoginSession | null,
    url: string,
    payload: string,
  ): Promise<Record<string, unknown>> {
    const body =
      sess === null ? payload : `{"encryptMsg":"${await aesEcbPkcs7B64(payload, sess.aesKey)}"}`;
    const ts = Date.now().toString();
    const msgId = randAlnum(16);
    const resp = await cloudPostRaw(url, body, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'CMS-DEVICE': 'default',
        'x-yun-channel-source': '10000034',
        'x-huawei-channelSrc': '10000034',
        'x-m4c-caller': 'PC',
        'x-m4c-src': '10002',
        'x-inner-ntwk': '2',
        'mcloud-route': '001',
        'mcloud-version': '7.18.1',
        'mcloud-channel': '1000101',
        'mcloud-client': '10701',
        'mcloud-sign': `${ts},${msgId},${await this._mcloudSign(body, ts, msgId)}`,
        ...(sess !== null ? { 'mcloud-skey': sess.skey } : {}),
        'Referer': 'https://yun.139.com/w/',
        'Origin': 'https://yun.139.com',
      },
    });
    const j = resp.json;
    if (j['success'] !== true) {
      const msg = String(j['message'] ?? '');
      throw new CloudException(msg === '' ? '登录服务不可用' : msg);
    }
    return j;
  }

  /** mcloud-sign：MD5(MD5(b64(encodeURIComponent(body) 字符排序)) +
   * MD5("ts:msgId")) 大写（网页端 getNewSign 还原）。 */
  private async _mcloudSign(body: string, ts: string, msgId: string): Promise<string> {
    const sorted = encodeURIComponent(body).split('').sort().join('');
    const r = await md5Hex(utf8B64(sorted));
    const l = await md5Hex(`${ts}:${msgId}`);
    return (await md5Hex(r + l)).toUpperCase();
  }

  /** authorization（"Basic " + base64("pc:手机号:token")）→ 账号。短信
   * 登录与网页登录捕获同一凭据形态，展示名同用脱敏手机号。 */
  private async _accountFromAuth(auth: string): Promise<CloudAccount> {
    const authorization = auth.substring(6);
    let nick = '移动云盘';
    try {
      const dec = new TextDecoder().decode(
        Uint8Array.from(atob(authorization), (ch) => ch.charCodeAt(0)),
      );
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
      cred: { 'authorization': authorization },
      boundAt: new Date(),
    });
  }

  // ── Cookie 粘贴兜底（webviewCookie 捕获链的桌面端替代）─────────

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

/** 139 自绘短信登录会话（对齐移动端 _SmsLoginSession）。 */
interface _SmsLoginSession {
  /** AES-128-ECB 密钥（16 位随机字母数字，RSA 加密后走 mcloud-skey）。 */
  aesKey: string;

  /** RSA-PKCS1(aesKey) base64，服务端据此还原 AESKey 解 encryptMsg。 */
  skey: string;

  /** 发码请求回传的 random（verifySmsCode 必须原样回传）。 */
  random: string | null;

  /** 本次会话手机号（防止填码期间改号造成账号错绑）。 */
  phone: string | null;
}

/** 随机字母数字串（AESKey / msgId 用）。 */
function randAlnum(n: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => chars[b % chars.length]!)
    .join('');
}

/** UTF-8 安全 base64（mcloud-sign 的 sorted 串可能含非 ASCII，对齐
 * Dart base64Encode(utf8.encode(...))）。 */
function utf8B64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
