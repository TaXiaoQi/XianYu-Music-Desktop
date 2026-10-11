// 移植自移动端 lib/src/cloud/providers/quark_provider.dart
// 夸克网盘：继承 QuarkUcBase，仅声明品牌常量与免速直链兜底路由。

import {
  asRecord,
  asString,
  cloudPostJson,
  encodeQueryComponent,
  strOrNull,
} from '../cloudHttp';
import {
  CloudCaptureRule,
  CloudDirectLink,
  CloudException,
  CloudFile,
} from '../cloudTypes';
import { QuarkUcBase } from './quarkUcBase';

export class QuarkProvider extends QuarkUcBase {
  override get id(): string {
    return 'quark';
  }

  override get displayName(): string {
    return '夸克网盘';
  }

  override get apiHost(): string {
    return 'drive-pc.quark.cn';
  }

  override get webHost(): string {
    return 'pan.quark.cn';
  }

  override get pr(): string {
    return 'quark';
  }

  override get uaBrand(): string {
    return 'quark-cloud-drive';
  }

  override get webviewLoginUrl(): string {
    return 'https://passport.quark.cn/login';
  }

  override get captureRule(): CloudCaptureRule {
    return new CloudCaptureRule({
      cookieNames: ['kps', 'sign'],
      cookieDomains: ['pan.quark.cn', 'passport.quark.cn'],
      pollIntervalMs: 500,
    });
  }

  /** 免速兜底路由：fast-transfer sendToPC 通道（按竞品抓包推测；
   * route1 失败后 best-effort，任何异常吞掉归一为直链失败）。 */
  override async directLinkRoute2(
    cred: Record<string, string>,
    file: CloudFile,
  ): Promise<CloudDirectLink> {
    try {
      const tokResp = await cloudPostJson(
        'https://drive-social-api.quark.cn/1/clouddrive/chat/conv/file/acquire_dl_token?pr=quark&fr=pc',
        { body: { 'file_id': file.id }, headers: this.authHeaders(cred) },
      );
      const dlToken = asString(asRecord(tokResp.json['data'])?.['dl_token'] ?? '');
      if (dlToken === '') throw new CloudException('直链获取失败');
      const resp = await cloudPostJson(
        `https://${this.apiHost}/1/clouddrive/file/download?${this.commonQuery}` +
          '&dl_token=' +
          encodeQueryComponent(dlToken),
        { body: { 'fids': [file.id] }, headers: this.authHeaders(cred) },
      );
      const data: unknown = resp.json['data'];
      let url: string | null;
      if (Array.isArray(data) && data.length > 0) {
        url = strOrNull(asRecord(data[0])?.['download_url']);
      } else {
        url = strOrNull(asRecord(data)?.['download_url']);
      }
      if (url == null || url === '') throw new CloudException('直链获取失败');
      return new CloudDirectLink({
        url,
        headers: { 'User-Agent': this.desktopUa, 'Referer': `https://${this.webHost}/` },
        fileName: file.name,
        size: file.size,
        expireAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      });
    } catch (e) {
      if (e instanceof CloudException) throw e;
      throw new CloudException('直链获取失败');
    }
  }
}
