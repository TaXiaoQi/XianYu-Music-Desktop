import type { AuthUser } from './authTypes';

/**
 * 账号认证服务 · 共享映射/格式化（叶子）。
 * mapUser / getAuthErrorMessage 等纯函数，被 authAccount / authProfile 复用。
 */

/** 将登录接口返回的 data 映射为前端统一的 AuthUser */
export function mapUser(data: Record<string, unknown>): AuthUser {
  const raw = data as Partial<{
    user_id: string | number;
    id: string | number;
    username: string;
    nickname: string;
    email: string;
    avatar_url: string | null;
    avatar: string | null;
    ciyuanxi_id: string | number;
    role: string;
  }>;
  return {
    id: String(raw.user_id ?? raw.id ?? ''),
    username: raw.username ?? '',
    nickname: raw.nickname || raw.username || '',
    email: raw.email ?? '',
    avatar: raw.avatar_url ?? raw.avatar ?? '',
    ciyuanxi_id: raw.ciyuanxi_id != null ? String(raw.ciyuanxi_id) : undefined,
    role: raw.role ?? '',
  };
}

export function getAuthErrorMessage(error: unknown, fallback = '请求失败'): string {
  if (!error) return fallback;
  if (typeof error === 'string' && error.trim()) return error;

  const anyError = error as { message?: string };

  if (typeof anyError.message === 'string' && anyError.message.trim()) {
    if (anyError.message.includes('Failed to fetch')) {
      return '网络异常，请检查服务器地址或网络连接';
    }
    if (anyError.message.includes('timeout')) return '请求超时，请稍后重试';
    return anyError.message;
  }
  return fallback;
}