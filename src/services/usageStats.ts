/**
 * 软件使用统计上报服务
 *
 * 将软件打开、搜索、输入、播放行为、错误等上报到后台统计接口（与账号 API 共用同一签名机制）。
 * - POST /api/?action=open                 软件打开（写入 app_open_log）
 * - POST /api/?action=search               搜索（写入 search_log）
 * - POST /api/?action=input_stats          输入统计（写入 input_stats_log）
 * - POST /api/?action=error                错误日志（写入 error_log）
 * - POST /api/?action=report_user_behavior 用户行为（写入 user_behavior_log）
 * 设备连接数由后端从 app_open_log 的 device_id 去重统计得到。
 *
 * 全部为 fire-and-forget：失败静默吞掉，绝不阻塞 UI 或抛错。
 */

import { APP_VERSION } from '../../version';
import { signedRequest, getStoredAuth } from './auth/authService';

const DEVICE_ID_KEY = 'xy.device.id';

/** 生成 RFC4122 v4 UUID */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** 获取（或首次生成并持久化）稳定的设备标识 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generateUuid();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

/** 从 navigator.userAgent 解析操作系统版本（项目仅支持 Windows） */
function parseOsVersion(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const m = ua.match(/Windows NT (\d+\.\d+)/);
  if (m) {
    const v = parseFloat(m[1]);
    // NT 10.0+ 在用户 Agent 中同时覆盖 Win10/Win11，无法精确区分，统一标记
    return v >= 10 ? `Windows NT ${m[1]}` : `Windows NT ${m[1]}`;
  }
  return 'Windows';
}

function getDeviceModel(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const arch = /WOW64|Win64|x64/.test(ua) ? 'x64' : 'x86';
  return `Windows PC (${arch})`;
}

export interface DeviceInfo {
  device_id: string;
  app_version: string;
  os_version: string;
  device_model: string;
}

let cachedDeviceInfo: DeviceInfo | null = null;

function getDeviceInfo(): DeviceInfo {
  if (!cachedDeviceInfo) {
    cachedDeviceInfo = {
      device_id: getDeviceId(),
      app_version: APP_VERSION,
      os_version: parseOsVersion(),
      device_model: getDeviceModel(),
    };
  }
  return cachedDeviceInfo;
}

/**
 * 上报软件打开事件（启动时调用一次）。
 * 后端写入 app_open_log，同时作为设备连接数的来源（按 device_id 去重）。
 */
export function reportAppOpen(): void {
  const info = getDeviceInfo();
  void signedRequest('open', { ...info })
    .then(() => {
      /* 上报成功，静默 */
    })
    .catch(() => {
      /* 上报失败，静默 */
    });
}

// 搜索上报防抖：相同关键词 + 来源在短时间内只上报一次，避免逐字搜索刷量
let lastSearchKey = '';
let lastSearchTime = 0;
const SEARCH_MIN_INTERVAL_MS = 1500;

/**
 * 上报一次搜索行为。
 * @param keyword 搜索关键词
 * @param source  音源名称（如 kw/tx/wy/本地）
 * @param resultCount 结果数量
 */
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

// ─── 输入统计 ───────────────────────────────────────────

// 防抖：累积字符数，1.5 秒无新输入后批量上报，避免逐键请求
let pendingCharCount = 0;
let inputFlushTimer: ReturnType<typeof setTimeout> | null = null;
const INPUT_FLUSH_DELAY_MS = 1500;

/**
 * 上报用户输入的字符数（防抖累积后批量上报）。
 * @param charCount 本次新增的字符数
 */
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

// ─── 错误日志 ───────────────────────────────────────────

// 防重复：相同错误 5 秒内只上报一次
const recentErrors = new Map<string, number>();
const ERROR_DEDUP_INTERVAL_MS = 5000;
const MAX_RECENT_ERRORS = 20;

/**
 * 上报一条错误日志。
 * @param errorType    错误类型（如 'TypeError'、'unhandledrejection'）
 * @param errorMessage 错误信息
 * @param errorStack   错误堆栈（可选）
 * @param page         发生页面（可选，默认 location.hash）
 */
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
  // 清理过期条目，防止 Map 无限增长
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
    platform: 'windows',
    device_brand: '',
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

// ─── 用户行为数据 ───────────────────────────────────────────

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

/**
 * 上报用户播放行为（播放/切歌/播完/下一首）。
 * @param report 行为数据
 *
 * [性能优化] 使用 requestIdleCallback 延迟到浏览器空闲时再发起 HTTP 请求。
 * reportUserBehavior 在 playSong → flushPlaySession 中被调用，此时正准备播放。
 * 如果立即通过 Tauri HTTP 插件发起 IPC 请求（fetchElapsed 可达 1.7s），
 * 会与紧随其后的 playAudio IPC 调用产生通道竞争，导致播放起播延迟约 1 秒。
 * 延迟到空闲期可确保 playAudio 先于 HTTP 请求被投递。
 */
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

// ─── 问题反馈 ───────────────────────────────────────────

/**
 * 提交问题反馈或建议。
 *
 * 与其他 report* 函数不同：本函数**不** fire-and-forget，而是返回 Promise，
 * 由调用方根据成功/失败给出 toast 反馈（用户主动提交需要即时反馈）。
 *
 * @param title        反馈标题（1-60 字）
 * @param content      反馈内容（1-1000 字）
 * @param errorLogs    可选，附带的错误日志文本
 * @param allLogs      可选，附带的全量日志文本
 * @returns 后端返回的新反馈 ID
 * @throws 未登录时抛 Error('请先登录后再提交反馈')；后端校验失败抛 Error(msg)
 */
export async function submitFeedback(
  title: string,
  content: string,
  errorLogs?: string,
  allLogs?: string,
): Promise<number> {
  const auth = getStoredAuth();
  const user = auth?.user;
  const ciyuanxiId = user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    throw new Error('请先登录后再提交反馈');
  }

  const payload: Record<string, unknown> = {
    ciyuanxi_id: ciyuanxiId,
    nickname: user?.nickname?.trim() || '',
    title: title.trim(),
    content: content.trim(),
  };
  if (errorLogs) payload.error_logs = errorLogs;
  if (allLogs) payload.all_logs = allLogs;

  const data = await signedRequest<{ id: string | number }>('submit_feedback', payload);
  return Number(data.id);
}

/**
 * 账号封禁申诉：调用 submit_appeal 接口，并入 user_feedback 表（category='appeal'）。
 * 与普通反馈共享每日限额。
 */
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
