
export type AuthUser = {
  id: string;
  username: string;
  nickname: string;
  email: string;
  avatar?: string | null;
  ciyuanxi_id?: string;
  role?: string;
};

export type AuthPayload = {
  token: string;
  user: AuthUser;
};

export type AuthMode = 'login' | 'register' | 'forgot';

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

export const DEFAULT_AUTH_BASE_URL = 'https://api.xianyumusic.cn/api';

export type ApiEnvelope<T> = {
  code: number;
  msg: string;
  data: T;
};

export type SignedRequestOptions = {
  fetchTimeoutMs?: number;
  timeoutMs?: number;
  skipToken?: boolean;
};