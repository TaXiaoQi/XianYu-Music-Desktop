import { getDeviceId, getDeviceInfo } from '../domain/usageStats';
import { getAuthErrorMessage, mapUser } from './authShared';
import { requestAction } from './authHttp';
import { saveAuth } from './authSession';
import type { AuthUser } from './authTypes';

const LOCATION_CACHE_KEY = 'xy.qr.location';

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

export async function pollQrLoginStatus(code: string): Promise<QrPollResult> {
  try {
    const data = await requestAction<Record<string, unknown>>('poll_tv_login_status', {
      code,
      device_id: getDeviceId(),
    });
    const status = String(data.status ?? 'pending');
    if (status === 'logged_in' && data.token) {
      const user = data.user_id != null ? mapUser(data) : undefined;
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
    return { status: 'invalid' };
  }
}