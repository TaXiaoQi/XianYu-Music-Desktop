// 移植自移动端 lib/src/cloud/providers/mobile139_provider.dart
// 移动云盘（139）provider（webviewCookie：登录页 Cookie 全收）。
//
// 桌面端无 WebView 登录：completeLogin 引导去手机端绑定，凭据走云同步。
// 分享走 outLink 免转存直链（directPlayable=true）；目录与个人盘
// 接口为 orchestration JSON 形态。

import {
  asArray,
  asInt,
  asRecord,
  asString,
  cloudPostJson,
  parseIntOr,
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

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class Mobile139Provider extends CloudProvider {
  private _h(cookie: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Referer': 'https://yun.139.com/',
      'Content-Type': 'application/json',
    };
    if (cookie !== '') headers['Cookie'] = cookie;
    return headers;
  }

  override get id(): string {
    return 'mobile139';
  }

  override get displayName(): string {
    return '移动云盘';
  }

  override get rootPath(): string {
    return 'root';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.WebviewCookie;
  }

  override get webviewLoginUrl(): string {
    return 'https://yun.139.com/';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      // 全收（cookieNames 空 = 非空即采），登录完成由 URL 判定。
      doneUrlPattern: /yun\.139\.com/,
      pollIntervalMs: 500,
    });
  }

  // ── 登录 ──────────────────────────────────────────────

  override async completeLogin(_captured: CloudCaptureResult): Promise<CloudAccount> {
    throw new Error('该盘需在手机端网页登录');
  }

  override async validate(cred: Record<string, string>): Promise<boolean> {
    try {
      const resp = await cloudPostJson('https://personal-kd-njs.yun.139.com/hcy/file/list', {
        body: {
          'parentCatalogId': 'root',
          'catalogType': 3,
          'pageBean': { 'pageNum': 1, 'pageSize': 1 },
        },
        headers: this._h(cred['cookie'] ?? ''),
      });
      if (!resp.isOk) return false;
      return (asInt(resp.json['status']) ?? -1) === 0 || resp.json['success'] === true;
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
    const start = parseIntOr(cursor, 1);
    const resp = await cloudPostJson(
      'https://yun.139.com/orchestration/personalCloud/catalog/listContents',
      {
        body: {
          'parentCatalogId': path,
          'catalogType': 3,
          'contentListType': 1,
          'sortDirection': 1,
          'startNumber': start,
          'endNumber': start + 100,
          'filter': 0,
        },
        headers: this._h(cred['cookie'] ?? ''),
      },
    );
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const data = asRecord(resp.json['data']);
    const list = asArray(data?.['contentList']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['contentId'] ?? ''),
          name: asString(e['contentName'] ?? ''),
          isDir: asInt(e['isCatalog']) === 1,
          size: asInt(e['contentSize']) ?? 0,
          parentId: asString(e['parentCatalogId'] ?? path),
        }),
      );
    }
    const hasNext = files.length >= 100;
    return new CloudListResult({
      files,
      nextCursor: hasNext ? `${start + 100}` : null,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const guid = info?.shareId ?? url;
    const resp = await cloudPostJson(
      'https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6',
      {
        body: {
          'outLinkGUID': guid,
          'passcode': pwd ?? '',
        },
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      },
    );
    if (!resp.isOk) throw new CloudException('分享链接解析失败');
    const data = asRecord(resp.json['data']);
    const outLink = data ? asRecord(data['outLinkInfo']) : null;
    const list = asArray(outLink?.['fileList']);
    if (list.length === 0) throw new CloudException('分享已失效');
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['contentId'] ?? ''),
          name: asString(e['contentName'] ?? ''),
          isDir: asInt(e['isCatalog']) === 1,
          size: asInt(e['contentSize']) ?? 0,
        }),
      );
    }
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId: guid,
      passcode: pwd,
      directPlayable: true,
    });
  }

  /** 分享免转存直链（dlFromOutLinkV3）。 */
  override async getShareDirectLink(
    _cred: Record<string, string> | null,
    share: CloudShareParse,
    file: CloudFile,
  ): Promise<CloudDirectLink> {
    const resp = await cloudPostJson(
      'https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/dlFromOutLinkV3',
      {
        body: {
          'outLinkGUID': share.shareId,
          'passcode': share.passcode ?? '',
          'fileIds': [file.id],
        },
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      },
    );
    if (!resp.isOk) throw new CloudException('分享直链获取失败');
    const data = asRecord(resp.json['data']);
    const fileList = asArray(data?.['fileList']);
    if (fileList.length === 0) throw new CloudException('分享直链获取失败');
    const url = asString(asRecord(fileList[0])?.['downloadUrl'] ?? '');
    if (url === '') throw new CloudException('分享直链获取失败');
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': UA },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  }

  /** best-effort 转存（139 分享本可直链，转存作为留档兜底）。 */
  override async transferShareFiles(
    cred: Record<string, string>,
    share: CloudShareParse,
  ): Promise<CloudFile[]> {
    try {
      await cloudPostJson(
        'https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IBatchOprTask/createOuterLinkBatchOprTask',
        {
          body: {
            'outLinkGUID': share.shareId,
            'passcode': share.passcode ?? '',
            'taskType': 2,
            'fileIds': share.files.map((f) => f.id),
          },
          headers: this._h(cred['cookie'] ?? ''),
        },
      );
    } catch {
      // best-effort，忽略。
    }
    return share.files;
  }

  // ── 直链 ──────────────────────────────────────────────

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const resp = await cloudPostJson('https://personal-kd-njs.yun.139.com/hcy/file/getDownloadUrl', {
      body: {
        'contentId': file.id,
        'catalogType': 3,
      },
      headers: this._h(cred['cookie'] ?? ''),
    });
    if (!resp.isOk) throw new CloudException('直链获取失败');
    const url = asString(asRecord(resp.json['data'])?.['downloadUrl'] ?? '');
    if (url === '') throw new CloudException('直链获取失败');
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': UA },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  }
}
