// 移植自移动端 lib/src/cloud/providers/pan123_provider.dart
// 123 云盘 provider（qrCode 主通道 + 账密兜底；分享免转存直链
// directPlayable=true）。
//
// 登录链（扫码/账密）留在 TS；业务经 cloudRemote 桥转发内嵌 Rust
//（src-tauri/src/cloud/pan123.rs）。

import {
  asInt,
  asRecord,
  asString,
  cloudGet,
  cloudPostJson,
  encodeQueryComponent,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustShareDirectLink, rustTransferShare, rustValidate } from '../cloudRemote';
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
import { HttpLoginGate, md5Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class Pan123Provider extends CloudProvider {
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
    // 接口返回二维码跳转 URL（data.url，123pan App 扫码用）与 uniID；
    // 旧字段 qr 兼容保留。
    const qr = asString(data['url'] ?? data['qr'] ?? '');
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
    // 现接口字段为 loginStatus（旧 status 兼容）：2=已确认，4=已失效。
    const status = asInt(data['loginStatus'] ?? data['status']) ?? 0;
    if (status === 4) throw new CloudException('二维码已过期，请刷新');
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

  /** 分享免转存直链。 */
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
