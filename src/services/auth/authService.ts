/**
 * 账号认证服务 —— 门面（Facade）。
 *
 * 汇聚 re-export 拆分后的子模块，保持既有消费者（authStore / 歌单同步 /
 * 收藏同步 / 插件同步 / 反馈通知 / leaderboard 等）的入口路径不变。
 * 已拆分的子模块（依赖单向：types/shared → session → http → account/profile）：
 *   - authTypes      纯类型与常量（叶子）
 *   - authShared     mapUser / getAuthErrorMessage 等纯映射/格式化（叶子）
 *   - authSession    baseUrl、apiSecret、token/user 内存缓存与 keyring 持久化、
 *                    登录态失效回调、会话生命周期（logout/refreshSession）
 *   - authHttp       签名请求（Rust authed_request）+ 超时保护 + 失效探测
 *   - authAccount    登录/注册/弦予号/邮箱绑定/验证码/找回密码/注销/改密
 *   - authProfile    个人资料/昵称审核/头像上传/封禁检查
 *
 * 秘钥与签名均在 Rust 侧完成（密钥不暴露给前端），token 存储于 OS keyring。
 */

// 类型
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

// 会话/凭证
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

// 签名请求
export { signedRequest } from './authHttp';

// 账号操作
export {
  getHumanCaptchaConfig,
  getUserAgreement,
  getHumanCaptcha,
  verifyHumanCaptcha,
  login,
  register,
  updateCiyuanxiId,
  bindEmail,
  sendEmailCode,
  resetPassword,
  preVerifyDeleteAccount,
  deleteAccount,
  changePassword,
} from './authAccount';

// 资料管理
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