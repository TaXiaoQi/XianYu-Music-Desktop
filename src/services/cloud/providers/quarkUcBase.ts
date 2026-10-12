// 移植自移动端 lib/src/cloud/providers/quark_uc_base.dart
// 夸克 / UC 网盘共用实现（两家同为阿里系 XCloud 架构，接口同构）。
//
// 登录：WebView 范式（移动端在官方网盘页捕获 kps/sign Cookie）——原
// 原生扫码链路的 st 兑换接口 /1/clouddrive/login 已被官方下线（404），
// 无替代兑换端点；桌面端不做网页登录，completeLogin 仅供手机端绑定后
// 凭据云同步。业务经 cloudRemote 桥转发内嵌 Rust
// （src-tauri/src/cloud/quark_uc.rs）；子类只声明品牌常量。

import { cloudGet, cookieHeader } from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustSearchFiles, rustShareDirectLink, rustTransferShare, rustValidate } from '../cloudRemote';
import {
  CloudAccount,
  CloudCaptureResult,
  CloudDirectLink,
  CloudException,
  CloudFile,
  CloudListResult,
  CloudLoginKind,
  CloudShareParse,
} from '../cloudTypes';
import { md5Hex } from './httpLoginSupport';

export abstract class QuarkUcBase extends CloudProvider {
  /** API 域（drive-pc.quark.cn / drive-pc.uc.cn）。 */
  abstract get apiHost(): string;

  /** Web 域（Referer 用）。 */
  abstract get webHost(): string;

  /** 客户端品牌参数（pr=quark / ucpro）。 */
  abstract get pr(): string;

  /** UA 品牌串（quark-cloud-drive / uc-cloud-drive）。 */
  abstract get uaBrand(): string;

  get commonQuery(): string {
    return `pr=${this.pr}&fr=pc&sys=win32&ve=3.23.2`;
  }

  private get _ua(): string {
    return (
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      `(KHTML, like Gecko) ${this.uaBrand}/2.5.20 Chrome/100.0.4896.160 ` +
      'Electron/18.3.5.12-a038f7b798 Safari/537.36 Channel/pckk_other_ch'
    );
  }

  /** 带凭据的通用请求头（登录态探测用）。 */
  authHeaders(cred: Record<string, string>): Record<string, string> {
    return {
      'User-Agent': this._ua,
      Referer: `https://${this.webHost}/`,
      Cookie: cookieHeader(cred),
    };
  }

  override get rootPath(): string {
    return '0';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.WebviewCookie;
  }

  override get directLinkTtl(): number {
    return 2 * 60 * 60 * 1000;
  }

  // ── 登录（WebView 捕获 Cookie；桌面端仅接收云同步凭据）───

  override async completeLogin(captured: CloudCaptureResult): Promise<CloudAccount> {
    return this.buildAccountFromCookies(captured.cookies);
  }

  /** 登录 Cookie → 账号（member 接口拿昵称/用户 id，防御式兜底指纹）。 */
  async buildAccountFromCookies(cookies: Record<string, string>): Promise<CloudAccount> {
    if (cookies['kps'] === undefined || cookies['kps'] === '') {
      throw new CloudException('登录凭据获取失败，请重试');
    }
    const cookieStr = cookieHeader(cookies);
    let accountId = (await md5Hex(cookieStr)).substring(0, 12);
    let nickname = this.displayName;
    try {
      const resp = await cloudGet(
        `https://${this.apiHost}/1/clouddrive/member?${this.commonQuery}` +
          '&fetch_subscribe=true&fetch_identity=true',
        { headers: this.authHeaders(cookies) },
      );
      if (resp.isOk) {
        const data = resp.json['data'];
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          const member = (data as Record<string, unknown>)['member'];
          if (typeof member === 'object' && member !== null && !Array.isArray(member)) {
            const m = member as Record<string, unknown>;
            const uid = m['user_id'] ?? (data as Record<string, unknown>)['user_id'];
            const nick = m['nickname'];
            if (uid != null && String(uid) !== '') accountId = String(uid);
            if (nick != null && String(nick) !== '') nickname = String(nick);
          }
        }
      }
    } catch {
      // 拿不到昵称就用指纹兜底。
    }
    return new CloudAccount({
      provider: this.id,
      accountId,
      nickname,
      cred: cookies,
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

  /** 分享免转存直链（夸克/UC 分享页下载接口）。 */
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
