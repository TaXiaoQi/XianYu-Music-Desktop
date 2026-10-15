// 移植自移动端 lib/src/cloud/providers/lanzou_provider.dart
// 蓝奏云 provider（httpPassword；分享免登录免转存直链
// directPlayable=true）。
//
// 登录链留在 TS；业务（列目录/分享/直链）经 cloudRemote 桥转发内嵌
// Rust（src-tauri/src/cloud/lanzou.rs）。

import {
  encodeQueryComponent,
  getHeader,
  splitSetCookieValues,
} from '../cloudHttp';
import { CloudProvider } from '../cloudProvider';
import { rustDirectLink, rustListDir, rustParseShare, rustShareDirectLink, rustTransferShare, rustValidate } from '../cloudRemote';
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
import { HttpLoginGate, md5Hex } from './httpLoginSupport';
import { pluginApi } from '../../tauri/pluginApi';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

// up.woozooo.com 前置阿里云盾 acw_sc__v2 挑战：无 Cookie 的请求一律返回
// 混淆 JS（含 arg1），算出 Cookie 重放才是真实接口。算法公开：arg1 按固定
// 重排表换位，再与固定 key 逐字节异或。2026-10 实测（对齐移动端）。
const ACW_KEY = '3000176000856006061501533003690027800375';
const ACW_ORDER = [
  0x0f, 0x23, 0x1d, 0x18, 0x21, 0x10, 0x01, 0x26, 0x0a, 0x09, //
  0x13, 0x1f, 0x28, 0x1b, 0x16, 0x17, 0x19, 0x0d, 0x06, 0x0b, //
  0x27, 0x12, 0x14, 0x08, 0x0e, 0x15, 0x20, 0x1a, 0x02, 0x1e, //
  0x07, 0x04, 0x11, 0x05, 0x03, 0x1c, 0x22, 0x25, 0x0c, 0x24,
];

function acwArg(body: string): string | null {
  return /arg1='([0-9A-Fa-f]{30,60})'/.exec(body)?.[1] ?? null;
}

function acwSolve(arg1: string): string {
  const q = new Array<string>(ACW_ORDER.length).fill('');
  for (let x = 0; x < arg1.length; x++) {
    for (let z = 0; z < ACW_ORDER.length; z++) {
      if (ACW_ORDER[z] === x + 1) q[z] = arg1[x]!;
    }
  }
  const u = q.join('');
  let v = '';
  for (let i = 0; i < u.length && i < ACW_KEY.length; i += 2) {
    const a = parseInt(u.slice(i, i + 2), 16);
    const b = parseInt(ACW_KEY.slice(i, i + 2), 16);
    v += ((a ^ b) & 0xff).toString(16).padStart(2, '0');
  }
  return v;
}

/** follow=0 逐跳采 Set-Cookie 的表单 POST（对齐移动端 appRequest 手动
 * 重定向语义：303/302 非 GET 降级 GET 丢 body、逐跳同一组请求头）。
 * 登录成功响应在 302 跳转上 Set-Cookie ylogin，代理只暴露最终跳响应头，
 * 这里逐跳采齐。 */
async function postFormCollectCookies(
  url: string,
  form: Record<string, string>,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; setCookies: string[] }> {
  let current = url;
  let m = 'POST';
  let bodyStr = Object.entries(form)
    .map(([k, v]) => `${encodeQueryComponent(k)}=${encodeQueryComponent(v)}`)
    .join('&');
  const setCookies: string[] = [];
  for (let hop = 0; hop <= 5; hop++) {
    const resp = await pluginApi.pluginHttpRequest(m, current, headers, bodyStr, 15000, 0);
    for (const [name, value] of Object.entries(resp.headers ?? {})) {
      if (name.toLowerCase() === 'set-cookie') {
        setCookies.push(...splitSetCookieValues(String(value)));
      }
    }
    const status = Number(resp.status);
    if (status >= 300 && status < 400) {
      const loc = getHeader(resp.headers ?? {}, 'location');
      if (loc == null || loc === '') {
        throw new CloudException('网络请求失败: 重定向缺少 Location');
      }
      if (hop === 5) {
        throw new CloudException('网络请求失败: 重定向次数超限');
      }
      if (status === 303 || (status === 302 && m !== 'GET')) {
        m = 'GET';
        bodyStr = '';
      }
      current = new URL(loc, current).toString();
      continue;
    }
    return { status, body: resp.body ?? '', setCookies };
  }
  throw new CloudException('网络请求失败: 请求未完成');
}

export class LanzouProvider extends CloudProvider {
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
      const form = {
        'task': '3',
        'uid': username,
        'pwd': password,
        'authcode': '',
      };
      const headers = { 'User-Agent': UA, 'Referer': 'https://up.woozooo.com/' };
      let resp = await postFormCollectCookies('https://up.woozooo.com/mlogin.php', form, headers);
      // WAF 挑战页：解 acw_sc__v2 后带 Cookie 重放一次。
      const arg1 = resp.status >= 200 && resp.status < 300 ? acwArg(resp.body) : null;
      if (arg1 !== null) {
        resp = await postFormCollectCookies(
          'https://up.woozooo.com/mlogin.php',
          form,
          { ...headers, 'Cookie': `acw_sc__v2=${acwSolve(arg1)}` },
        );
      }
      // 接口返回 JSON（中文为 \uXXXX 转义，不能 includes('登录成功')）。
      // 2026-10 改版：成功（zt==1）不再 Set-Cookie ylogin，会话改为
      // phpdisk_info（PC 端 mydisk.php 实测认可），uid 走 JSON id 字段。
      const pairs: Record<string, string> = {};
      for (const raw of resp.setCookies) {
        const head = raw.split(';')[0] ?? '';
        const eq = head.indexOf('=');
        if (eq <= 0) continue;
        pairs[head.slice(0, eq).trim()] = head.slice(eq + 1).trim();
      }
      let uid = '';
      let failMsg: string | null = null;
      try {
        const j: unknown = JSON.parse(resp.body);
        if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
          const obj = j as Record<string, unknown>;
          uid = obj['id'] == null ? '' : String(obj['id']);
          if (obj['zt'] !== 1) {
            const info = obj['info'] == null ? '' : String(obj['info']);
            failMsg = info === '' ? '登录失败' : info;
          }
        }
      } catch {
        /* 非 JSON：无失败信息 */
      }
      if (!(resp.status >= 200 && resp.status < 300) || failMsg !== null) {
        HttpLoginGate.instance.recordFailure(this.id);
        throw new CloudException(failMsg ?? '登录失败，请稍后再试');
      }
      const session = pairs['phpdisk_info'] ?? '';
      if (session === '') {
        HttpLoginGate.instance.recordFailure(this.id);
        throw new CloudException('登录失败');
      }
      HttpLoginGate.instance.recordSuccess(this.id);
      return new CloudAccount({
        provider: this.id,
        accountId: uid !== '' ? uid : (await md5Hex(session)).substring(0, 12),
        nickname: username,
        cred: { 'cookie': `phpdisk_info=${session}` },
        boundAt: new Date(),
      });
    } catch (e) {
      if (e instanceof CloudException) throw e;
      HttpLoginGate.instance.recordFailure(this.id);
      throw new CloudException('登录失败，请稍后再试');
    }
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
