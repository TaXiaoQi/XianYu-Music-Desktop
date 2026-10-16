// 移植自移动端 lib/src/cloud/cloud_types.dart
// 网盘播放引擎——公共模型与登录范式定义。
//
// 播放标识：`cloud://<provider>/<accountId>/<urlEncodedFileJson>`，
// 具体 provider/account/分享上下文另存 QueueItem.cloudInfoJson。

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function toRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 登录范式：决定绑定页把用户路由到哪个登录页面。 */
export enum CloudLoginKind {
  /** WebView 内完成登录后捕获指定 Cookie（微云/139） */
  WebviewCookie = 'webviewCookie',

  /** WebView 内完成登录 + JS 注入轮询捕获 Token（阿里） */
  WebviewToken = 'webviewToken',

  /** HTTP 账密登录（迅雷/PikPak/蓝奏/123 账密通道/天翼） */
  HttpPassword = 'httpPassword',

  /** 账密 + 短信验证码（天翼短信通道） */
  SmsPassword = 'smsPassword',

  /** 扫码登录（123/百度/夸克/UC） */
  QrCode = 'qrCode',
}

/** WebView 登录捕获规则（webviewCookie / webviewToken 两范式共用）。 */
export class CloudCaptureRule {
  /** 需要捕获的 Cookie 名（webviewCookie 范式）。 */
  readonly cookieNames: string[];

  /** Cookie 所在域（按域隔离，逐域读取）。 */
  readonly cookieDomains: string[];

  /** 页面 URL 命中该正则即认为登录流程走完，可读 Cookie。 */
  readonly doneUrlPattern: RegExp | null;

  /** webviewToken 范式：页面加载后注入的 JS 片段，返回非空字符串即视为 token 出现。 */
  readonly pollScript: string | null;

  /** JS 轮询间隔毫秒数。 */
  readonly pollIntervalMs: number;

  constructor(
    init: {
      cookieNames?: string[];
      cookieDomains?: string[];
      doneUrlPattern?: RegExp | null;
      pollScript?: string | null;
      pollIntervalMs?: number;
    } = {},
  ) {
    this.cookieNames = init.cookieNames ?? [];
    this.cookieDomains = init.cookieDomains ?? [];
    this.doneUrlPattern = init.doneUrlPattern ?? null;
    this.pollScript = init.pollScript ?? null;
    this.pollIntervalMs = init.pollIntervalMs ?? 500;
  }
}

/** WebView 登录捕获结果。 */
export class CloudCaptureResult {
  /** 捕获的指定 Cookie（name → value）。 */
  readonly cookies: Record<string, string>;

  /** webviewToken 范式捕获的 token。 */
  readonly token: string | null;

  /** 结束时的页面 URL。 */
  readonly finalUrl: string | null;

  constructor(
    init: {
      cookies?: Record<string, string>;
      token?: string | null;
      finalUrl?: string | null;
    } = {},
  ) {
    this.cookies = init.cookies ?? {};
    this.token = init.token ?? null;
    this.finalUrl = init.finalUrl ?? null;
  }
}

/** 动态登录表单字段（登录页按 provider 声明渲染）。 */
export class CloudLoginField {
  readonly key: string;
  readonly label: string;
  readonly obscure: boolean;

  /** 手机号键盘。 */
  readonly isPhone: boolean;

  /** 该字段是短信验证码输入框（决定是否显示「发送验证码」按钮）。 */
  readonly isSmsCode: boolean;

  constructor(init: {
    key: string;
    label: string;
    obscure?: boolean;
    isPhone?: boolean;
    isSmsCode?: boolean;
  }) {
    this.key = init.key;
    this.label = init.label;
    this.obscure = init.obscure ?? false;
    this.isPhone = init.isPhone ?? false;
    this.isSmsCode = init.isSmsCode ?? false;
  }
}

/** 扫码登录会话。 */
export class CloudQrLoginSession {
  /** 渲染成二维码的内容。 */
  readonly qrContent: string;

  /** 服务方直接下发的二维码图片地址（优先于 qrContent 渲染）。 */
  readonly qrImageUrl: string | null;

  /** 轮询句柄（qrToken / state；百度为 gid/sign/cookie 的 JSON 串）。 */
  readonly state: string;

  constructor(init: { qrContent: string; state: string; qrImageUrl?: string | null }) {
    this.qrContent = init.qrContent;
    this.qrImageUrl = init.qrImageUrl ?? null;
    this.state = init.state;
  }
}

/** 已绑定网盘账号。持久化时整体 JSON → AES 加密 → 本地安全存储。 */
export class CloudAccount {
  /** provider id（cloudRegistry 内一致）。 */
  readonly provider: string;

  /** 该盘内的账号唯一标识（user_id / 密码指纹等）。 */
  readonly accountId: string;

  readonly nickname: string;

  /** 凭据键值对（cookie / accessToken / refreshToken / sessionId…）。 */
  readonly cred: Record<string, string>;

  readonly boundAt: Date;

  constructor(init: {
    provider: string;
    accountId: string;
    nickname: string;
    cred: Record<string, string>;
    boundAt: Date;
  }) {
    this.provider = init.provider;
    this.accountId = init.accountId;
    this.nickname = init.nickname;
    this.cred = init.cred;
    this.boundAt = init.boundAt;
  }

  toJson(): Record<string, unknown> {
    return {
      provider: this.provider,
      accountId: this.accountId,
      nickname: this.nickname,
      cred: this.cred,
      boundAt: this.boundAt.getTime(),
    };
  }

  static fromJson(j: unknown): CloudAccount {
    const rec = toRecord(j) ?? {};
    const cred: Record<string, string> = {};
    const credRaw = toRecord(rec['cred']);
    if (credRaw) {
      for (const [k, v] of Object.entries(credRaw)) {
        cred[k] = str(v);
      }
    }
    return new CloudAccount({
      provider: str(rec['provider'] ?? ''),
      accountId: str(rec['accountId'] ?? ''),
      nickname: str(rec['nickname'] ?? ''),
      cred,
      boundAt: new Date(typeof rec['boundAt'] === 'number' ? rec['boundAt'] : 0),
    });
  }
}

/** 网盘文件条目。id/path 语义由各盘自定义（供 getDirectLink 复原）。 */
export class CloudFile {
  readonly id: string;
  readonly name: string;
  readonly isDir: boolean;
  readonly size: number;
  readonly parentId: string | null;
  readonly path: string | null;

  /** 各盘侧带令牌（转存/直链用），跨页传递；无则 null。 */
  readonly token: string | null;

  constructor(init: {
    id: string;
    name: string;
    isDir?: boolean;
    size?: number;
    parentId?: string | null;
    path?: string | null;
    token?: string | null;
  }) {
    this.id = init.id;
    this.name = init.name;
    this.isDir = init.isDir ?? false;
    this.size = init.size ?? 0;
    this.parentId = init.parentId ?? null;
    this.path = init.path ?? null;
    this.token = init.token ?? null;
  }

  /** 常见音频扩展名（浏览页识别可播条目用）。 */
  static readonly audioExts: ReadonlySet<string> = new Set([
    'mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'ape', 'dsf', 'dff',
    'wma', 'opus', 'aiff', 'aif', 'alac', 'wv', 'tak', 'tta', 'ac3', 'dts',
  ]);

  get isAudio(): boolean {
    const n = this.name.toLowerCase();
    const dot = n.lastIndexOf('.');
    if (dot < 0 || dot === n.length - 1) return false;
    return CloudFile.audioExts.has(n.substring(dot + 1));
  }

  toJson(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.id,
      name: this.name,
      isDir: this.isDir,
      size: this.size,
    };
    if (this.parentId != null) out['parentId'] = this.parentId;
    if (this.path != null) out['path'] = this.path;
    if (this.token != null) out['token'] = this.token;
    return out;
  }

  static fromJson(j: unknown): CloudFile {
    const rec = toRecord(j) ?? {};
    return new CloudFile({
      id: str(rec['id'] ?? ''),
      name: str(rec['name'] ?? ''),
      isDir: rec['isDir'] === true,
      size: typeof rec['size'] === 'number' ? Math.trunc(rec['size']) : 0,
      parentId: rec['parentId'] != null ? str(rec['parentId']) : null,
      path: rec['path'] != null ? str(rec['path']) : null,
      token: rec['token'] != null ? str(rec['token']) : null,
    });
  }
}

/** 目录列表结果。 */
export class CloudListResult {
  readonly files: CloudFile[];

  /** null = 已到底。 */
  readonly nextCursor: string | null;

  constructor(init: { files: CloudFile[]; nextCursor?: string | null }) {
    this.files = init.files;
    this.nextCursor = init.nextCursor ?? null;
  }
}

/** 分享链接解析结果。 */
export class CloudShareParse {
  readonly providerId: string;

  /** 分享内文件（首层；目录条目转存时递归由 transferShareFiles 处理）。 */
  readonly files: CloudFile[];

  /** 分享标识（surl / pwd_id / shareCode…），转存用。 */
  readonly shareId: string | null;

  /** stoken 类令牌（夸克/阿里转存与免转存直链要用）。 */
  readonly shareToken: string | null;

  readonly passcode: string | null;

  /** true = 支持免转存直链，播放走 getShareDirectLink；false = 必须 transferShareFiles 后播放。 */
  readonly directPlayable: boolean;

  constructor(init: {
    providerId: string;
    files: CloudFile[];
    shareId?: string | null;
    shareToken?: string | null;
    passcode?: string | null;
    directPlayable?: boolean;
  }) {
    this.providerId = init.providerId;
    this.files = init.files;
    this.shareId = init.shareId ?? null;
    this.shareToken = init.shareToken ?? null;
    this.passcode = init.passcode ?? null;
    this.directPlayable = init.directPlayable ?? false;
  }
}

/** 直链（播放用）。headers 必须与 url 一起注册进播放代理。 */
export class CloudDirectLink {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly fileName: string | null;
  readonly size: number | null;

  /** null = 由 directLinkCache 按默认 TTL 处理。 */
  readonly expireAt: Date | null;

  constructor(init: {
    url: string;
    headers?: Record<string, string>;
    fileName?: string | null;
    size?: number | null;
    expireAt?: Date | null;
  }) {
    this.url = init.url;
    this.headers = init.headers ?? {};
    this.fileName = init.fileName ?? null;
    this.size = init.size ?? null;
    this.expireAt = init.expireAt ?? null;
  }
}

/** 引擎层异常：文案直接面向用户（简短、只说原因）。 */
export class CloudException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudException';
  }

  override toString(): string {
    return this.message;
  }
}

/** 登录要求短信二次校验（如天翼 -133 设备校验）。provider 已自动发码并
 *  暂存会话，UI 弹窗收码后调 [CloudProvider.submitSmsCode] 完成绑定。 */
export class CloudSmsRequiredException extends CloudException {
  constructor(public readonly username: string) {
    super('需要短信验证');
    this.name = 'CloudSmsRequiredException';
  }
}
