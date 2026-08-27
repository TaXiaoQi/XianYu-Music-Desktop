/**
 * 账号认证服务 · 类型定义（叶子）。
 * 仅包含纯类型与常量，供 authSession / authHttp / authAccount / authProfile
 * 及门面 authService 复用，不依赖任何业务实现。
 */

export type AuthUser = {
  id: string;
  username: string;
  nickname: string;
  email: string;
  avatar?: string | null;
  /** 弦予号（12 位数字），用于修改密码等接口 */
  ciyuanxi_id?: string;
  /** 角色：空字符串=普通用户，admin/super_admin=管理员 */
  role?: string;
};

export type AuthPayload = {
  token: string;
  user: AuthUser;
};

/** 登录/注册/找回密码三种模式（找回密码为新增） */
export type AuthMode = 'login' | 'register' | 'forgot';

/** 验证码场景类型，必须与后续接口匹配 */
export type VerifyCodeType = 'register' | 'login' | 'reset_password' | 'delete_account' | 'change_password' | 'bind';

export type HumanCaptcha = {
  captcha_id: string;
  question: string;
  expire_seconds?: number;
};

export type HumanCaptchaProvider = 'turnstile' | 'hcaptcha' | 'off' | string;

export type HumanCaptchaConfig = {
  enabled: boolean;
  provider: HumanCaptchaProvider;
  siteKey: string;
};

export type UserAgreement = {
  title: string;
  content: string;
};

export type HumanCaptchaPayload = {
  captchaId?: string;
  captchaAnswer?: string;
  captchaToken?: string;
  provider?: HumanCaptchaProvider;
};

export type ProfileStats = {
  favorite_count: number;
  playlist_count: number;
  starred_count?: number;
  history_count?: number;
  listening_count?: number;
  revision?: number;
  updated_at?: string | null;
};

export type ProfileAuditStatus = 'pending' | 'rejected' | 'none';

export type ProfileChangeLimitStatus = {
  status: ProfileAuditStatus;
  todayBlocked: boolean;
  blockMessage: string;
};

/** 默认后端地址：测试构建与正式构建统一指向弦予音乐 API */
export const DEFAULT_AUTH_BASE_URL = 'https://api.xianyumusic.cn/api';

/** 后端统一响应：code 200 成功，其他为失败（HTTP 状态码同步设置） */
export type ApiEnvelope<T> = {
  code: number;
  msg: string;
  data: T;
};

/** signedRequest 的可选参数 */
export type SignedRequestOptions = {
  /** fetch 超时时间（毫秒），默认 25s。大文件上传等场景可设更长 */
  fetchTimeoutMs?: number;
  /** signedRequest 外层 Promise.race 超时时间（毫秒），默认 30s */
  timeoutMs?: number;
  /** 跳过自动注入登录 token（查看他人公开数据等场景，避免属主校验误判为登录过期） */
  skipToken?: boolean;
};