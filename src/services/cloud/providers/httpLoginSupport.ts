// 移植自移动端 lib/src/cloud/providers/http_login_support.dart
// HTTP 账密登录支撑：登录限频 + 失败指数退避（风控），以及各盘通用
// 加密小工具（md5 / uuid / 天翼 RSA-PKCS1）。
//
// 使用约定：loginWithFields 实现入口先 `gate.ensureAllowed(id)`，请求
// 前后 `recordAttempt` / `recordSuccess|recordFailure`。

import { CloudException } from '../cloudTypes';
import { rsaEncryptHex } from '../rsa';

type CryptoJsModule = typeof import('crypto-js');

let cryptoJsPromise: Promise<CryptoJsModule> | null = null;

function loadCryptoJs(): Promise<CryptoJsModule> {
  if (!cryptoJsPromise) {
    cryptoJsPromise = import('crypto-js').then((mod) => {
      const maybe = mod as { default?: CryptoJsModule };
      return (maybe.default ?? mod) as CryptoJsModule;
    });
  }
  return cryptoJsPromise;
}

/** 同盘两次登录尝试最小间隔（毫秒）。 */
const MIN_INTERVAL_MS = 30 * 1000;

/** 失败退避上限（毫秒）。 */
const MAX_BACKOFF_MS = 10 * 60 * 1000;

export class HttpLoginGate {
  private static _instance: HttpLoginGate | null = null;

  static get instance(): HttpLoginGate {
    if (!HttpLoginGate._instance) {
      HttpLoginGate._instance = new HttpLoginGate();
    }
    return HttpLoginGate._instance;
  }

  private _lastAttempt = new Map<string, number>();
  private _failCount = new Map<string, number>();

  private constructor() {}

  /** 登录尝试前调用；处于限频/退避期直接抛 CloudException。 */
  ensureAllowed(providerId: string): void {
    const last = this._lastAttempt.get(providerId);
    if (last == null) return;
    const waitMs = this._waitDuration(providerId, last);
    if (waitMs > 0) {
      throw new CloudException(`操作过于频繁，请 ${Math.floor(waitMs / 1000) + 1} 秒后再试`);
    }
  }

  recordAttempt(providerId: string): void {
    this._lastAttempt.set(providerId, Date.now());
  }

  recordFailure(providerId: string): void {
    this._failCount.set(providerId, (this._failCount.get(providerId) ?? 0) + 1);
  }

  recordSuccess(providerId: string): void {
    this._failCount.delete(providerId);
    this._lastAttempt.delete(providerId);
  }

  private _waitDuration(providerId: string, last: number): number {
    const fails = this._failCount.get(providerId) ?? 0;
    const shift = Math.min(fails, 4); // 30s * 2^n，封顶 10 分钟
    let backoff = MIN_INTERVAL_MS * (1 << shift);
    if (backoff > MAX_BACKOFF_MS) backoff = MAX_BACKOFF_MS;
    const remain = backoff - (Date.now() - last);
    return remain > 0 ? remain : 0;
  }
}

/** MD5 hex（UTF-8 输入），与 Dart md5.convert(utf8.encode(input)) 语义一致。 */
export async function md5Hex(input: string): Promise<string> {
  const CryptoJS = await loadCryptoJs();
  return CryptoJS.MD5(input).toString();
}

/** SHA1 hex（UTF-8 输入），与 Dart sha1.convert(utf8.encode(input)) 语义一致。 */
export async function sha1Hex(input: string): Promise<string> {
  const CryptoJS = await loadCryptoJs();
  return CryptoJS.SHA1(input).toString();
}

/** 随机 UUID v4（小写，带连字符）。多盘设备指纹/请求 id 用。 */
export function uuidV4(): string {
  const hex = (n: number): string => {
    const buf = new Uint8Array(Math.ceil(n / 2));
    crypto.getRandomValues(buf);
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, n);
  };
  const variantBuf = new Uint8Array(1);
  crypto.getRandomValues(variantBuf);
  const variant = '89ab'[variantBuf[0] & 3];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

/** 天翼 logbox RSA 公钥加密（PKCS#1 v1.5，hex 输出）。 */
export function rsaPkcs1Hex(plain: string, modulusHex: string, exponentHex: string): string {
  return rsaEncryptHex(modulusHex, exponentHex, plain);
}

/** 解析天翼 encryptConf 返回的 pubKey（base64 编码的 X.509
 *  SubjectPublicKeyInfo），提取 [modulusHex, exponentHex]。 */
export function parseSpki(b64Key: string): [string, string] {
  const d = Uint8Array.from(atob(b64Key), (c) => c.charCodeAt(0));
  let pos = 0;
  const item = (): [number, number, number] => {
    const tag = d[pos++]!;
    let len = d[pos++]!;
    if (len & 0x80) {
      const nb = len & 0x7f;
      len = 0;
      for (let i = 0; i < nb; i++) len = (len << 8) | d[pos + i]!;
      pos += nb;
    }
    const start = pos;
    pos += len;
    return [tag, start, pos];
  };
  const top = item(); // 外层 SEQUENCE
  pos = top[1]!; // 子项从外层内容起点重新定位
  item(); // AlgorithmIdentifier
  const [, bitStart] = item(); // BIT STRING
  // BIT STRING 内容首字节是未用位数（RSA 恒为 0），跳过。
  pos = bitStart + 1;
  const [, rsaStart] = item(); // 内层 SEQUENCE（rsaPublicKey）
  pos = rsaStart;
  const [, nStart, nEnd] = item();
  const [, eStart, eEnd] = item();
  const hexOf = (s: number, e: number): string =>
    Array.from(d.slice(s, e))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  return [hexOf(nStart, nEnd), hexOf(eStart, eEnd)];
}
