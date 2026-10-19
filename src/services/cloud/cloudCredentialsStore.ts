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
import { CloudFolderNameCache, CloudFolderSelectionStore } from './cloudFolderSelectionStore';

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

/** 同步串保留键：随凭据密封串携带的目录选择（`providerId|accountId → [path]`）。
 * 旧版客户端导入时只认数组值会自动忽略该键，新旧双向兼容。 */
const K_FOLDER_SEL_SYNC_KEY = '__fsel__';

/** 同步串保留键：随密封串携带的已选目录名称缓存
 * （`providerId|accountId → {存储键: 目录名}`），id 型盘展示可读名用。
 * 纯展示数据不参与 LWW 时钟，仅随勾选变更的载荷顺带上传；旧版客户端
 * 导入时只认数组值会自动忽略该键，双向兼容。 */
const K_FOLDER_NAMES_SYNC_KEY = '__fnames__';

/** 同步串保留键（协议 v2）：产生该串的本地变更时刻（epoch 毫秒，LWW 对比用）。
 * 旧客户端导入只认数组值会自动忽略，双向兼容。 */
const K_TIMESTAMP_SYNC_KEY = '__ts__';

/** 同步元数据落盘键：LWW 时间戳（凭据与文件夹选择共用同一 changeAt，
 * 因为两者装在同一个密封串里同步）。 */
const K_SYNC_META_KEY = 'xianyu.cloud.creds.sync_meta.v1';

/** 本地同步元数据：changeAt=最近本地变更时刻；syncedAt=最近成功上传的变更时刻。 */
export interface CloudSyncMeta {
  changeAt: number | null;
  syncedAt: number | null;
}

/** 同步导入结果：applied=是否应用了下发数据（本地较新时为 false）；
 * changed=本地内容是否实际变化。 */
export interface CloudSyncImportResult {
  applied: boolean;
  changed: boolean;
}

/** 遗留兜底账号 ID 形态：早期版本 accountId 取 md5(cookie/refreshToken) 前
 * 12 位 hex（每次登录都变，重复登录即产生重复账号）。现役账号 ID 均为
 * 服务端 uid 或昵称哈希（u_ 前缀）。 */
const LEGACY_ID_RE = /^[0-9a-f]{12}$/;

type CredMap = Record<string, CloudAccount[]>;

/** 同盘同昵称去重（移动端同款语义：同名视为同一账号的重登，保留绑定较新的）。
 * 背景：多家盘 accountId 兜底取 md5(cookie/token)，重登即变，按 ID upsert
 * 会把同一账号堆叠成多条；昵称稳定，是可靠的同一性判据。 */
function dedupeByNickname(list: CloudAccount[]): { list: CloudAccount[]; removed: number } {
  const keptByNickname = new Map<string, number>();
  const drop = new Set<number>();
  for (let i = 0; i < list.length; i++) {
    const nick = list[i].nickname.trim();
    if (nick === '') continue;
    const kept = keptByNickname.get(nick);
    if (kept == null) {
      keptByNickname.set(nick, i);
      continue;
    }
    if (list[i].boundAt.getTime() > list[kept].boundAt.getTime()) {
      drop.add(kept);
      keptByNickname.set(nick, i);
    } else {
      drop.add(i);
    }
  }
  if (drop.size === 0) return { list, removed: 0 };
  return { list: list.filter((_, i) => !drop.has(i)), removed: drop.size };
}

function randomHex(byteLen: number): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 账号表稳定序列化（provider 键排序后 JSON）：内容对比用，不依赖键序/引用。 */
function stableCredJson(map: CredMap): string {
  const entries: [string, unknown[]][] = Object.entries(map).map(([k, v]) => [
    k,
    v.map((a) => a.toJson()),
  ]);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(Object.fromEntries(entries));
}

/** 解析 `__ts__` 保留键：非法/缺失返回 null（视为旧格式串）。 */
function parseSyncTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** 解析 `__fsel__` 保留键：`providerId|accountId → [path]`，剔除非法条目。
 * 空串路径合法：id 型盘（迅雷/PikPak）根目录 id 为空串。 */
function parseFolderSelMap(v: unknown): Record<string, string[]> {
  const sel: Record<string, string[]> = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return sel;
  for (const [k, paths] of Object.entries(v as Record<string, unknown>)) {
    if (!k || !Array.isArray(paths)) continue;
    const list = paths.filter((p): p is string => typeof p === 'string');
    if (list.length > 0) sel[k] = list;
  }
  return sel;
}

/** 解析 `__fnames__` 保留键：`providerId|accountId → {存储键: 目录名}`，
 * 剔除非法条目（空键/空名/非字符串值）。 */
function parseFolderNamesMap(v: unknown): Record<string, Record<string, string>> {
  const names: Record<string, Record<string, string>> = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return names;
  for (const [k, bucket] of Object.entries(v as Record<string, unknown>)) {
    if (!k || typeof bucket !== 'object' || bucket === null || Array.isArray(bucket)) continue;
    const mapped: Record<string, string> = {};
    for (const [kk, vv] of Object.entries(bucket as Record<string, unknown>)) {
      if (kk && typeof vv === 'string' && vv !== '') mapped[kk] = vv;
    }
    if (Object.keys(mapped).length > 0) names[k] = mapped;
  }
  return names;
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
  /** UI 订阅（设置网盘面板、搜索来源列表）：凭据落盘后刷新。 */
  private _uiListeners = new Set<() => void>();

  /** 凭据落盘后的变更通知（sync 层注册做云端自动上传；未注册时为 no-op）。
   * 绑定/解绑/凭据轮换都会触发，回调内自行处理登录态与防抖。 */
  static onPersisted: (() => void) | null = null;

  /** 本地同步元数据内存缓存（`_loadMeta` 首读后有效）。 */
  private _meta: CloudSyncMeta | null = null;

  private constructor() {
    // 文件夹选择与凭据同装一个密封串同步：其变更统一记到本 store 的 changeAt
    CloudFolderSelectionStore.onPersisted = () => this._noteLocalChange();
  }

  /** 读取同步元数据（内存缓存优先，损坏按未变更处理）。 */
  private _loadMeta(): CloudSyncMeta {
    if (this._meta) return this._meta;
    const meta: CloudSyncMeta = { changeAt: null, syncedAt: null };
    try {
      const stored = localStorage.getItem(K_SYNC_META_KEY);
      if (stored) {
        const raw: unknown = JSON.parse(stored);
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
          const obj = raw as Record<string, unknown>;
          if (typeof obj.changeAt === 'number' && Number.isFinite(obj.changeAt)) {
            meta.changeAt = obj.changeAt;
          }
          if (typeof obj.syncedAt === 'number' && Number.isFinite(obj.syncedAt)) {
            meta.syncedAt = obj.syncedAt;
          }
        }
      }
    } catch (e) {
      console.warn('[cloud] 同步元数据读取失败:', e);
    }
    this._meta = meta;
    return meta;
  }

  private _saveMeta(meta: CloudSyncMeta): void {
    this._meta = meta;
    try {
      localStorage.setItem(K_SYNC_META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn('[cloud] 同步元数据写入失败:', e);
    }
  }

  /** 本地变更统一记时（绑定/解绑/凭据轮换/文件夹勾选）：changeAt = now。
   * syncedAt 置空，确保同毫秒内连续「上传完成→再变更」不会被误判为无变化。 */
  private _noteLocalChange(): void {
    this._saveMeta({ changeAt: Date.now(), syncedAt: null });
    CloudCredentialsStore.onPersisted?.();
  }

  /** 当前同步元数据（sync 层上传门控判断用）。 */
  async syncMeta(): Promise<CloudSyncMeta> {
    const meta = this._loadMeta();
    return { changeAt: meta.changeAt, syncedAt: meta.syncedAt };
  }

  /** 上传成功后对账：syncedAt = ts；若上传期间又有新变更（changeAt 已前移）
   * 则不动，留给下一次防抖上传。 */
  async markSynced(ts: number): Promise<void> {
    const meta = this._loadMeta();
    if (meta.changeAt !== ts) return;
    this._saveMeta({ changeAt: meta.changeAt, syncedAt: ts });
  }

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
    // 同昵称重登去重：历史堆叠的重复账号（同盘同名）读入时即收敛
    let nickRemoved = 0;
    for (const [k, list] of Object.entries(map)) {
      const { list: deduped, removed } = dedupeByNickname(list);
      if (removed > 0) {
        map[k] = deduped;
        nickRemoved += removed;
      }
    }
    this._cache = map;
    if (removed > 0 || nickRemoved > 0) {
      if (removed > 0) {
        console.info('[cloud] 清理遗留兜底账号 ' + removed + ' 条');
      }
      if (nickRemoved > 0) {
        console.info('[cloud] 清理同昵称重复账号 ' + nickRemoved + ' 条');
      }
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
    // UI 订阅者通知（快照遍历，回调内可能退订；登录同步落盘后 UI 即时跟随）
    for (const fn of [...this._uiListeners]) fn();
  }

  /** 订阅凭据变更（落盘即通知）；返回退订函数。 */
  subscribe(fn: () => void): () => void {
    this._uiListeners.add(fn);
    return () => {
      this._uiListeners.delete(fn);
    };
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
    // 同昵称重登去重：重登产生新 accountId（md5(cookie) 类兜底）时，
    // 以昵称判同，保留本次绑定、清掉旧条目（移动端同款语义）。
    const deduped = dedupeByNickname(list);
    if (deduped.removed > 0) {
      console.info('[cloud] 绑定去重：同昵称旧账号 ' + deduped.removed + ' 条');
    }
    map[account.provider] = list;
    this._noteLocalChange();
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
    this._noteLocalChange();
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
    this._noteLocalChange();
    await this._persist();
  }

  /** 跨设备同步：导出密封串（协议 v2）。
   * 账号派生密钥（三端可互解，服务端无明文）重新密封本地凭据 JSON，
   * 密文不出本类、本地落盘仍用设备密钥。密封明文顶层带保留键 `__ts__`
   * （本地变更时刻，LWW 对比用）、`__fsel__`（目录选择）与 `__fnames__`
   * （已选目录名称缓存，纯展示不参与时钟），跨设备一并同步。
   * 从未发生本地变更（changeAt 为空）返回 null，无需上传；账号已全部解绑
   * 但发生过变更时，导出仅含 `__ts__` 的空包，上传后清掉云端旧数据让解绑传播。 */
  async exportForSync(ciyuanxiId: string): Promise<string | null> {
    const map = await this._ensureLoaded();
    const meta = this._loadMeta();
    if (meta.changeAt == null) return null;
    const CryptoJS = await this._loadCryptoJs();
    const payload: Record<string, unknown> = { [K_TIMESTAMP_SYNC_KEY]: meta.changeAt };
    if (Object.keys(map).length > 0) {
      for (const [k, v] of Object.entries(map)) {
        payload[k] = v.map((a) => a.toJson());
      }
      const folderSel = await CloudFolderSelectionStore.instance.allPaths();
      if (Object.keys(folderSel).length > 0) {
        payload[K_FOLDER_SEL_SYNC_KEY] = folderSel;
      }
      const folderNames = await CloudFolderNameCache.instance.allNames();
      if (Object.keys(folderNames).length > 0) {
        payload[K_FOLDER_NAMES_SYNC_KEY] = folderNames;
      }
    }
    return this._sealWithKey(JSON.stringify(payload), this._syncKey(CryptoJS, ciyuanxiId));
  }

  /** 跨设备同步：导入密封串（协议 v2，LWW 对比流程）。
   * - 串带 `__ts__` 且本地 changeAt 更新 → 本地较新，整体跳过不下发；
   * - 串带 `__ts__` → 整体替换账号表与文件夹选择表（非并集，含删除传播），
   *   内容无变化不落盘不通知；应用后 changeAt = syncedAt = cloudTs
   *   （不推到 now，避免下发→上传同步风暴）；
   * - 串无 `__ts__`（旧格式）→ 保持并集合并；有变化 changeAt = now 留给
   *   上传推 v2 格式，无变化则双时间戳置 now（视为已对齐，不触发上传）。 */
  async importFromSync(sealed: string, ciyuanxiId: string): Promise<CloudSyncImportResult> {
    const CryptoJS = await this._loadCryptoJs();
    const plain = this._unsealWithKey(sealed, this._syncKey(CryptoJS, ciyuanxiId), CryptoJS);
    if (plain == null) throw new CloudException('同步凭据解密失败');
    const raw: unknown = JSON.parse(plain);
    const obj =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    const cloudTs = obj == null ? null : parseSyncTs(obj[K_TIMESTAMP_SYNC_KEY]);
    const meta = this._loadMeta();
    // LWW：云端明确较旧（本地存在更新的未同步变更）→ 跳过，不动本地
    if (cloudTs != null && meta.changeAt != null && cloudTs < meta.changeAt) {
      return { applied: false, changed: false };
    }
    if (obj == null) return { applied: false, changed: false };
    if (cloudTs != null) {
      return this._applyReplace(obj, cloudTs);
    }
    return this._applyMergeLegacy(obj);
  }

  /** v2 应用：整体替换账号表与文件夹选择表（云端内容为准）。 */
  private async _applyReplace(
    obj: Record<string, unknown>,
    cloudTs: number,
  ): Promise<CloudSyncImportResult> {
    const next: CredMap = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!Array.isArray(v)) continue;
      const accounts = v
        .filter((a) => typeof a === 'object' && a !== null)
        .map((a) => CloudAccount.fromJson(a));
      if (accounts.length > 0) next[k] = accounts;
    }
    const local = await this._ensureLoaded();
    const accountsChanged = stableCredJson(local) !== stableCredJson(next);
    const folderChanged = await CloudFolderSelectionStore.instance.replacePaths(
      parseFolderSelMap(obj[K_FOLDER_SEL_SYNC_KEY]),
    );
    const namesChanged = await CloudFolderNameCache.instance.replaceAllNames(
      parseFolderNamesMap(obj[K_FOLDER_NAMES_SYNC_KEY]),
    );
    if (accountsChanged) {
      this._cache = next;
      await this._persist();
    }
    // 双时间戳对齐为 cloudTs（避免同步风暴）；期间文件夹回调临时记的 now 被覆盖
    this._saveMeta({ changeAt: cloudTs, syncedAt: cloudTs });
    return { applied: true, changed: accountsChanged || folderChanged || namesChanged };
  }

  /** 旧格式串（无 `__ts__`）应用：保持并集合并行为（同昵称去重同现有导入）。 */
  private async _applyMergeLegacy(obj: Record<string, unknown>): Promise<CloudSyncImportResult> {
    const merged = await this._ensureLoaded();
    const before = stableCredJson(merged);
    for (const [k, v] of Object.entries(obj)) {
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
      // 同步导入后同昵称去重：移动端收敛过的账号列表再导入桌面端，
      // 不应与桌面端历史重登条目叠加
      const deduped = dedupeByNickname(local);
      merged[k] = deduped.removed > 0 ? deduped.list : local;
    }
    const accountsChanged = stableCredJson(merged) !== before;
    const folderChanged = await CloudFolderSelectionStore.instance.mergePaths(
      parseFolderSelMap(obj[K_FOLDER_SEL_SYNC_KEY]),
    );
    const namesChanged = await CloudFolderNameCache.instance.mergeNames(
      parseFolderNamesMap(obj[K_FOLDER_NAMES_SYNC_KEY]),
    );
    const now = Date.now();
    if (accountsChanged || folderChanged || namesChanged) {
      if (accountsChanged) {
        this._cache = merged;
        await this._persist();
      }
      // changeAt = now 留给上传推 v2 格式（文件夹回调已临时记时，此处统一覆盖）
      this._saveMeta({ changeAt: now, syncedAt: null });
    } else {
      // 无变化视为已对齐，不触发上传
      this._saveMeta({ changeAt: now, syncedAt: now });
    }
    return { applied: true, changed: accountsChanged || folderChanged || namesChanged };
  }
}
