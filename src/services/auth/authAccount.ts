import { getDeviceId } from '../domain/usageStats';
import { getAuthErrorMessage, mapUser } from './authShared';
import {
  clearAuth,
  getStoredUser,
  saveAuth,
} from './authSession';
import { requestAction, requestEnvelope } from './authHttp';
import type {
  AuthPayload,
  HumanCaptcha,
  HumanCaptchaConfig,
  HumanCaptchaPayload,
  UserAgreement,
  VerifyCodeType,
} from './authTypes';

/**
 * 账号认证服务 · 账号操作。
 * 登录/注册/弦予号/邮箱绑定/验证码/找回密码/注销/改密等接口封装。
 * 依赖 authSession（凭证）、authHttp（签名请求）、authShared（映射）。
 */

function withCaptcha(body: Record<string, unknown>, captcha: HumanCaptchaPayload): Record<string, unknown> {
  if (captcha.captchaToken) {
    return {
      ...body,
      captcha_token: captcha.captchaToken,
      turnstile_token: captcha.captchaToken,
      captcha_provider: captcha.provider || '',
    };
  }
  return {
    ...body,
    captcha_id: captcha.captchaId || '',
    captcha_answer: captcha.captchaAnswer || '',
  };
}

/** 人机验证配置缓存有效期：配置极少变动，缓存可避免每次弹验证题都先请求一次配置 */
const CAPTCHA_CONFIG_CACHE_MS = 10 * 60 * 1000;
let cachedCaptchaConfig: { value: HumanCaptchaConfig; fetchedAt: number } | null = null;

/**
 * 获取新版人机验证配置（10 分钟本地缓存）。
 * 启用 Turnstile / hCaptcha 时，客户端弹窗直接渲染第三方组件；未启用时回退旧算术题。
 * 远程服务器 RTT 较高，缓存命中时验证题弹窗可少一次网络往返。
 */
export async function getHumanCaptchaConfig(): Promise<HumanCaptchaConfig> {
  if (cachedCaptchaConfig && Date.now() - cachedCaptchaConfig.fetchedAt < CAPTCHA_CONFIG_CACHE_MS) {
    return cachedCaptchaConfig.value;
  }
  try {
    const data = await requestAction<Record<string, unknown>>('email_get_captcha_config', {});
    const value: HumanCaptchaConfig = {
      enabled: Boolean(data.enabled) && Boolean(data.site_key),
      provider: String(data.provider || 'off'),
      siteKey: String(data.site_key || ''),
    };
    cachedCaptchaConfig = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    // 请求失败时回退旧缓存（若有），避免网络抖动时误降级为算术题
    if (cachedCaptchaConfig) {
      return cachedCaptchaConfig.value;
    }
    return {
      enabled: false,
      provider: 'off',
      siteKey: '',
    };
  }
}

export async function getUserAgreement(): Promise<UserAgreement> {
  const data = await requestAction<Record<string, unknown>>('get_user_agreement', {});
  return {
    title: String(data.title || '弦予音乐用户协议'),
    content: String(data.content || ''),
  };
}

/**
 * 获取一次性人机验证码题目。
 * 当前服务端实现为简单数学题，提交登录/注册/验证码发送/找回密码时一并校验。
 */
export async function getHumanCaptcha(): Promise<HumanCaptcha> {
  const data = await requestAction<Record<string, unknown>>('get_captcha', {
    purpose: 'auth',
  });
  return {
    captcha_id: String(data.captcha_id ?? ''),
    question: String(data.question ?? ''),
    expire_seconds: Number(data.expire_seconds ?? 0) || undefined,
  };
}

/**
 * 预校验人机验证码。
 * 此接口只确认答案是否正确，不消费验证码；后续真实登录/注册/发码请求仍会再次校验并消费。
 */
export async function verifyHumanCaptcha(captcha: HumanCaptchaPayload): Promise<void> {
  if (captcha.captchaToken) return;
  await requestAction<Record<string, unknown>>('verify_captcha', {
    purpose: 'auth',
    captcha_id: captcha.captchaId || '',
    captcha_answer: captcha.captchaAnswer || '',
  });
}

/**
 * 弦予号登录（参考微信号设计：弦予号是唯一登录标识）
 * POST /api/?action=user_login
 */
export async function login(
  ciyuanxiId: string,
  password: string,
  captcha: HumanCaptchaPayload,
): Promise<AuthPayload> {
  try {
    const data = await requestAction<Record<string, unknown>>('user_login', withCaptcha({
      ciyuanxi_id: ciyuanxiId,
      password,
      device_id: getDeviceId(),
    }, captcha));
    if (!data.token) throw new Error('登录响应无效');
    const payload: AuthPayload = { token: String(data.token), user: mapUser(data) };
    saveAuth(payload);
    return payload;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '登录失败'), { cause: error });
  }
}

/**
 * 用户注册（弦予号必填，昵称可选留空则服务端默认"弦予+号"；注册成功后自动登录获取会话）。
 * POST /api/?action=register
 */
export async function register(
  ciyuanxiId: string,
  nickname: string,
  password: string,
  email: string,
  code: string,
  captcha: HumanCaptchaPayload,
): Promise<AuthPayload> {
  try {
    const data = await requestAction<Record<string, unknown>>('register', withCaptcha({
      ciyuanxi_id: ciyuanxiId.trim(),
      nickname,
      password,
      email,
      verify_code: code,
      device_id: getDeviceId(),
    }, captcha));
    if (!data.token) throw new Error('注册响应无效');
    const payload: AuthPayload = { token: String(data.token), user: mapUser(data) };
    saveAuth(payload);
    return payload;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '注册失败'), { cause: error });
  }
}

/**
 * 修改弦予号（参考微信号设计：可修改但每月仅限一次）。
 * 需当前弦予号 + 登录密码校验。
 * POST /api/?action=update_ciyuanxi_id
 */
export async function updateCiyuanxiId(
  oldCiyuanxiId: string,
  newCiyuanxiId: string,
  password: string,
): Promise<{ message: string; ciyuanxi_id: string }> {
  try {
    const data = await requestAction<{ ciyuanxi_id?: string }>('update_ciyuanxi_id', {
      ciyuanxi_id: oldCiyuanxiId,
      new_ciyuanxi_id: newCiyuanxiId,
      password,
    });
    return {
      message: '弦予号修改成功',
      ciyuanxi_id: String(data.ciyuanxi_id ?? newCiyuanxiId),
    };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '弦予号修改失败'), { cause: error });
  }
}

/**
 * 绑定邮箱（通过 type='bind' 的邮箱验证码）
 * POST /api/?action=bind_email
 */
export async function bindEmail(
  ciyuanxiId: string,
  email: string,
  verifyCode: string,
): Promise<{ message: string; email: string }> {
  try {
    const data = await requestAction<{ email?: string }>('bind_email', {
      ciyuanxi_id: ciyuanxiId,
      email,
      verify_code: verifyCode,
    });
    return { message: '邮箱绑定成功', email: String(data.email ?? email) };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '邮箱绑定失败'), { cause: error });
  }
}

/**
 * 发送邮箱验证码（注册 / 登录 / 找回密码 / 绑定邮箱等场景，通过 type 区分）
 * POST /api/?action=send_verify_code
 */
export async function sendEmailCode(
  email: string,
  type: VerifyCodeType = 'register',
  captcha: HumanCaptchaPayload,
  ciyuanxiId?: string,
): Promise<{ success: true; message: string }> {
  try {
    const payload = await requestEnvelope<Record<string, unknown>>('send_verify_code', withCaptcha({
      email,
      type,
      ...(ciyuanxiId ? { ciyuanxi_id: ciyuanxiId } : {}),
    }, captcha));
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '验证码发送失败');
    }
    return { success: true, message: payload.msg || '验证码已发送到邮箱' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '验证码发送失败'), { cause: error });
  }
}

/**
 * 找回密码（重置密码）
 * POST /api/?action=reset_password
 */
export async function resetPassword(
  email: string,
  verifyCode: string,
  newPassword: string,
  captcha: HumanCaptchaPayload,
): Promise<{ message: string }> {
  try {
    const payload = await requestEnvelope<Record<string, unknown>>('reset_password', withCaptcha({
      email,
      verify_code: verifyCode,
      new_password: newPassword,
    }, captcha));
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '重置密码失败');
    }
    return { message: payload.msg || '密码修改成功' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '重置密码失败'), { cause: error });
  }
}

/**
 * 预验证注销凭据（密码 + 邮箱验证码）。
 * 仅校验凭据是否正确，不执行实际注销。
 * 用于二级确认弹窗弹出时提前验证，减少用户点击确认后的等待时间。
 */
export async function preVerifyDeleteAccount(
  verifyCode: string,
  password: string,
): Promise<{ message: string }> {
  const current = getStoredUser();
  if (!current?.ciyuanxi_id || !current.email) {
    throw new Error('未获取到当前账号信息，请重新登录');
  }
  if (!password) {
    throw new Error('请输入登录密码');
  }
  if (!verifyCode) {
    throw new Error('请输入邮箱验证码');
  }

  try {
    const payload = await requestEnvelope<Record<string, unknown>>('preverify_delete_account', {
      ciyuanxi_id: current.ciyuanxi_id,
      email: current.email,
      verify_code: verifyCode,
      password,
    });
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '凭据验证失败');
    }
    return { message: payload.msg || '验证通过' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '凭据验证失败'), { cause: error });
  }
}

/**
 * 注销当前账号。
 * 需要当前账号登录密码 + 注册邮箱收到的 delete_account 验证码，双重验证。
 */
export async function deleteAccount(
  verifyCode: string,
  password: string,
): Promise<{ message: string }> {
  const current = getStoredUser();
  if (!current?.ciyuanxi_id || !current.email) {
    throw new Error('未获取到当前账号信息，请重新登录');
  }
  if (!password) {
    throw new Error('请输入登录密码');
  }

  try {
    const payload = await requestEnvelope<Record<string, unknown>>('delete_account', {
      ciyuanxi_id: current.ciyuanxi_id,
      email: current.email,
      verify_code: verifyCode,
      password,
    });
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '注销账号失败');
    }
    clearAuth();
    return { message: payload.msg || '账号已注销' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '注销账号失败'), { cause: error });
  }
}

/**
 * 修改密码（需登录，使用弦予号 + 旧密码验证）
 * POST /api/?action=change_password
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  code: string,
): Promise<{ message: string }> {
  const user = getStoredUser();
  const ciyuanxiId = user?.ciyuanxi_id;
  if (!ciyuanxiId) throw new Error('未获取到弦予号，无法修改密码，请重新登录');

  try {
    const payload = await requestEnvelope<Record<string, unknown>>('change_password', {
      ciyuanxi_id: ciyuanxiId,
      old_password: oldPassword,
      new_password: newPassword,
      code,
    });
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '修改密码失败');
    }
    return { message: payload.msg || '密码修改成功' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '修改密码失败'), { cause: error });
  }
}

