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

const CAPTCHA_CONFIG_CACHE_MS = 10 * 60 * 1000;
let cachedCaptchaConfig: { value: HumanCaptchaConfig; fetchedAt: number } | null = null;

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

export async function verifyHumanCaptcha(captcha: HumanCaptchaPayload): Promise<void> {
  if (captcha.captchaToken) return;
  await requestAction<Record<string, unknown>>('verify_captcha', {
    purpose: 'auth',
    captcha_id: captcha.captchaId || '',
    captcha_answer: captcha.captchaAnswer || '',
  });
}

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

export async function loginByEmail(
  email: string,
  verifyCode: string,
  captcha: HumanCaptchaPayload,
): Promise<AuthPayload> {
  try {
    const data = await requestAction<Record<string, unknown>>('login_by_code', withCaptcha({
      email,
      verify_code: verifyCode,
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

