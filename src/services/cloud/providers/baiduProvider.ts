// 移植自移动端 lib/src/cloud/providers/baidu_provider.dart
// 百度网盘 provider（OAuth 授权登录：内嵌授权窗打开授权页 → 回调跳转
// 被 rust 侧拦截抽 code → completeLogin 交换凭据；分享列表/转存必须带
// 登录态，parseShareLink 内直接读本地绑定凭据；业务一律经 cloudRemote
// 桥转发内嵌 Rust）。

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
  CloudShareParse,
} from '../cloudTypes';
import { md5Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 开放平台 OAuth（pan.baidu.com/union 注册的应用），对齐移动端。
// redirect_uri 无需真实可达——授权完成后内嵌授权窗跳到
// `<redirect_uri>?code=xxx`，rust 侧 on_navigation 在加载前拦截抽 code。
const OAUTH_CLIENT_ID = 'WzEEfe8MMzVlPqzpBB2r1hn0CKPrcDyt';
const OAUTH_CLIENT_SECRET = 'a4MUtVIlPuQiRPGBFCAHwz2bmLv2bunE';
const OAUTH_REDIRECT_URI = 'https://xianyu-music.github.io/oauth/baidu';

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

  /** OAuth 网页授权页（授权登录次通道；扫码不可用时的替代）。 */
  override get oauthAuthorizeUrl(): string {
    return (
      'https://openapi.baidu.com/oauth/2.0/authorize' +
      '?response_type=code' +
      `&client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}` +
      '&scope=basic,netdisk&display=page'
    );
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

  // ── 登录（OAuth 授权：内嵌授权窗 + 回调拦截，completeLogin 交换）──

  // 手填通道（对齐移动端 completeLogin 分型）：
  // - Cookie（含 BDUSS）→ Cookie 轨凭据；
  // - at: 前缀 access_token / token JSON / 授权 code（或含 code= 的完整
  //   跳转链接）→ OAuth 交换，落 OAuth 轨凭据（rust 侧 is_oauth 双轨）。
  // 昵称/uid 尽力取，失败则显示名 + 哈希兜底。
  override async completeLogin(captured: CloudCaptureResult): Promise<CloudAccount> {
    const pairs = captured.cookies;
    const tokenRaw = (captured.token ?? '').trim();
    const bduss = pairs['BDUSS'] ?? '';
    if (bduss === '' && tokenRaw === '') {
      throw new CloudException('Cookie 中未找到 BDUSS，请重新复制');
    }
    if (bduss === '') return this._completeOAuthLogin(tokenRaw);
    let nickname = this.displayName;
    let accountId = (await md5Hex(bduss)).substring(0, 12);
    // 昵称尽力取：getinfo 接口现已要求风控参数（errno=2 params error），
    // 改抓 disk/main 页面内嵌用户信息 JSON 段的 "username":"..."（同一
    // 登录会话，2026-10 实测稳定返回）。
    try {
      const resp = await cloudGet('https://pan.baidu.com/disk/main', {
        headers: {
          ...this._webHeaders,
          Referer: 'https://pan.baidu.com/',
          Cookie: cookieHeader(pairs),
        },
      });
      if (resp.isOk) {
        const m = /"username":"([^"]{1,64})"/.exec(resp.body);
        if (m && m[1] !== '') nickname = m[1];
      }
    } catch {
      // 昵称拿不到不影响绑定。
    }
    return new CloudAccount({
      provider: this.id,
      accountId,
      nickname,
      cred: pairs,
      boundAt: new Date(),
    });
  }

  // OAuth 通道：授权 code（或含 code= 的完整跳转链接）/ token JSON /
  // at: 前缀 access_token → 换发 OAuth 轨凭据。token 接口只从 URL query
  // 取参（POST form 会报 unsupported_grant_type，移动端 2026-10-29 实测
  // 同款问题），参数全部拼 query 走 GET（百度官方文档形态）。
  private async _completeOAuthLogin(raw: string): Promise<CloudAccount> {
    let token = raw;
    // 粘贴的是授权后跳转 URL（GitHub Pages 404 链接）→ 抽 code
    const m = /[?&#]code=([0-9a-zA-Z._-]{10,})/.exec(token);
    if (m) token = m[1];
    if (token === '') {
      throw new CloudException('未识别到授权凭据，请粘贴授权后地址栏的完整链接');
    }
    let accessToken = '';
    let refreshToken = '';
    if (token.startsWith('at:')) {
      accessToken = token.slice(3);
    } else if (token.startsWith('{')) {
      try {
        const j: unknown = JSON.parse(token);
        if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
          const obj = j as Record<string, unknown>;
          accessToken = String(obj['access_token'] ?? '');
          refreshToken = String(obj['refresh_token'] ?? '');
        }
      } catch {
        // 非 JSON 裸串，按 code 交换
      }
    }

    if (accessToken === '') {
      const q =
        refreshToken !== ''
          ? `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}` +
            `&client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}` +
            `&client_secret=${encodeURIComponent(OAUTH_CLIENT_SECRET)}`
          : `grant_type=authorization_code&code=${encodeURIComponent(token)}` +
            `&client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}` +
            `&client_secret=${encodeURIComponent(OAUTH_CLIENT_SECRET)}` +
            `&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}`;
      let resp: Awaited<ReturnType<typeof cloudGet>>;
      try {
        resp = await cloudGet(`https://openapi.baidu.com/oauth/2.0/token?${q}`);
      } catch {
        throw new CloudException('授权凭据交换失败，请重试');
      }
      const j = resp.isOk ? resp.json : null;
      if (j == null || j['access_token'] == null) {
        // 带上百度返回的 error_description（如 invalid_grant），用户反馈
        // 截图即含真实原因，免再导日志定位
        const reason = String(j?.['error_description'] ?? j?.['error'] ?? '');
        throw new CloudException(
          `授权凭据无效或已过期${reason === '' ? '' : `（${reason}）`}，请重新登录`,
        );
      }
      accessToken = String(j['access_token']);
      refreshToken = String(j['refresh_token'] ?? refreshToken);
    }

    // uinfo：昵称 + 百度数字 uid（账号标识；refresh_token 每次授权
    // 会轮换，不能当 accountId）。
    let uid = '';
    let nickname = '';
    try {
      const info = await cloudGet(
        'https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo' +
          `&access_token=${encodeURIComponent(accessToken)}`,
        { headers: this._webHeaders },
      );
      if (info.isOk) {
        const j = info.json;
        uid = String(j['baidu_id'] ?? j['uk'] ?? '');
        nickname = String(j['netdisk_name'] ?? j['name'] ?? '');
      }
    } catch {
      // 昵称拿不到不影响绑定。
    }
    return new CloudAccount({
      provider: this.id,
      accountId: uid !== '' ? uid : (await md5Hex(accessToken)).substring(0, 12),
      nickname: nickname !== '' ? nickname : this.displayName,
      cred: {
        accessToken,
        ...(refreshToken !== '' ? { refreshToken } : {}),
        accessExpireMs: String(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
