import { getDeviceId, getDeviceInfo } from '../domain/usageStats';
import { getAuthErrorMessage, mapUser } from './authShared';
import { requestAction } from './authHttp';
import { saveAuth } from './authSession';
import type { AuthUser } from './authTypes';

const LOCATION_CACHE_KEY = 'xy.qr.location';

/**
 * 获取本机位置（IP 归属地），供移动端扫码确认页展示「被扫码设备位置」。
 * 尽力而为：失败或超时回退为设备信息，不影响二维码生成。
 */
async function getDesktopLocation(): Promise<string> {
  try {
    const cached = localStorage.getItem(LOCATION_CACHE_KEY);
    if (cached) return cached;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const d = (await res.json()) as {
        city?: string;
        region?: string;
        country_name?: string;
        ip?: string;
      };
      const parts = [d.city, d.region, d.country_name].filter(
        (v): v is string => !!v && v !== 'undefined',
      );
      if (parts.length > 0) {
        const label = parts.join(' ');
        try {
          localStorage.setItem(LOCATION_CACHE_KEY, label);
        } catch {
          /* ignore */
        }
        return label;
      }
    }
  } catch {
    /* 忽略定位失败，走回退 */
  }
  const dev = getDeviceInfo();
  return dev.device_model || 'Windows';
}

/**
 * 账号认证服务 · 扫码登录（桌面端）。
 * generate_tv_login_code / poll_tv_login_status 均为免签接口；
 * 二维码内容（含 code）由前端生成并渲染，手机 App 扫码确认后轮询拿回凭证。
 */

export type QrLoginStatus = 'pending' | 'scanned' | 'logged_in' | 'invalid' | 'expired';

export type QrCodeInfo = {
  code: string;
  expireSeconds: number;
};

export type QrPollResult = {
  status: QrLoginStatus;
  token?: string;
  user?: AuthUser;
};

/**
 * 创建扫码登录二维码（桌面端）。
 * POST /api/?action=generate_tv_login_code
 */
export async function createQrLoginCode(): Promise<QrCodeInfo> {
  try {
    const location = await getDesktopLocation();
    const data = await requestAction<Record<string, unknown>>('generate_tv_login_code', {
      device_id: getDeviceId(),
      location,
    });
    return {
      code: String(data.code ?? ''),
      expireSeconds: Number(data.expire_seconds ?? 300),
    };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '二维码获取失败'), { cause: error });
  }
}

/**
 * 轮询扫码登录状态（桌面端）。
 * POST /api/?action=poll_tv_login_status
 * 状态收敛：pending / scanned / logged_in（带 token+user）/ invalid（过期/禁用）。
 */
export async function pollQrLoginStatus(code: string): Promise<QrPollResult> {
  try {
    const data = await requestAction<Record<string, unknown>>('poll_tv_login_status', {
      code,
      device_id: getDeviceId(),
    });
    const status = String(data.status ?? 'pending');
    if (status === 'logged_in' && data.token) {
      const user = data.user_id != null ? mapUser(data) : undefined;
      // 与账号密码登录一致：更新 authSession 缓存并持久化 keyring，
      // 保证后续 getProfile 可执行、重启后登录态不丢
      if (user) saveAuth({ token: String(data.token), user });
      return {
        status: 'logged_in',
        token: String(data.token),
        user,
      };
    }
    if (status === 'scanned') return { status: 'scanned' };
    return { status: 'pending' };
  } catch {
    // invalid(404) / banned(403) 一律收敛为 invalid，由 UI 提示刷新
    return { status: 'invalid' };
  }
}