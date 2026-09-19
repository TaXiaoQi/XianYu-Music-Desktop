
import { APP_VERSION } from '../../../version';
import { signedRequest, getStoredAuth } from '../auth/authService';
import {
  getDeviceId,
  getDeviceInfo,
  enrichSystemInfo,
  syncStableDeviceId,
} from './usageStatsDevice';

export function reportAppOpen(): void {
  void (async () => {
    await syncStableDeviceId();
    void enrichSystemInfo();
    const info = getDeviceInfo();
    const auth = getStoredAuth();
    const ciyuanxiId = auth?.user?.ciyuanxi_id ?? '';
    await signedRequest('open', { ...info, platform: 'desktop', ciyuanxi_id: ciyuanxiId }).catch(
      () => {
        /* 上报失败，静默 */
      },
    );
  })();
}

let lastSearchKey = '';
let lastSearchTime = 0;
const SEARCH_MIN_INTERVAL_MS = 1500;

export function reportSearch(keyword: string, source: string, resultCount: number): void {
  const trimmed = (keyword || '').trim();
  if (!trimmed) return;
  const key = `${source}::${trimmed}`;
  const now = Date.now();
  if (key === lastSearchKey && now - lastSearchTime < SEARCH_MIN_INTERVAL_MS) return;
  lastSearchKey = key;
  lastSearchTime = now;

  const info = getDeviceInfo();
  void signedRequest('search', {
    device_id: info.device_id,
    keyword: trimmed,
    source,
    result_count: resultCount,
  })
    .then(() => {
      /* 上报成功，静默 */
    })
    .catch(() => {
      /* 上报失败，静默 */
    });
}


let pendingCharCount = 0;
let inputFlushTimer: ReturnType<typeof setTimeout> | null = null;
const INPUT_FLUSH_DELAY_MS = 1500;

export function reportInputStats(charCount: number): void {
  if (charCount <= 0) return;
  pendingCharCount += charCount;

  if (inputFlushTimer) clearTimeout(inputFlushTimer);
  inputFlushTimer = setTimeout(() => {
    const count = pendingCharCount;
    pendingCharCount = 0;
    inputFlushTimer = null;
    if (count <= 0) return;

    const info = getDeviceInfo();
    void signedRequest('input_stats', {
      device_id: info.device_id,
      char_count: count,
    })
      .then(() => {
        /* 上报成功，静默 */
      })
      .catch(() => {
        /* 上报失败，静默 */
      });
  }, INPUT_FLUSH_DELAY_MS);
}


const recentErrors = new Map<string, number>();
const ERROR_DEDUP_INTERVAL_MS = 5000;
const MAX_RECENT_ERRORS = 20;

export function reportError(
  errorType: string,
  errorMessage: string,
  errorStack?: string,
  page?: string,
): void {
  const dedupKey = `${errorType}::${errorMessage}`;
  const now = Date.now();
  const lastTime = recentErrors.get(dedupKey);
  if (lastTime && now - lastTime < ERROR_DEDUP_INTERVAL_MS) return;
  recentErrors.set(dedupKey, now);
  if (recentErrors.size > MAX_RECENT_ERRORS) {
    for (const [key, time] of recentErrors) {
      if (now - time > ERROR_DEDUP_INTERVAL_MS) recentErrors.delete(key);
    }
  }

  const info = getDeviceInfo();
  void signedRequest('error', {
    device_id: info.device_id,
    app_version: info.app_version,
    os_version: info.os_version,
    device_model: info.device_model,
    device_brand: info.device_brand,
    architecture: info.architecture,
    machine_name: info.machine_name,
    platform: 'windows',
    error_type: errorType,
    error_message: errorMessage,
    error_stack: errorStack || '',
    page: page || (typeof location !== 'undefined' ? location.hash : ''),
  })
    .then(() => {
      /* 上报成功，静默 */
    })
    .catch(() => {
      /* 上报失败，静默 */
    });
}


export interface HotSearchItem {
  keyword: string;
  count: number;
}

export async function fetchHotSearch(limit = 10): Promise<HotSearchItem[]> {
  try {
    const data = await signedRequest<{ list: Array<{ keyword: string; count: number }> }>(
      'get_hot_search',
      { limit },
      { fetchTimeoutMs: 8_000, timeoutMs: 10_000 },
    );
    return data?.list ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[HotSearch] 获取热搜失败: ${msg}`);
    return [];
  }
}


export interface UserBehaviorReport {
  song_id: string;
  song_name: string;
  singer: string;
  song_hash: string;
  source: string;
  action: 'play' | 'switch' | 'complete' | 'next';
  listen_duration: number;
  play_count: number;
  ciyuanxi_id?: string;
  user_id?: number;
}

export function reportUserBehavior(report: UserBehaviorReport): void {
  const info = getDeviceInfo();
  const send = () => {
    void signedRequest('report_user_behavior', {
      device_id: info.device_id,
      app_version: info.app_version,
      ...report,
    })
      .then(() => {
        /* 上报成功，静默 */
      })
      .catch(() => {
        /* 上报失败，静默 */
      });
  };

  const requestIdle = typeof window !== 'undefined'
    ? (window as any).requestIdleCallback as
      | ((callback: () => void, options?: { timeout?: number }) => number)
      | undefined
    : undefined;

  if (requestIdle) {
    requestIdle(send, { timeout: 3000 });
  } else {
    setTimeout(send, 500);
  }
}


export async function submitFeedback(
  title: string,
  content: string,
  options: {
    feedbackType?: 'problem' | 'suggestion' | 'beta';
    errorLogs?: string;
    allLogs?: string;
    images?: string[];
  } = {},
): Promise<number> {
  const auth = getStoredAuth();
  const user = auth?.user;
  const ciyuanxiId = user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    throw new Error('请先登录后再提交反馈');
  }

  const feedbackType = options.feedbackType ?? 'problem';
  const info = getDeviceInfo();
  const payload: Record<string, unknown> = {
    ciyuanxi_id: ciyuanxiId,
    nickname: user?.nickname?.trim() || '',
    title: title.trim(),
    content: content.trim(),
    feedback_type: feedbackType,
    platform: 'desktop',
    app_version: APP_VERSION,
    device_id: getDeviceId(),
    os_version: info.os_version,
    device_model: info.device_model,
    device_brand: info.device_brand,
    architecture: info.architecture,
    machine_name: info.machine_name,
  };
  if (options.errorLogs) payload.error_logs = options.errorLogs;
  if (options.allLogs) payload.all_logs = options.allLogs;
  if (options.images && options.images.length > 0) payload.images = options.images;

  const data = await signedRequest<{ id: string | number }>('submit_feedback', payload);
  return Number(data.id);
}

export interface MyFeedbackItem {
  id: number;
  title: string;
  content: string;
  feedbackType: 'problem' | 'suggestion' | 'beta';
  images: string[];
  status: 'pending' | 'processing' | 'resolved' | 'rejected';
  category: string;
  assignee: string;
  repliedBy: string;
  resolveNote: string;
  resolveImages: string[];
  rejectReason: string;
  hasErrorLogs: boolean;
  hasAllLogs: boolean;
  createdAt: string;
  repliedAt: string;
  updatedAt: string;
}

export async function getMyFeedback(): Promise<MyFeedbackItem[]> {
  const auth = getStoredAuth();
  const user = auth?.user;
  const ciyuanxiId = user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    throw new Error('请先登录后再查看反馈');
  }
  const data = await signedRequest<{ list: MyFeedbackItem[] }>('list_my_feedback', {
    ciyuanxi_id: ciyuanxiId,
  });
  return data?.list ?? [];
}

export async function submitAppeal(
  ciyuanxiId: string,
  nickname: string,
  content: string,
): Promise<number> {
  const payload: Record<string, unknown> = {
    ciyuanxi_id: ciyuanxiId,
    nickname: nickname.trim() || '',
    content: content.trim(),
  };
  const data = await signedRequest<{ id: string | number }>('submit_appeal', payload);
  return Number(data.id);
}