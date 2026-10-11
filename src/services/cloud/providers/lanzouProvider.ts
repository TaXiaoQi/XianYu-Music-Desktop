// 移植自移动端 lib/src/cloud/providers/lanzou_provider.dart
// 蓝奏云 provider（httpPassword；分享免登录免转存直链
// directPlayable=true）。
//
// 接口为 HTML 页面形态，靠正则解析（域名常变，页面结构自适应尽力
// 而为）；解析出的直链直接塞 file.token，跨页传递。

import {
  asInt,
  asString,
  cloudGet,
  cloudPostForm,
  encodeQueryComponent,
  parseIntOr,
  urlHost,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
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
import { parseUrlToProvider } from '../shareLinkParser';
import { HttpLoginGate, md5Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

export class LanzouProvider extends CloudProvider {
  private _h(cookie: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Referer': 'https://pc.woozooo.com/',
    };
    if (cookie !== '') headers['Cookie'] = cookie;
    return headers;
  }

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

  override async validate(cred: Record<string, string>): Promise<boolean> {
    try {
      const resp = await cloudGet(
        'https://pc.woozooo.com/mydisk.php?item=files&action=index',
        { headers: this._h(cred['cookie'] ?? '') },
      );
      return resp.isOk && !resp.body.includes('mlogin');
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
      'https://pc.woozooo.com/mydisk.php?item=files&action=index' +
        (path === '' ? '' : `&f_id=${encodeQueryComponent(path)}`) +
        '&page=' +
        page,
      { headers: this._h(cred['cookie'] ?? '') },
    );
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const body = resp.body;
    const files: CloudFile[] = [];
    // 文件夹行：f_id=(\d+) 与名称就近配对（HTML 脆弱，尽力而为）。
    const folderRe = /f_id='?(\d+)'?[^>]*>[\s\S]{0,400}?class='t'>([^<]+)/g;
    for (const m of body.matchAll(folderRe)) {
      files.push(
        new CloudFile({
          id: m[1] as string,
          name: htmlUnescape(m[2] as string).trim(),
          isDir: true,
          parentId: path,
        }),
      );
    }
    // 文件行：文件页链接作为 token（后续直链复用）。
    const fileRe = /(?:https?:\/\/[a-z0-9]+\.lanzou[a-z]?\.com\/|\/fn\?)[A-Za-z0-9_.-]+/gi;
    const nameRe = /class='t'[^>]*>([^<]{1,120})<\/a>/gi;
    const names = Array.from(body.matchAll(nameRe)).map((m) => m[1] as string);
    const links = new Set<string>();
    for (const m of body.matchAll(fileRe)) {
      const raw = m[0];
      if (raw.includes('mydisk') || raw.includes('u.php')) continue;
      links.add(raw.startsWith('/') ? `https://pc.woozooo.com${raw}` : raw);
    }
    let i = 0;
    for (const link of links) {
      if (i >= names.length) break;
      const n = htmlUnescape(names[i] as string).trim();
      i += 1;
      // 只收音频扩展名；名称判后缀。
      const dot = n.lastIndexOf('.');
      if (dot < 0 || !CloudFile.audioExts.has(n.substring(dot + 1).toLowerCase())) {
        continue;
      }
      files.push(
        new CloudFile({
          id: link,
          name: n,
          token: link, // 分享页地址，getDirectLink 复用。
          parentId: path,
        }),
      );
    }
    const hasNext = files.length >= 30;
    return new CloudListResult({
      files,
      nextCursor: hasNext ? `${page + 1}` : null,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  /** 免登录免转存：每个文件解析出直链塞 token。 */
  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const shareUrl = info?.url ?? url;
    const files = await this._resolveSharePageFiles(shareUrl);
    if (files.length === 0) throw new CloudException('分享已失效');
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId: info?.shareId ?? shareUrl,
      passcode: pwd,
      directPlayable: true,
    });
  }

  override async getShareDirectLink(
    _cred: Record<string, string> | null,
    share: CloudShareParse,
    file: CloudFile,
  ): Promise<CloudDirectLink> {
    // parseShareLink 时直链已塞 file.token；直接回。
    const token = file.token ?? '';
    if (token.startsWith('http')) {
      return new CloudDirectLink({
        url: token,
        headers: { 'User-Agent': UA },
        fileName: file.name,
        size: file.size,
        expireAt: new Date(Date.now() + 20 * 60 * 1000),
      });
    }
    // token 是分享页地址 → 重新解析。
    const url = token !== '' ? token : share.shareId ?? '';
    const files = await this._resolveSharePageFiles(url);
    for (const f of files) {
      if (f.name === file.name && (f.token ?? '').startsWith('http')) {
        return new CloudDirectLink({
          url: f.token as string,
          headers: { 'User-Agent': UA },
          fileName: file.name,
          size: file.size,
          expireAt: new Date(Date.now() + 20 * 60 * 1000),
        });
      }
    }
    throw new CloudException('分享已失效');
  }

  // directPlayable=true，不支持转存。
  override async transferShareFiles(
    _cred: Record<string, string>,
    _share: CloudShareParse,
  ): Promise<CloudFile[]> {
    throw new Error('该盘分享不支持转存');
  }

  // ── 直链 ──────────────────────────────────────────────

  /** 我的网盘文件：file.token 为分享页地址（浏览页入口解析时写入）。 */
  override async getDirectLink(_cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const link = file.token ?? '';
    if (link.startsWith('http')) {
      return this._directFromSharePage(link, file.name, file.size);
    }
    throw new CloudException('直链获取失败');
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 分享页 → 子页（iframe）→ 隐含表单 → /ajaxm.php → 直链。 */
  private async _resolveSharePageFiles(shareUrl: string): Promise<CloudFile[]> {
    const page = await this._get(shareUrl);
    if (page === '') throw new CloudException('分享已失效');
    // 顶层可能是多文件页（iframe 列表）或单文件页。
    const iframeRe = /<iframe[^>]+src="([^"]+)"/gi;
    const subLinks: string[] = [];
    for (const m of page.matchAll(iframeRe)) {
      const src = m[1] as string;
      if (src.includes('file')) {
        subLinks.push(src.startsWith('//') ? `https:${src}` : src);
      }
    }
    if (subLinks.length === 0) {
      // 单文件页：直接解析出直链。
      const direct = await this._directFromPage(page, urlHost(shareUrl));
      return [
        new CloudFile({
          id: shareUrl,
          name: pageTitle(page) ?? '蓝奏云文件',
          token: direct ?? shareUrl,
        }),
      ];
    }
    const files: CloudFile[] = [];
    for (const sub of subLinks.slice(0, 30)) {
      const subPage = await this._get(sub);
      if (subPage === '') continue;
      const host = urlHost(sub);
      const direct = await this._directFromPage(subPage, host);
      files.push(
        new CloudFile({
          id: sub,
          name: pageTitle(subPage) ?? '蓝奏云文件',
          token: direct ?? sub,
        }),
      );
    }
    return files;
  }

  /** 子页隐含表单参数 → POST /ajaxm.php → dom+url 直链。 */
  private async _directFromPage(page: string, host: string): Promise<string | null> {
    // 隐含 input（name/value 顺序可反，双向匹配）。
    const pairs: Record<string, string> = {};
    const inputRe = /<input[^>]+(?:name="([^"]*)"[^>]+value="([^"]*)"|value="([^"]*)"[^>]+name="([^"]*)")/gi;
    for (const m of page.matchAll(inputRe)) {
      const name = (m[1] ?? m[4] ?? '').trim();
      const value = (m[2] ?? m[3] ?? '').trim();
      if (name === '') continue;
      pairs[name] = htmlUnescape(value);
    }
    if (Object.keys(pairs).length === 0) return null;
    const resp = await cloudPostForm(`https://${host}/ajaxm.php`, pairs, {
      headers: { 'User-Agent': UA, 'Referer': `https://${host}/` },
    });
    if (!resp.isOk) return null;
    try {
      const j = resp.json;
      const zt = asInt(j['zt']) ?? 0;
      if (zt !== 1) return null; // 分享已失效等。
      const dom = asString(j['dom'] ?? '');
      const url = asString(j['url'] ?? '');
      if (url.startsWith('http')) return url;
      if (dom !== '' && url !== '') return `${dom}${url}`;
    } catch {
      // 忽略解析失败。
    }
    return null;
  }

  private async _directFromSharePage(url: string, name: string, size: number): Promise<CloudDirectLink> {
    const page = await this._get(url);
    if (page === '') throw new CloudException('分享已失效');
    const host = urlHost(url);
    // 单文件页直接出直链；多文件页先找 iframe。
    const iframeRe = /<iframe[^>]+src="([^"]+)"/i;
    let target = page;
    let targetHost = host;
    const m = iframeRe.exec(page);
    if (m) {
      const src = m[1] as string;
      const sub = src.startsWith('//') ? `https:${src}` : src;
      target = await this._get(sub);
      targetHost = urlHost(sub) || host;
    }
    const direct = await this._directFromPage(target, targetHost);
    if (direct == null) throw new CloudException('分享已失效');
    return new CloudDirectLink({
      url: direct,
      headers: { 'User-Agent': UA },
      fileName: name,
      size,
      expireAt: new Date(Date.now() + 20 * 60 * 1000),
    });
  }

  private async _get(url: string): Promise<string> {
    try {
      const resp = await cloudGet(url, { headers: { 'User-Agent': UA } });
      return resp.isOk ? resp.body : '';
    } catch {
      return '';
    }
  }
}

function pageTitle(page: string): string | null {
  const m = /<title>([^<]{1,120})<\/title>/i.exec(page);
  if (!m) return null;
  let t = htmlUnescape(m[1] as string).trim();
  // 常见尾缀「xxx - 蓝奏云」。
  t = t.replace(/\s*[-–]\s*蓝奏云\s*$/, '');
  return t === '' ? null : t;
}

function htmlUnescape(s: string): string {
  // lib 为 ES2020（无 replaceAll），用 split/join 实现全量替换。
  return s
    .split('&amp;').join('&')
    .split('&lt;').join('<')
    .split('&gt;').join('>')
    .split('&quot;').join('"')
    .split('&#39;').join("'")
    .split('&apos;').join("'");
}
