// 移植自移动端 lib/src/cloud/providers/lanzou_provider.dart
// 蓝奏云 provider（httpPassword；分享免登录免转存直链
// directPlayable=true）。
//
// 登录链留在 TS；业务（列目录/分享/直链）经 cloudRemote 桥转发内嵌
// Rust（src-tauri/src/cloud/lanzou.rs）。

import { cloudPostForm } from '../cloudHttp';
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
  CloudShareParse,
} from '../cloudTypes';
import { HttpLoginGate, md5Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

export class LanzouProvider extends CloudProvider {
  override get id(): string {
    return 'lanzou';
  }

  override get displayName(): string {
    return '蓝奏云';
  }

  override get rootPath(): string {
    return '';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.HttpPassword;
  }

  override get directLinkTtl(): number {
    return 20 * 60 * 1000;
  }

  override get loginFields(): CloudLoginField[] {
    return [
      new CloudLoginField({ key: 'username', label: '用户名' }),
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
      const resp = await cloudPostForm(
        'https://up.woozooo.com/mlogin.php',
        {
          'task': '3',
          'uid': username,
          'pwd': password,
          'authcode': '',
        },
        { headers: { 'User-Agent': UA, 'Referer': 'https://up.woozooo.com/' } },
      );
      if (!resp.isOk || !resp.body.includes('登录成功')) {
        HttpLoginGate.instance.recordFailure(this.id);
        throw new CloudException('账号或密码错误');
      }
      const ylogin = resp.setCookiePairs['ylogin'] ?? '';
      if (ylogin === '') {
        HttpLoginGate.instance.recordFailure(this.id);
        throw new CloudException('登录失败');
      }
      HttpLoginGate.instance.recordSuccess(this.id);
      return new CloudAccount({
        provider: this.id,
        accountId: (await md5Hex(ylogin)).substring(0, 12),
        nickname: username,
        cred: { 'cookie': `ylogin=${ylogin}` },
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
