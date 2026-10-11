// 移植自移动端 lib/src/cloud/providers/weiyun_provider.dart
// 微云 provider（webviewToken 混合：openid 走 pollScript，会话走
// Cookie）。
//
// goapi 接口字段防御式解析（接口形状不确定度高）；失败文案简短。

import {
  asArray,
  asInt,
  asRecord,
  asString,
  cloudGet,
  cloudPostJson,
  cookieHeader,
  encodeQueryComponent,
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
import { md5Hex } from './httpLoginSupport';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** goapi 统一请求头。 */
function h(cred: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Referer': 'https://www.weiyun.com/',
    'Content-Type': 'application/json',
  };
  const cookie = cred['cookie'];
  if (cookie != null && cookie !== '') {
    headers['Cookie'] = cookie;
  }
  return headers;
}

function reqHeader(): Record<string, unknown> {
  return {
    'cmd': 12001,
    'appid': '30013',
    'version': '3.9.9',
    'major_version': '3',
    'minor_version': '9',
    'fix_version': '9',
  };
}

export class WeiyunProvider extends CloudProvider {
  override get id(): string {
    return 'weiyun';
  }

  override get displayName(): string {
    return '腾讯微云';
  }

  override get rootPath(): string {
    return '';
  }

  override get loginKind(): CloudLoginKind {
    return CloudLoginKind.WebviewToken;
  }

  override get webviewLoginUrl(): string {
    return 'https://www.weiyun.com/';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      doneUrlPattern: /weiyun\.com/,
      pollScript: `(() => {
  var qq = null, wx = null;
  try { qq = localStorage.getItem('weiyun_qq_openid'); } catch (e) {}
  try { wx = localStorage.getItem('weiyun_wx_openid'); } catch (e) {}
  if ((qq && qq.length) || (wx && wx.length)) {
    return JSON.stringify({qq: qq, wx: wx});
  }
  return "";
})()`,
      pollIntervalMs: 500,
    });
  }

  // ── 登录 ──────────────────────────────────────────────

  override async completeLogin(captured: CloudCaptureResult): Promise<CloudAccount> {
    let openid = '';
    if (captured.token != null && captured.token !== '') {
      try {
        const rec = asRecord(JSON.parse(captured.token));
        if (rec) {
          openid = asString(rec['qq'] ?? rec['wx'] ?? '');
        }
      } catch {
        // token 不是合法 JSON：忽略
      }
    }
    const cookie = cookieHeader(captured.cookies);
    if (openid === '' && cookie === '') {
      throw new CloudException('未捕获到登录凭据，请重新登录');
    }
    return new CloudAccount({
      provider: this.id,
      accountId: (await md5Hex(openid === '' ? cookie : openid)).substring(0, 12),
      nickname: '腾讯微云',
      cred: { 'cookie': cookie, 'openid': openid },
      boundAt: new Date(),
    });
  }

  override async validate(cred: Record<string, string>): Promise<boolean> {
    try {
      const resp = await cloudPostJson(
        'https://weiyun.com/webapp/json/weiyunShareNetdisk/WeiyunNetdiskDirList',
        {
          body: {
            'req_header': reqHeader(),
            'req_body': {
              'dir_key': '',
              'page_index': 0,
              'sort_field': 'create_time',
              'reverse_order': true,
              'filter': 0,
              'get_abstract_url': true,
            },
          },
          headers: h(cred),
        },
      );
      if (!resp.isOk) return false;
      const header = asRecord(resp.json['resp_header']) ?? {};
      return asInt(header['retcode']) === 0 || resp.json['resp_body'] != null;
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
    const page = parseIntOr(cursor, 0);
    const resp = await cloudPostJson(
      'https://weiyun.com/webapp/json/weiyunShareNetdisk/WeiyunNetdiskDirList',
      {
        body: {
          'req_header': reqHeader(),
          'req_body': {
            'dir_key': path,
            'page_index': page,
            'sort_field': 'create_time',
            'reverse_order': true,
            'filter': 0,
            'get_abstract_url': true,
          },
        },
        headers: h(cred),
      },
    );
    if (!resp.isOk) throw new CloudException('目录列表请求失败');
    const body = asRecord(resp.json['resp_body']) ?? {};
    const dirList = asArray(body['dir_list']);
    const fileList = asArray(body['file_list']);
    const files: CloudFile[] = [];
    for (const item of dirList) {
      const e = asRecord(item);
      if (!e) continue;
      // 目录 id：dir_key 优先，file_id 兜底。
      files.push(
        new CloudFile({
          id: asString(e['dir_key'] ?? e['file_id'] ?? ''),
          name: asString(e['file_name'] ?? e['dir_name'] ?? ''),
          isDir: true,
          parentId: path,
        }),
      );
    }
    for (const item of fileList) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['file_id'] ?? ''),
          name: asString(e['file_name'] ?? ''),
          isDir: false,
          size: asInt(e['file_size']) ?? 0,
          parentId: path,
        }),
      );
    }
    const hasNext = dirList.length + fileList.length >= 60;
    return new CloudListResult({
      files,
      nextCursor: hasNext ? `${page + 1}` : null,
    });
  }

  // ── 分享 ──────────────────────────────────────────────

  override async parseShareLink(url: string, pwd: string | null): Promise<CloudShareParse> {
    const info = parseUrlToProvider(url);
    const shareKey = info?.shareId ?? url;
    // 分享页提取 shareKey 兜底（页面 JS 变量，脆弱）。
    let key = shareKey;
    try {
      const page = await cloudGet(`https://share.weiyun.com/${encodeQueryComponent(shareKey)}`, {
        headers: { 'User-Agent': UA },
      });
      if (page.isOk) {
        const m = /"share_key"\s*:\s*"([^"]+)"/.exec(page.body);
        if (m) key = m[1] ?? key;
      }
    } catch {
      // 分享页拉取失败：沿用原始 key
    }
    const resp = await cloudPostJson(
      'https://weiyun.com/webapp/json/weiyunShare/WeiyunShareQuery',
      {
        body: {
          'req_header': reqHeader(),
          'req_body': { 'share_key': key, 'pwd': pwd ?? '' },
        },
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      },
    );
    if (!resp.isOk) throw new CloudException('微云分享解析失败，请转存后播放');
    const body = asRecord(resp.json['resp_body']) ?? {};
    const list = asArray(body['list']);
    const files: CloudFile[] = [];
    for (const item of list) {
      const e = asRecord(item);
      if (!e) continue;
      files.push(
        new CloudFile({
          id: asString(e['file_id'] ?? ''),
          name: asString(e['file_name'] ?? ''),
          isDir: e['is_dir'] === true,
          size: asInt(e['file_size']) ?? 0,
        }),
      );
    }
    return new CloudShareParse({
      providerId: this.id,
      files,
      shareId: key,
      passcode: pwd,
      directPlayable: false,
    });
  }

  override async transferShareFiles(
    cred: Record<string, string>,
    share: CloudShareParse,
  ): Promise<CloudFile[]> {
    const resp = await cloudPostJson(
      'https://weiyun.com/webapp/json/weiyunNetdiskClient/CopySaveFile',
      {
        body: {
          'req_header': reqHeader(),
          'req_body': {
            'share_key': share.shareId,
            'pwd': share.passcode ?? '',
            'file_list': share.files.map((f) => ({
              'file_id': f.id,
              'file_name': f.name,
              'is_dir': f.isDir,
            })),
          },
        },
        headers: h(cred),
      },
    );
    if (!resp.isOk) throw new CloudException('转存失败');
    // 接口不保证回新 id；返回原 files（防御式兜底）。
    return share.files;
  }

  // ── 直链 ──────────────────────────────────────────────

  override async getDirectLink(cred: Record<string, string>, file: CloudFile): Promise<CloudDirectLink> {
    const resp = await cloudPostJson(
      'https://weiyun.com/webapp/json/weiyunNetdiskClient/WebdiskDownloadRedirect',
      {
        body: {
          'req_header': reqHeader(),
          'req_body': { 'file_id': file.id },
        },
        headers: h(cred),
      },
    );
    if (!resp.isOk) throw new CloudException('直链获取失败');
    const body = asRecord(resp.json['resp_body']) ?? {};
    const url = asString(body['download_url'] ?? '');
    if (url === '') throw new CloudException('直链获取失败');
    return new CloudDirectLink({
      url,
      headers: { 'User-Agent': UA, 'Cookie': cred['cookie'] ?? '' },
      fileName: file.name,
      size: file.size,
      expireAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  }
}
