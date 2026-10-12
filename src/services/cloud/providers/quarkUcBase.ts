// 移植自移动端 lib/src/cloud/providers/quark_uc_base.dart
// 夸克 / UC 网盘共用实现（两家同为阿里系 XCloud 架构，接口同构）。
//
// 登录：原生扫码——CAS 下发 token → 轮询 service ticket → st 兑换
// 登录 Cookie（kps/sign）；业务（列目录/分享/转存/直链）经 cloudRemote
// 桥转发内嵌 Rust（src-tauri/src/cloud/quark_uc.rs）；子类只声明常量。

import { cloudGet, cookieHeader } from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustShareDirectLink, rustTransferShare, rustValidate } from '../cloudRemote';
import {
  CloudAccount,
  CloudDirectLink,
  CloudException,
  CloudFile,
  CloudListResult,
  CloudLoginKind,
  CloudQrLoginSession,
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

  /** CAS 扫码域（uop.quark.cn / api.open.uc.cn）。 */
  abstract get casHost(): string;

  /** 扫码内容模板（{token} 占位；品牌 App 扫码后跳确认页）。 */
  abstract get qrContentTemplate(): string;

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

  /** 未带登录态的 Web 请求头（扫码链路用）。 */
  private get _webHeaders(): Record<string, string> {
    return {
      'User-Agent': this._ua,
      Referer: `https://${this.webHost}/`,
    };
  }

  override get rootPath(): string {
    return '0';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.QrCode;
  }

  override get directLinkTtl(): number {
    return 2 * 60 * 60 * 1000;
  }

  // ── 登录（原生扫码）───────────────────────────────────

  override async createQrLogin(): Promise<CloudQrLoginSession> {
    const resp = await cloudGet(`https://${this.casHost}/cas/ajax/getTokenForQrcodeLogin`, {
      headers: this._webHeaders,
    });
    if (!resp.isOk) throw new CloudException('二维码获取失败');
    const members = this._membersOf(resp.json);
    const token = members ? String(members['token'] ?? '') : '';
    if (token === '') throw new CloudException('二维码获取失败');
    return new CloudQrLoginSession({
      qrContent: this.qrContentTemplate.replace('{token}', token),
      state: token,
    });
  }

  override async pollQrLogin(session: CloudQrLoginSession): Promise<CloudAccount | null> {
    const resp = await cloudGet(
      `https://${this.casHost}/cas/ajax/getServiceTicketByQrcodeToken?token=${encodeURIComponent(session.state)}`,
      { headers: this._webHeaders },
    );
    if (!resp.isOk) return null; // 瞬时错误，保持轮询
    const j = resp.json;
    // 2000000=已确认（携带 service_ticket）；50004001=待扫码/待确认。
    const status = typeof j['status'] === 'number' ? j['status'] : 0;
    if (status === 50004001) return null;
    if (status !== 2000000) throw new CloudException('二维码已失效，请刷新');
    const members = this._membersOf(j);
    const st = members ? String(members['service_ticket'] ?? '') : '';
    if (st === '') throw new CloudException('二维码已失效，请刷新');
    // st 兑换登录 Cookie（Set-Cookie 全收，含 kps/sign）。
    const resp2 = await cloudGet(
      `https://${this.apiHost}/1/clouddrive/login?${this.commonQuery}&st=${encodeURIComponent(st)}`,
      { headers: this._webHeaders },
    );
    return this.buildAccountFromCookies(resp2.setCookiePairs);
  }

  /** data.members 提取（防御式）。 */
  private _membersOf(j: Record<string, unknown>): Record<string, unknown> | null {
    const data = j['data'];
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
    const members = (data as Record<string, unknown>)['members'];
    if (typeof members !== 'object' || members === null || Array.isArray(members)) return null;
    return members as Record<string, unknown>;
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
