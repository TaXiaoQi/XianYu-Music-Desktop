// 移植自移动端 lib/src/cloud/cloud_provider.dart
// 网盘 Provider 抽象基类。
//
// 每盘一个实现文件（providers/*.ts），声明登录范式与捕获规则，
// 实现「列目录 / 分享解析 / 转存 / 取直链」骨架；直链请求一律带
// UA/Referer 伪装矩阵，多 route 降级 + 限速域名黑名单。
//
// 时长统一用毫秒数（Dart Duration → number ms）。

import {
  CloudAccount,
  CloudCaptureResult,
  CloudCaptureRule,
  CloudDirectLink,
  CloudListResult,
  CloudLoginField,
  CloudLoginKind,
  CloudQrLoginSession,
  CloudShareParse,
  CloudFile,
} from './cloudTypes';

export abstract class CloudProvider {
  /** 注册 id（cloud:// 与 cloudRegistry 一致）。 */
  abstract get id(): string;

  /** 显示名。 */
  abstract get displayName(): string;

  abstract get loginKind(): CloudLoginKind;

  /** WebView 初始 URL（webview 组；非 WebView 登录盘为空串）。 */
  get webviewLoginUrl(): string {
    return '';
  }

  /** WebView 捕获规则（webview 组；非 WebView 登录盘为 null）。 */
  get captureRule(): CloudCaptureRule | null {
    return null;
  }

  /** 账密/短信表单字段（httpPassword/smsPassword）。 */
  get loginFields(): CloudLoginField[] {
    return [];
  }

  /** 直链默认 TTL（实现未给 expireAt 时 directLinkCache 兜底），毫秒。 */
  get directLinkTtl(): number {
    return 30 * 60 * 1000;
  }

  /** 浏览页根目录的 path 表示（各盘语义不同：'/'、'root'、'0'、'-11'…）。 */
  get rootPath(): string {
    return '/';
  }

  // ── 登录 ──────────────────────────────────────────────

  /** WebView 捕获结果 → 账号（webviewCookie/webviewToken 必须实现）。 */
  async completeLogin(_captured: CloudCaptureResult): Promise<CloudAccount> {
    throw new Error('该盘不支持 WebView 登录');
  }

  /** 表单登录（httpPassword/smsPassword 必须实现）。 */
  async loginWithFields(_fields: Record<string, string>): Promise<CloudAccount> {
    throw new Error('该盘不支持账密登录');
  }

  /** 发送短信验证码（smsPassword）。 */
  async sendLoginSms(_fields: Record<string, string>): Promise<void> {
    throw new Error('该盘不支持短信验证码');
  }

  /** 提交登录短信验证码（收到 [CloudSmsRequiredException] 后由 UI 调用）。 */
  async submitSmsCode(_username: string, _smsCode: string): Promise<CloudAccount> {
    throw new Error('该盘不支持短信验证码');
  }

  /** 创建扫码会话（qrCode）。 */
  async createQrLogin(): Promise<CloudQrLoginSession> {
    throw new Error('该盘不支持扫码登录');
  }

  /** 轮询扫码结果：null=未确认；返回=成功；抛 CloudException=过期/取消。 */
  async pollQrLogin(_session: CloudQrLoginSession): Promise<CloudAccount | null> {
    throw new Error('该盘不支持扫码登录');
  }

  // ── 能力 ──────────────────────────────────────────────

  /** 凭据有效性检查：根目录轻请求。 */
  abstract validate(cred: Record<string, string>): Promise<boolean>;

  /** 列目录。path 为盘内绝对路径（'/' = 根）；cursor 翻页续传。 */
  abstract listDir(
    cred: Record<string, string>,
    path: string,
    cursor?: string | null,
  ): Promise<CloudListResult>;

  /** 分享链接解析（解析分享列表不需要登录态；需要提取码时 pwd 非空）。 */
  abstract parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse>;

  /** 转存分享文件到我的网盘，返回转存后的文件（directPlayable=false 必须实现）。 */
  async transferShareFiles(
    _cred: Record<string, string>,
    _share: CloudShareParse,
  ): Promise<CloudFile[]> {
    throw new Error('该盘不支持分享转存');
  }

  /** 我的网盘文件直链。 */
  abstract getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink>;

  /** 分享文件免转存直链（directPlayable=true 的盘实现）。 */
  async getShareDirectLink(
    _cred: Record<string, string> | null,
    _share: CloudShareParse,
    _file: CloudFile,
  ): Promise<CloudDirectLink> {
    throw new Error('该盘分享不支持免转存直链');
  }

  /** 是否支持文件名搜索（支持时搜索来源栏展示该盘）。 */
  get supportsSearch(): boolean {
    return false;
  }

  /** 全盘文件名搜索（search_files；cursor 翻页续传，语义同 listDir）。 */
  async searchFiles(
    _cred: Record<string, string>,
    _keyword: string,
    _cursor?: string | null,
  ): Promise<CloudListResult> {
    throw new Error('该盘不支持文件搜索');
  }
}
