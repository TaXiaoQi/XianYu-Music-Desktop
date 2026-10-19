// 移植自移动端 lib/src/cloud/providers/baidu_provider.dart
// 百度网盘 provider（原生扫码：passport 下发二维码图 → unicast 轮询 →
// BDUSS/STOKEN 兑换）。
//
// 注意：分享列表/转存接口必须带登录态（BDUSS），故 parseShareLink 内
// 直接读本地绑定凭据；业务一律经 cloudRemote 桥转发内嵌 Rust。

import { CloudCredentialsStore } from '../cloudCredentialsStore';
import { cloudGet, cookieHeader } from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustSearchFiles, rustTransferShare, rustValidate } from '../cloudRemote';
import {
  CloudAccount,
  CloudCaptureResult,
  CloudDirectLink,
  CloudException,
  CloudFile,
  CloudListResult,
  CloudLoginKind,
  CloudQrLoginSession,
  CloudShareParse,
} from '../cloudTypes';
import { md5Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class BaiduProvider extends CloudProvider {
  override get id(): string {
    return 'baidu';
  }

  override get displayName(): string {
    return '百度网盘';
  }

  override get rootPath(): string {
    return '/';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.QrCode;
  }

  override get directLinkTtl(): number {
    return 8 * 60 * 60 * 1000;
  }

  private get _webHeaders(): Record<string, string> {
    return {
      'User-Agent': UA,
      Referer: 'https://pan.baidu.com/',
    };
  }

  // ── 登录（原生扫码）───────────────────────────────────

  override async createQrLogin(): Promise<CloudQrLoginSession> {
    const gid = this._randomHex(32);
    const tt = Date.now();
    const resp = await cloudGet(
      'https://passport.baidu.com/v2/api/getqrcode' +
        `?lp=pc&qrloginfrom=pc&gid=${gid}&clienttype=web&apiver=v3&tt=${tt}` +
        '&tpl=netdisk',
      { headers: this._webHeaders },
    );
    if (!resp.isOk) throw new CloudException('二维码获取失败');
    const j = resp.json;
    if (typeof j['errno'] === 'number' && j['errno'] !== 0) {
      throw new CloudException('二维码获取失败');
    }
    const imgurl = String(j['imgurl'] ?? '');
    const sign = String(j['sign'] ?? '');
    if (imgurl === '' || sign === '') throw new CloudException('二维码获取失败');
    // getqrcode 响应的 Cookie（BAIDUID 等）须串联进后续轮询/兑换请求。
    const state = JSON.stringify({
      gid,
      sign,
      ck: cookieHeader(resp.setCookiePairs),
    });
    return new CloudQrLoginSession({
      qrContent: '',
      qrImageUrl: imgurl.startsWith('http') ? imgurl : `https://${imgurl}`,
      state,
    });
  }

  // 手填 Cookie：含 BDUSS 的网页 Cookie 直接落库为 Cookie 轨凭据
  // （对齐移动端 completeLogin）。昵称/uid 尽力取（网页 getinfo），
  // 失败则显示名 + BDUSS 哈希兜底。
  override async completeLogin(captured: CloudCaptureResult): Promise<CloudAccount> {
    const pairs = captured.cookies;
    const bduss = pairs['BDUSS'] ?? '';
    if (bduss === '') {
      throw new CloudException('Cookie 中未找到 BDUSS，请重新复制');
    }
    let nickname = this.displayName;
    let accountId = (await md5Hex(bduss)).substring(0, 12);
    try {
      const resp = await cloudGet(
        'https://pan.baidu.com/api/user/getinfo?ref=client&clienttype=0&web=1',
        {
          headers: {
            ...this._webHeaders,
            Referer: 'https://pan.baidu.com/disk/main',
            Cookie: cookieHeader(pairs),
          },
        },
      );
      if (resp.isOk && resp.json != null) {
        const info = (resp.json['user_info'] ?? resp.json['data']) as Record<string, unknown> | null;
        if (info != null && typeof info === 'object') {
          const name = String(info['username'] ?? info['user_name'] ?? '');
          if (name !== '') nickname = name;
          const uidRaw = info['id'] ?? info['user_id'] ?? info['baidu_id'];
          const uid = uidRaw == null ? '' : String(uidRaw);
          if (uid !== '' && uid !== '0') accountId = uid;
        }
      }
    } catch {
      // 昵称/uid 拿不到不影响绑定。
    }
    return new CloudAccount({
      provider: this.id,
      accountId,
      nickname,
      cred: pairs,
      boundAt: new Date(),
    });
  }

  override async pollQrLogin(session: CloudQrLoginSession): Promise<CloudAccount | null> {
    let info: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(session.state);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('bad state');
      }
      info = parsed as Record<string, unknown>;
    } catch {
      throw new CloudException('二维码已失效，请刷新');
    }
    const ck = String(info['ck'] ?? '');
    const headers: Record<string, string> = { ...this._webHeaders };
    if (ck !== '') headers['Cookie'] = ck;
    const tt = Date.now();
    const resp = await cloudGet(
      'https://passport.baidu.com/channel/unicast' +
        `?channel_id=${encodeURIComponent(String(info['sign'] ?? ''))}` +
        `&gid=${encodeURIComponent(String(info['gid'] ?? ''))}` +
        `&tpl=netdisk&_sdkFrom=1&apiver=v3&tt=${tt}`,
      { headers },
    );
    if (!resp.isOk) return null; // 瞬时错误，保持轮询
    const j = resp.json;
    const errno = typeof j['errno'] === 'number' ? j['errno'] : -1;
    if (errno === 1) return null; // 待扫码/待确认
    if (errno !== 0) throw new CloudException('二维码已失效，请刷新');
    // channel_v 为 JSON 字符串；status=0 表示已在手机端确认。
    const cvRaw: unknown = j['channel_v'];
    let cv: Record<string, unknown> | null = null;
    if (typeof cvRaw === 'string') {
      try {
        const parsed: unknown = JSON.parse(cvRaw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          cv = parsed as Record<string, unknown>;
        }
      } catch {
        cv = null;
      }
    } else if (typeof cvRaw === 'object' && cvRaw !== null && !Array.isArray(cvRaw)) {
      cv = cvRaw as Record<string, unknown>;
    }
    if (cv == null || cv['status'] !== 0) return null;
    const v = String(cv['v'] ?? '');
    const u = String(cv['u'] ?? '');
    if (v === '') throw new CloudException('二维码已失效，请刷新');
    // 兑换 BDUSS/STOKEN（Set-Cookie 下发）。
    const ts = Date.now();
    const resp2 = await cloudGet(
      `https://passport.baidu.com/v3/login/main/qrbdusslogin?v=${ts}` +
        `&bduss=${encodeURIComponent(v)}` +
        `&u=${encodeURIComponent(u)}` +
        '&loginVersion=v5&qrcode=1&tpl=netdisk',
      { headers },
    );
    const cookies = resp2.setCookiePairs;
    const bduss = cookies['BDUSS'] ?? '';
    if (bduss === '') throw new CloudException('登录失败，请重试');
    const cred: Record<string, string> = { BDUSS: bduss };
    if ((cookies['STOKEN'] ?? '') !== '') cred['STOKEN'] = cookies['STOKEN'] as string;
    return new CloudAccount({
      provider: this.id,
      accountId: (await md5Hex(bduss)).substring(0, 12),
      nickname: u === '' ? '百度账号' : u,
      cred,
      boundAt: new Date(),
    });
  }

  private _randomHex(len: number): string {
    let out = '';
    for (let i = 0; i < len; i++) {
      out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
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
    // 解析需登录态（BDUSS）；未绑定账号时在此抛出，行为与原实现一致。
    const cred = await this._soleCredOrThrow();
    return rustParseShare(this.id, url, pwd, cred);
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

  /** 分享列表/转存需要登录态；未绑定直接报。 */
  private async _soleCredOrThrow(): Promise<Record<string, string>> {
    const cred = await CloudCredentialsStore.instance.soleCredFor(this.id);
    if (cred == null) throw new CloudException('请先绑定百度网盘');
    return cred;
  }
}
