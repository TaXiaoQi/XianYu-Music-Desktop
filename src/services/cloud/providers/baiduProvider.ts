// 移植自移动端 lib/src/cloud/providers/baidu_provider.dart
// 百度网盘 provider（webviewCookie：BDUSS/STOKEN）。
//
// 桌面端无 WebView 登录：completeLogin 引导去手机端绑定，凭据走云同步。
// 注意：分享列表/转存接口必须带登录态（BDUSS），故 parseShareLink 内
// 直接读本地绑定凭据；转存的 sekey 是 verify 换来的 randsk（BDCLND），
// 不是提取码本身。

import { CloudCredentialsStore } from '../cloudCredentialsStore';
import {
  asArray,
  asInt,
  asRecord,
  asString,
  cloudGet,
  cloudPostForm,
  cookieHeader,
  encodeQueryComponent,
  parseIntOr,
  resolveFinalUrl,
  urlHost,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
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
import { parseUrlToProvider } from '../shareLinkParser';

const APP_ID = '250528';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class BaiduProvider extends CloudProvider {
  private _h(cred: Record<string, string>): Record<string, string> {
    return {
      'User-Agent': UA,
      'Referer': 'https://pan.baidu.com/disk/main',
      'Cookie': cookieHeader(cred),
    };
  }

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
    return CloudLoginKind.WebviewCookie;
  }

  override get directLinkTtl(): number {
    return 8 * 60 * 60 * 1000;
  }

  override get webviewLoginUrl(): string {
    return 'https://pan.baidu.com/';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      cookieNames: ['BDUSS', 'STOKEN'],
      cookieDomains: ['pan.baidu.com'],
      doneUrlPattern: /pan\.baidu\.com\/(disk|main|share)/,
      pollIntervalMs: 500,
    });
  }

  // ── 登录 ──────────────────────────────────────────────

  override async completeLogin(_captured: CloudCaptureResult): Promise<CloudAccount> {
    throw new Error('该盘需在手机端网页登录');
  }

  override async validate(cred: Record<string, string>): Promise<boolean> {
    try {
      const resp = await cloudGet(
        'https://pan.baidu.com/api/quota?checkfree=1&checkexpire=1&clienttype=0&app_id=' +
          APP_ID +
          '&web=1',
        { headers: this._h(cred) },
      );
      if (!resp.isOk) return false;
      return asInt(resp.json['errno']) === 0;
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
    const dir = path === '/' ? '/' : path;
    const resp = await cloudGet(
      'https://pan.baidu.com/api/list?clienttype=0&app_id=' +
        APP_ID +
        '&web=1&order=name&desc=0&dir=' +
        encodeQueryComponent(dir) +
        '&limit=100&page=' +
        page,
      { headers: this._h(cred) },
    );
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const errno = asInt(resp.json['errno']);
    if (errno !== 0) throw new CloudException('目录列表请求失败');
    const list = asArray(resp.json['list']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['fs_id'] ?? ''),
          name: asString(e['server_filename'] ?? ''),
          isDir: asInt(e['isdir']) === 1,
          size: asInt(e['size']) ?? 0,
          parentId: asString(e['parent_path'] ?? ''),
          path: asString(e['path'] ?? ''),
        }),
      );
    }
    const hasNext = files.length >= 100;
    return new CloudListResult({
      files,
      nextCursor: hasNext ? `${page + 1}` : null,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const surl = info?.shareId ?? url;
    // verify 换 randsk（BDCLND）；无提取码的分享 verify 也走一遍拿空 sekey。
    let randsk = '';
    const verifyResp = await cloudPostForm(
      'https://pan.baidu.com/share/verify?surl=' +
        surl +
        '&t=' +
        Date.now() +
        '&channel=chunlei&clienttype=0&web=1&app_id=' +
        APP_ID,
      { pwd: pwd ?? '' },
      { headers: this._h(await this._soleCredOrThrow()) },
    );
    if (verifyResp.isOk) {
      const errno = asInt(verifyResp.json['errno']);
      if (errno === 0) {
        randsk = asString(asRecord(verifyResp.json['data'])?.['randsk'] ?? '');
      }
      const fromCookie = verifyResp.setCookiePairs['BDCLND'];
      if (randsk === '' && fromCookie != null && fromCookie !== '') {
        randsk = decodeURIComponent(fromCookie);
      }
    }
    const cred = await this._soleCredOrThrow();
    const cookie =
      cookieHeader(cred) + (randsk === '' ? '' : `; BDCLND=${encodeQueryComponent(randsk)}`);
    const listResp = await cloudGet(
      'https://pan.baidu.com/share/list?clienttype=0&app_id=' +
        APP_ID +
        '&web=1&shorturl=' +
        encodeQueryComponent(surl) +
        '&root=1',
      {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://pan.baidu.com/',
          'Cookie': cookie,
        },
      },
    );
    if (!listResp.isOk) throw new CloudException('分享文件列表获取失败');
    const errno = asInt(listResp.json['errno']);
    if (errno === -9 || errno === -105) {
      throw new CloudException('需要提取码');
    }
    if (errno !== 0) throw new CloudException('分享已失效');
    const list = asArray(listResp.json['list']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['fs_id'] ?? ''),
          name: asString(e['server_filename'] ?? e['filename'] ?? ''),
          isDir: asInt(e['isdir']) === 1,
          size: asInt(e['size']) ?? 0,
          path: asString(e['path'] ?? ''),
          // token 存 `<shareid>:<from>`，转存时用。
          token: `${asString(e['share_id'] ?? '')}:${asString(e['from'] ?? '')}`,
        }),
      );
    }
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId: surl,
      shareToken: randsk,
      passcode: pwd,
      directPlayable: false,
    });
  }

  override async transferShareFiles(
    cred: Record<string, string>,
    share: CloudShareParse,
  ): Promise<CloudFile[]> {
    // 先确保转存目录存在（目录已存在不报错）。
    await this._ensureDir(cred);
    const sekey = share.shareToken ?? '';
    if (sekey === '') throw new CloudException('请先填写提取码');
    const from =
      share.files.length > 0 ? (share.files[0].token ?? ':').split(':').pop() ?? '' : '';
    const transferResp = await cloudPostForm(
      'https://pan.baidu.com/share/transfer?shareid=&from=' +
        encodeQueryComponent(from) +
        '&sekey=' +
        encodeQueryComponent(sekey) +
        '&ondup=new&async=1&channel=chunlei&clienttype=0&web=1&app_id=' +
        APP_ID,
      {
        'path': '/apps/弦予音乐',
        'filelist': JSON.stringify(share.files.map((f) => f.id)),
      },
      {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://pan.baidu.com/',
          'Cookie': cookieHeader(cred),
        },
      },
    );
    if (!transferResp.isOk) throw new CloudException('转存失败');
    const errno = asInt(transferResp.json['errno']);
    if (errno !== 0) throw new CloudException('转存失败：文件可能已存在或超限');
    const infos = asArray(transferResp.json['info']);
    const out: CloudFile[] = [];
    const byFsId = new Map(share.files.map((f) => [f.id, f]));
    for (const item of infos) {
      const e = asRecord(item);
      if (!e) continue;
      const newId = asString(e['to_fs_id'] ?? '');
      const oldId = asString(e['from_fs_id'] ?? '');
      const src = byFsId.get(oldId);
      if (newId === '') continue;
      out.push(
        new CloudFile({
          id: newId,
          name: src?.name ?? '',
          isDir: src?.isDir ?? false,
          size: src?.size ?? 0,
          path: `/apps/弦予音乐/${src?.name ?? ''}`,
        }),
      );
    }
    if (out.length === 0) throw new CloudException('转存失败：文件可能已存在或超限');
    return out;
  }

  /** 确保转存目标目录存在并返回 bdstoken。 */
  private async _ensureDir(cred: Record<string, string>): Promise<string> {
    const tplResp = await cloudGet(
      'https://pan.baidu.com/api/gettemplatevariable?clienttype=0&app_id=' +
        APP_ID +
        '&web=1&fields=["bdstoken"]',
      { headers: this._h(cred) },
    );
    let bdstoken = '';
    if (tplResp.isOk) {
      bdstoken = asString(asRecord(tplResp.json['result'])?.['bdstoken'] ?? '');
    }
    const createResp = await cloudPostForm(
      'https://pan.baidu.com/api/create?a=commit&channel=chunlei&web=1&app_id=' +
        APP_ID +
        '&clienttype=0',
      {
        'path': '/apps/弦予音乐',
        'isdir': '1',
        'block_list': '[]',
        'bdstoken': bdstoken,
      },
      { headers: this._h(cred) },
    );
    const errno = createResp.isOk ? asInt(createResp.json['errno']) : -1;
    if (errno !== 0 && errno !== 12 && errno !== -8) {
      // 12/-8 = 目录已存在，可继续。
      throw new CloudException('创建转存目录失败');
    }
    return bdstoken;
  }

  // ── 直链 ──────────────────────────────────────────────

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const metaResp = await cloudGet(
      'https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&dlink=1&fsids=' +
        encodeQueryComponent(`[${file.id}]`) +
        '&clienttype=0&app_id=' +
        APP_ID +
        '&web=1',
      { headers: this._h(cred) },
    );
    if (!metaResp.isOk) throw new CloudException('直链获取失败');
    const list = asArray(metaResp.json['list']);
    if (list.length === 0) throw new CloudException('直链获取失败');
    const dlink = asString(asRecord(list[0])?.['dlink'] ?? '');
    if (dlink === '') throw new CloudException('直链获取失败');
    const finalUrl = await resolveFinalUrl(dlink, { 'User-Agent': 'netdisk' });
    const host = urlHost(finalUrl);
    if (host.includes('d2-ant') || host.includes('speed-limited')) {
      throw new CloudException('该文件被限速，暂无法播放');
    }
    return new CloudDirectLink({
      url: finalUrl,
      headers: {
        'User-Agent': 'netdisk;P2SP;2.2.91.136;android-android',
      },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });
  }

  /** 分享列表/转存需要登录态；未绑定直接报。 */
  private async _soleCredOrThrow(): Promise<Record<string, string>> {
    const cred = await CloudCredentialsStore.instance.soleCredFor(this.id);
    if (cred == null) throw new CloudException('请先绑定百度网盘');
    return cred;
  }
}
