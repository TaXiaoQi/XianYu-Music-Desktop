
export type {
  AuthUser,
  AuthPayload,
  AuthMode,
  VerifyCodeType,
  HumanCaptcha,
  HumanCaptchaProvider,
  HumanCaptchaConfig,
  UserAgreement,
  HumanCaptchaPayload,
  ProfileStats,
  ProfileAuditStatus,
  ProfileChangeLimitStatus,
  SignedRequestOptions,
} from './authTypes';
export { DEFAULT_AUTH_BASE_URL } from './authTypes';

export {
  getAuthBaseUrl,
  setAuthBaseUrl,
  getAuthApiSecret,
  setAuthApiSecret,
  initAuthFromKeyring,
  getStoredAuth,
  getAuthToken,
  saveAuth,
  clearAuth,
  onAccountExpired,
  logout,
  refreshSession,
} from './authSession';

export { signedRequest } from './authHttp';

export {
  getHumanCaptchaConfig,
  getUserAgreement,
  getHumanCaptcha,
  verifyHumanCaptcha,
  login,
  loginByEmail,
  register,
  updateCiyuanxiId,
  bindEmail,
  sendEmailCode,
  resetPassword,
  preVerifyDeleteAccount,
  deleteAccount,
  changePassword,
} from './authAccount';

export {
  createQrLoginCode,
  pollQrLoginStatus,
} from './authQr';
export type { QrPollResult } from './authQr';

export {
  getProfile,
  updateProfile,
  getNicknameStatus,
  getNicknameChangeLimitStatus,
  uploadAvatar,
  getAvatarStatus,
  getAvatarChangeLimitStatus,
  checkBanStatus,
} from './authProfile';