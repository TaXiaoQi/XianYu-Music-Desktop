// 移植自移动端 lib/src/cloud/providers/quark_uc_base.dart
// 夸克 / UC 网盘共用实现（两家同为阿里系 XCloud 架构，接口同构）。
//
// 登录：WebView 范式（捕获 kps/sign Cookie）——原原生扫码链路的 st 兑换
// 接口 /1/clouddrive/login 已被官方下线（404），无替代兑换端点；桌面端
// 走内嵌 WebView 登录窗（原生 Cookie 轮询等 __kps/__pus，落地页补签发
// __puus），凭据粘贴框保留兜底。业务经 cloudRemote 桥转发内嵌 Rust
// （src-tauri/src/cloud/quark_uc.rs）；子类只声明品牌常量。

import { cloudGet, cookieHeader } from '../cloudHttp';
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
  CloudLoginKind,
  CloudShareParse,
} from '../cloudTypes';
import { md5Hex } from './httpLoginSupport';

export abstract class QuarkUcBase extends CloudProvider {
  /** API 域（drive-pc.quark.cn / pc-api.uc.cn）。 */
  abstract get apiHost(): string;

  /** Web 域（Referer 用）。 */
  abstract get webHost(): string;

  /** 客户端品牌参数（夸克 pr=ucpro；UC pr=UCBrowser——2026-10-16 起
   * ucpro 通道对 UC 也收紧拒 Web Cookie，UCBrowser 通道仍宽容）。 */
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

  /** Cookie 轮询域（夸克 quark.cn/pan.quark.cn/pl.quark.cn；UC
   * uc.cn/drive.uc.cn/pc.uc.cn/passport.uc.cn），逐域原生读取。 */
  abstract get captureCookieDomains(): string[];

  /** 登录页横向溢出时登录区是否靠右：夸克/UC 营销页登录区都在右侧
   * 视口外（子类声明 true），窗口内滚到最右直接露出登录卡。 */
  get alignLoginRight(): boolean {
    return false;
  }

  override get webviewLoginUrl(): string {
    return `https://${this.webHost}/`;
  }

  /** 窗口登录捕获规则（cookie 型）：原生轮询等 __kps/__pus 齐活（登录
   * 成功才签发，未登录恒缺）→ 驱动落地页补签发 __puus（稳定锚，落地页
   * init 请求 ~2s 后签发）→ 全量 Cookie 交回 completeLogin。 */
  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      cookieDomains: this.captureCookieDomains,
      requiredCookies: ['__kps', '__pus'],
      finalCookies: ['__puus'],
      postLoginUrl: `https://${this.webHost}/`,
      scrollToRight: this.alignLoginRight,
    });
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
    // 2026-10 Web 端凭据更名：__kps / __pus / __puus 任一在即有效
    // （旧 kps/sign 名已不存在）。
    if (['__kps', '__pus', '__puus'].every((n) => !cookies[n])) {
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
          // 2026-10 响应结构更名：member → member_info（与凭据 __kps
          // 更名同一波变更，真机实测），旧名兜底兼容。
          const member =
            (data as Record<string, unknown>)['member'] ??
            (data as Record<string, unknown>)['member_info'];
          if (typeof member === 'object' && member !== null && !Array.isArray(member)) {
            const m = member as Record<string, unknown>;
            const uid = m['user_id'] ?? (data as Record<string, unknown>)['user_id'];
            const nick = m['nickname'];
            if (uid != null && String(uid) !== '') accountId = String(uid);
            if (nick != null && String(nick) !== '') nickname = String(nick);
          }
        }
      }
      // 现役网页昵称接口：web 域 account/info（昵称/头像/用户 id 在
      // data 本层；member 已被 2026-10 拆改只剩容量字段，社区现役实现
      // 均以此取昵称）。UA 用桌面浏览器串（与移动端 desktopWebviewUa
      // 同源，捕获 Cookie 时的 WebView 也是该串）。
      const resp2 = await cloudGet(`https://${this.webHost}/account/info?fr=pc&platform=pc`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: `https://${this.webHost}/`,
          Cookie: cookieStr,
        },
      });
      if (resp2.isOk) {
        const data2 = resp2.json['data'];
        if (typeof data2 === 'object' && data2 !== null && !Array.isArray(data2)) {
          const d = data2 as Record<string, unknown>;
          const uid2 = d['user_id'];
          if (uid2 != null && String(uid2) !== '') accountId = String(uid2);
          const nick2 = d['nick_name'] ?? d['nickname'] ?? d['user_name'];
          if (nick2 != null && String(nick2) !== '') nickname = String(nick2);
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
