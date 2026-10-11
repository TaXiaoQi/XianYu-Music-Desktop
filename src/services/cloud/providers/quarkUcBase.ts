// 移植自移动端 lib/src/cloud/providers/quark_uc_base.dart
// 夸克 / UC 网盘共用实现（两家同为阿里系 XCloud 架构，接口同构）。
//
// 桌面端无 WebView 登录：completeLogin 引导去手机端绑定，凭据走云同步。
// 登录：WebView 捕获 kps/sign Cookie；列目录/分享/转存/直链接口形状
// 一致，仅域名与 UA 品牌串不同。子类只声明常量。

import {
  asArray,
  asInt,
  asRecord,
  asString,
  cloudGet,
  cloudPostJson,
  cookieHeader,
  delay,
  encodeQueryComponent,
  parseIntOr,
  strOrNull,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
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
import { parseUrlToProvider } from '../shareLinkParser';

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

  /** 带凭据的通用请求头（子类兜底路由也用）。 */
  authHeaders(cred: Record<string, string>): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        `${this.uaBrand}/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.12-a038f7b798 ` +
        'Safari/537.36 Channel/pckk_other_ch',
      'Referer': `https://${this.webHost}/`,
      'Cookie': cookieHeader(cred),
    };
  }

  /** 桌面版浏览器 UA（分享/直链请求用）。 */
  get desktopUa(): string {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
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

  // ── 登录 ──────────────────────────────────────────────

  override async completeLogin(_captured: CloudCaptureResult): Promise<CloudAccount> {
    throw new Error('该盘需在手机端网页登录');
  }

  override async validate(cred: Record<string, string>): Promise<boolean> {
    try {
      const resp = await cloudGet(
        `https://${this.apiHost}/1/clouddrive/member?${this.commonQuery}`,
        { headers: this.authHeaders(cred) },
      );
      return resp.status === 200;
    } catch {
      return false;
    }
  }

  // ── 目录 ──────────────────────────────────────────────

  override async listDir(
    cred: Record<string, string>,
    path: string,
    cursor?: string | null,
  ): Promise<CloudListResult> {
    const page = parseIntOr(cursor, 1);
    const resp = await cloudGet(
      `https://${this.apiHost}/1/clouddrive/file?${this.commonQuery}` +
        '&_page=' +
        page +
        '&_size=100&pdir_fid=' +
        encodeQueryComponent(path) +
        '&_sort=file_type:asc,file_name:asc',
      { headers: this.authHeaders(cred) },
    );
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const data = asRecord(resp.json['data']);
    const list = asArray(data?.['list']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['fid'] ?? ''),
          name: asString(e['file_name'] ?? ''),
          isDir: e['dir'] === true || e['dir'] === 1,
          size: asInt(e['size']) ?? 0,
          parentId: asString(e['pdir_fid'] ?? ''),
          path,
          token: strOrNull(e['fid_token']),
        }),
      );
    }
    const total = asInt(data?.['_total']) ?? 0;
    const hasNext = page * 100 < total;
    return new CloudListResult({
      files,
      nextCursor: hasNext ? `${page + 1}` : null,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const pwdId = info?.shareId ?? url;
    // 换 stoken（提取码错误时接口直接报）。
    const tokenResp = await cloudPostJson(
      `https://${this.apiHost}/1/clouddrive/share/sharepage/token?${this.commonQuery}`,
      {
        body: { 'pwd_id': pwdId, 'passcode': pwd ?? '' },
        headers: { 'User-Agent': this.desktopUa, 'Referer': `https://${this.webHost}/` },
      },
    );
    if (!tokenResp.isOk) {
      throw new CloudException('分享链接解析失败');
    }
    const tj = tokenResp.json;
    const stoken = asString(asRecord(tj['data'])?.['stoken'] ?? '');
    if (stoken === '') {
      throw new CloudException(asString(tj['message'] ?? '提取码错误'));
    }
    const resp = await cloudGet(
      `https://${this.apiHost}/1/clouddrive/share/sharepage/detail?${this.commonQuery}` +
        '&pwd_id=' +
        encodeQueryComponent(pwdId) +
        '&stoken=' +
        encodeQueryComponent(stoken) +
        '&pdir_fid=0&_page=1&_size=100' +
        '&_sort=file_type:asc,file_name:asc',
      { headers: this.authHeaders({}) },
    );
    if (!resp.isOk) throw new CloudException('分享文件列表获取失败');
    const data = asRecord(resp.json['data']);
    const list = asArray(data?.['list']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['fid'] ?? e['share_fid'] ?? ''),
          name: asString(e['file_name'] ?? ''),
          isDir: e['dir'] === true || e['dir'] === 1,
          size: asInt(e['size']) ?? 0,
          token: strOrNull(e['fid_token']),
        }),
      );
    }
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId: pwdId,
      shareToken: stoken,
      passcode: pwd,
      directPlayable: true,
    });
  }

  /** 分享免转存直链（夸克/UC 分享页下载接口）。 */
  override async getShareDirectLink(
    cred: Record<string, string> | null,
    share: CloudShareParse,
    file: CloudFile,
  ): Promise<CloudDirectLink> {
    const resp = await cloudPostJson(
      `https://${this.apiHost}/1/clouddrive/share/sharepage/download?${this.commonQuery}`,
      {
        body: {
          'pwd_id': share.shareId,
          'stoken': share.shareToken,
          'fids': [file.id],
        },
        headers: this.authHeaders(cred ?? {}),
      },
    );
    if (!resp.isOk) throw new CloudException('分享直链获取失败');
    const url = this._extractDownloadUrl(resp.json['data']);
    if (url == null || url === '') throw new CloudException('分享直链获取失败');
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': this.desktopUa, 'Referer': `https://${this.webHost}/` },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
  }

  /** 转存 → 轮询任务 → 完成后按文件名回查新 fid（转存后 fid 会变）。 */
  override async transferShareFiles(
    cred: Record<string, string>,
    share: CloudShareParse,
  ): Promise<CloudFile[]> {
    const saveResp = await cloudPostJson(
      `https://${this.apiHost}/1/clouddrive/share/sharepage/save?${this.commonQuery}`,
      {
        body: {
          'to_pdir_fid': '0',
          'fid_list': share.files.map((f) => f.id),
          'fid_token_list': share.files.map((f) => f.token ?? ''),
          'pwd_id': share.shareId,
          'stoken': share.shareToken,
        },
        headers: this.authHeaders(cred),
      },
    );
    if (!saveResp.isOk) throw new CloudException('转存请求失败');
    const taskId = asString(asRecord(saveResp.json['data'])?.['task_id'] ?? '');
    if (taskId === '') throw new CloudException('转存失败');
    for (let i = 0; i < 30; i++) {
      await delay(800);
      const tResp = await cloudGet(
        `https://${this.apiHost}/1/clouddrive/task?${this.commonQuery}` +
          '&task_id=' +
          encodeQueryComponent(taskId) +
          '&retry_index=' +
          i,
        { headers: this.authHeaders(cred) },
      );
      if (!tResp.isOk) continue;
      const status = asInt(asRecord(tResp.json['data'])?.['status']);
      if (status === 2) break;
      if (status != null && status >= 3) throw new CloudException('转存失败');
    }
    // 按文件名回查新 fid。
    const listed = await this.listDir(cred, '0');
    const byName = new Map(listed.files.map((f) => [f.name, f]));
    const out: CloudFile[] = [];
    for (const f of share.files) {
      const hit = byName.get(f.name);
      if (hit != null) {
        out.push(
          new CloudFile({
            id: hit.id,
            name: hit.name,
            isDir: hit.isDir,
            size: hit.size,
            parentId: hit.parentId,
            path: hit.path,
            token: hit.token,
          }),
        );
      }
    }
    if (out.length === 0) throw new CloudException('转存失败');
    return out;
  }

  // ── 直链 ──────────────────────────────────────────────

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    try {
      return await this._directLinkRoute1(cred, file);
    } catch (e) {
      if (e instanceof CloudException) {
        return this.directLinkRoute2(cred, file);
      }
      throw e;
    }
  }

  private async _directLinkRoute1(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const resp = await cloudPostJson(
      `https://${this.apiHost}/1/clouddrive/file/download?${this.commonQuery}`,
      {
        body: { 'fids': [file.id] },
        headers: this.authHeaders(cred),
      },
    );
    if (!resp.isOk) throw new CloudException('直链获取失败');
    const url = this._extractDownloadUrl(resp.json['data']);
    if (url == null || url === '') throw new CloudException('直链获取失败');
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': this.desktopUa, 'Referer': `https://${this.webHost}/` },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
  }

  /** data 形态兼容：List[0].download_url / Map.download_url。 */
  private _extractDownloadUrl(data: unknown): string | null {
    if (Array.isArray(data) && data.length > 0) {
      return strOrNull(asRecord(data[0])?.['download_url']);
    }
    const rec = asRecord(data);
    if (rec) return strOrNull(rec['download_url']);
    return null;
  }

  /** 免速兜底路由（夸克覆写；UC 无此通道，默认直接抛）。 */
  directLinkRoute2(_cred: Record<string, string>, _file: CloudFile): Promise<CloudDirectLink> {
    throw new CloudException('直链获取失败');
  }
}
