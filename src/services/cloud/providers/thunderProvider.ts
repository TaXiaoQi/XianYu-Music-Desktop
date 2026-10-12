// 移植自移动端 lib/src/cloud/providers/thunder_provider.dart
// 迅雷云盘 provider（httpPassword：v3/login 账密接口，password 传 md5）。
//
// 登录链留在 TS；业务经 cloudRemote 桥转发内嵌 Rust
//（src-tauri/src/cloud/thunder.rs，XCloud 架构与 PikPak 同构）。

import { asString, cloudPostJson } from '../cloudHttp';
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
import { HttpLoginGate, md5Hex, uuidV4 } from './httpLoginSupport';

const UA =
  'ANDROID-com.xunlei.downloadprovider/8.31.0.9726 netWorkType/5G ' +
  'appid/40 deviceName/Xiaomi_M2004j7ac deviceModel/M2004J7AC ' +
  'Oauth2Client/0.9';
const CLIENT_ID = 'Xq00jqW5m1PrHnV8';

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
