// 移植自移动端 lib/src/cloud/cloud_credentials_store.dart
// 网盘凭据本地加密存储。
//
// 复刻移动端 sealToken 模式：凭据 JSON → AES-256-CBC（PKCS7）
// 加密（`xy1:<iv>:<密文>` 前缀格式）→ localStorage。AES 密钥独立于登录
// token 密钥，密钥丢失时按未绑定处理。
// 桌面端落盘走 localStorage（先例 xianyu_plugin_subscriptions）：设备随机
// 32 字节 key 存 `xianyu_cloud_device_key_v1`（hex），密封串存
// `xianyu_cloud_creds_v1`。密封格式与移动端一致，同步串三端互认。
//
// 结构 `{providerId: [CloudAccount]}`（每盘多账号，为服务端同步留位）。
// exportForSync/importFromSync 供跨设备同步接入。

import { CloudAccount, CloudException } from './cloudTypes';

type CryptoJsModule = typeof import('crypto-js');
type WordArray = ReturnType<CryptoJsModule['lib']['WordArray']['create']>;

let cryptoJsPromise: Promise<CryptoJsModule> | null = null;

/** crypto-js 以 CJS 形式发布，互操作结果可能挂在 default 上，这里统一归一。 */
function loadCryptoJs(): Promise<CryptoJsModule> {
  if (!cryptoJsPromise) {
    cryptoJsPromise = import('crypto-js').then((mod) => {
      const maybe = mod as { default?: CryptoJsModule };
      return (maybe.default ?? mod) as CryptoJsModule;
    });
  }
  return cryptoJsPromise;
}

const K_CREDS_KEY = 'xianyu_cloud_creds_v1';
const K_DEVICE_KEY = 'xianyu_cloud_device_key_v1';
const K_SEAL_PREFIX = 'xy1:';

/** 遗留兜底账号 ID 形态：早期版本 accountId 取 md5(cookie/refreshToken) 前
 * 12 位 hex（每次登录都变，重复登录即产生重复账号）。现役账号 ID 均为
 * 服务端 uid 或昵称哈希（u_ 前缀）。 */
const LEGACY_ID_RE = /^[0-9a-f]{12}$/;

type CredMap = Record<string, CloudAccount[]>;

function randomHex(byteLen: number): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class CloudCredentialsStore {
  private static _instance: CloudCredentialsStore | null = null;

  static get instance(): CloudCredentialsStore {
    if (!CloudCredentialsStore._instance) {
      CloudCredentialsStore._instance = new CloudCredentialsStore();
    }
    return CloudCredentialsStore._instance;
  }

  /** 内存缓存；首读后有效。改动即回写落盘。 */
  private _cache: CredMap | null = null;
  private _key: WordArray | null = null;

  /** 凭据落盘后的变更通知（sync 层注册做云端自动上传；未注册时为 no-op）。
   * 绑定/解绑/凭据轮换都会触发，回调内自行处理登录态与防抖。 */
  static onPersisted: (() => void) | null = null;

  private constructor() {}

  private async _loadCryptoJs(): Promise<CryptoJsModule> {
    return loadCryptoJs();
  }

  /** 设备随机 32 字节密钥（hex）；首次生成后落 localStorage。 */
  private _deviceKeyHex(): string {
    const stored = localStorage.getItem(K_DEVICE_KEY);
    if (stored && stored.length === 64 && /^[0-9a-fA-F]+$/.test(stored)) {
      return stored;
    }
    const hex = randomHex(32);
    localStorage.setItem(K_DEVICE_KEY, hex);
    return hex;
  }

  private async _aesKey(): Promise<WordArray> {
    const cached = this._key;
    if (cached) return cached;
    const CryptoJS = await this._loadCryptoJs();
    const key = CryptoJS.enc.Hex.parse(this._deviceKeyHex());
    this._key = key;
    return key;
  }

  /** 跨设备同步密钥：sha256(`cloud_creds.v1:<ciyuanxiId>`) 的 32 原始字节，
   * 与插件用户变量同步同款账号派生方式，同账号三端可互解。 */
  private _syncKey(CryptoJS: CryptoJsModule, ciyuanxiId: string): WordArray {
    // SHA256 返回的 WordArray 即摘要原始字节，可直接作 AES key。
    return CryptoJS.SHA256(`cloud_creds.v1:${ciyuanxiId}`);
  }

  private async _sealWithKey(plain: string, key: WordArray): Promise<string> {
    const CryptoJS = await this._loadCryptoJs();
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plain), key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    return `${K_SEAL_PREFIX}${iv.toString(CryptoJS.enc.Base64)}:${encrypted.ciphertext.toString(CryptoJS.enc.Base64)}`;
  }

  private async _seal(plain: string): Promise<string> {
    return this._sealWithKey(plain, await this._aesKey());
  }

  /** 密钥就绪后同步解密；密文损坏/密钥不匹配返回 null。 */
  private _unsealWithKey(stored: string, key: WordArray, CryptoJS: CryptoJsModule): string | null {
    if (!stored.startsWith(K_SEAL_PREFIX)) return null;
    const parts = stored.slice(K_SEAL_PREFIX.length).split(':');
    if (parts.length !== 2) return null;
    try {
      const iv = CryptoJS.enc.Base64.parse(parts[0] as string);
      const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: CryptoJS.enc.Base64.parse(parts[1] as string),
      });
      const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });
      const plain = decrypted.toString(CryptoJS.enc.Utf8);
      return plain !== '' ? plain : null;
    } catch {
      return null;
    }
  }

  private async _unseal(stored: string): Promise<string | null> {
    const CryptoJS = await this._loadCryptoJs();
    return this._unsealWithKey(stored, await this._aesKey(), CryptoJS);
  }

  private async _ensureLoaded(): Promise<CredMap> {
    if (this._cache) return this._cache;
    const map: CredMap = {};
    try {
      const stored = localStorage.getItem(K_CREDS_KEY);
      const plain = stored == null ? null : await this._unseal(stored);
      if (plain != null) {
        const raw: unknown = JSON.parse(plain);
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (Array.isArray(v)) {
              map[k] = v
                .filter((a) => typeof a === 'object' && a !== null)
                .map((a) => CloudAccount.fromJson(a));
            }
          }
        }
      }
    } catch (e) {
      console.warn('[cloud] 网盘凭据读取失败:', e);
    }
    // 遗留兜底账号清理：同盘存在稳定 ID 账号时，清除遗留 12 位裸 hex 条目
    //（旧版重复登录产生的重复账号）。只剩单条遗留时不清理（仍是有效绑定）。
    let removed = 0;
    for (const list of Object.values(map)) {
      if (list.length <= 1) continue;
      if (!list.some((a) => !LEGACY_ID_RE.test(a.accountId))) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        if (LEGACY_ID_RE.test(list[i].accountId)) {
          list.splice(i, 1);
          removed++;
        }
      }
    }
    this._cache = map;
    if (removed > 0) {
      console.info('[cloud] 清理遗留兜底账号 ' + removed + ' 条');
      await this._persist();
    }
    return map;
  }

  private async _persist(): Promise<void> {
    const map = this._cache;
    if (!map) return;
    try {
      const json = JSON.stringify(
        Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.map((a) => a.toJson())])),
      );
      localStorage.setItem(K_CREDS_KEY, await this._seal(json));
    } catch (e) {
      console.warn('[cloud] 网盘凭据写入失败:', e);
    }
    // 本地状态已变化，无论写盘成败都通知 sync 层（由其决定是否上传）
    CloudCredentialsStore.onPersisted?.();
  }

  async accountsFor(providerId: string): Promise<CloudAccount[]> {
    const map = await this._ensureLoaded();
    return map[providerId] ?? [];
  }

  /** 按 accountId 取凭据；未绑定返回 null。 */
  async credFor(providerId: string, accountId: string): Promise<Record<string, string> | null> {
    const list = await this.accountsFor(providerId);
    for (const a of list) {
      if (a.accountId === accountId) return a.cred;
    }
    return null;
  }

  /** 单账号凭据便捷读取：该盘只绑了一个账号时直接用。 */
  async soleCredFor(providerId: string): Promise<Record<string, string> | null> {
    const list = await this.accountsFor(providerId);
    if (list.length === 0) return null;
    return list[0].cred;
  }

  /** 新增/更新账号（按 provider+accountId upsert）。
   * 新账号为稳定 ID 时，顺带清除同盘遗留 12 位裸 hex 条目（旧版
   * Cookie/refreshToken 哈希 ID，重复登录产生的重复账号）。 */
  async saveAccount(account: CloudAccount): Promise<void> {
    const map = await this._ensureLoaded();
    const list = [...(map[account.provider] ?? [])];
    const idx = list.findIndex((a) => a.accountId === account.accountId);
    if (idx >= 0) {
      list[idx] = account;
    } else {
      list.push(account);
    }
    if (!LEGACY_ID_RE.test(account.accountId)) {
      const before = list.length;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].accountId !== account.accountId && LEGACY_ID_RE.test(list[i].accountId)) {
          list.splice(i, 1);
        }
      }
      if (list.length !== before) {
        console.info('[cloud] 清理遗留兜底账号 ' + (before - list.length) + ' 条');
      }
    }
    map[account.provider] = list;
    await this._persist();
  }

  async removeAccount(providerId: string, accountId: string): Promise<void> {
    const map = await this._ensureLoaded();
    const list = (map[providerId] ?? []).filter((a) => a.accountId !== accountId);
    if (list.length === 0) {
      delete map[providerId];
    } else {
      map[providerId] = list;
    }
    await this._persist();
  }

  /** 刷新已绑定账号的凭据（token 轮换类盘用，如阿里 refresh_token 单次有效）。 */
  async updateCred(
    providerId: string,
    accountId: string,
    cred: Record<string, string>,
  ): Promise<void> {
    const map = await this._ensureLoaded();
    const list = [...(map[providerId] ?? [])];
    const idx = list.findIndex((a) => a.accountId === accountId);
    if (idx < 0) return;
    list[idx] = new CloudAccount({
      provider: list[idx].provider,
      accountId: list[idx].accountId,
      nickname: list[idx].nickname,
      cred,
      boundAt: list[idx].boundAt,
    });
    map[providerId] = list;
    await this._persist();
  }

  /** 跨设备同步：导出密封串。
   * 账号派生密钥（三端可互解，服务端无明文）重新密封本地凭据 JSON，
   * 密文不出本类、本地落盘仍用设备密钥。未绑定任何盘返回 null。 */
  async exportForSync(ciyuanxiId: string): Promise<string | null> {
    const map = await this._ensureLoaded();
    if (Object.keys(map).length === 0) return null;
    const CryptoJS = await this._loadCryptoJs();
    const json = JSON.stringify(
      Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.map((a) => a.toJson())])),
    );
    return this._sealWithKey(json, this._syncKey(CryptoJS, ciyuanxiId));
  }

  /** 跨设备同步：导入密封串（与导出格式一致，指纹去重合并）。 */
  async importFromSync(sealed: string, ciyuanxiId: string): Promise<void> {
    const CryptoJS = await this._loadCryptoJs();
    const plain = this._unsealWithKey(sealed, this._syncKey(CryptoJS, ciyuanxiId), CryptoJS);
    if (plain == null) throw new CloudException('同步凭据解密失败');
    const raw: unknown = JSON.parse(plain);
    const merged = await this._ensureLoaded();
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!Array.isArray(v)) continue;
        const incoming = v
          .filter((a) => typeof a === 'object' && a !== null)
          .map((a) => CloudAccount.fromJson(a));
        const local = [...(merged[k] ?? [])];
        for (const a of incoming) {
          const idx = local.findIndex((x) => x.accountId === a.accountId);
          if (idx >= 0) {
            local[idx] = a;
          } else {
            local.push(a);
          }
        }
        merged[k] = local;
      }
    }
    this._cache = merged;
    await this._persist();
  }
}
