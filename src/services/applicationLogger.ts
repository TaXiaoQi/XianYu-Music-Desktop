import { shallowReadonly, shallowRef } from 'vue';

import type { LogLevel, LogSettings } from '../types';

export const APPLICATION_LOG_STORAGE_KEY = 'xianyu_application_logs_v1';
export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const MAX_LOG_ENTRIES = 100;
const MAX_ERROR_LOG_ENTRIES = 10;

export interface ApplicationLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: string;
  scope: string;
  message: string;
}

export interface ApplicationLogAnalysis {
  status: 'healthy' | 'warning' | 'critical';
  headline: string;
  counts: Record<LogLevel, number>;
  total: number;
  findings: string[];
  topErrorCategory: string | null;
  latestErrorAt: number | null;
}

const defaultConfig: LogSettings = {
  minimumLevel: 'info',
  retentionDays: 1,
  autoAnalyze: true,
};

let activeConfig: LogSettings = { ...defaultConfig };

const isLogLevel = (value: unknown): value is LogLevel => (
  typeof value === 'string' && LOG_LEVELS.includes(value as LogLevel)
);

const normalizeStoredEntry = (value: unknown): ApplicationLogEntry | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Partial<ApplicationLogEntry>;
  if (
    typeof entry.id !== 'string'
    || typeof entry.timestamp !== 'number'
    || !Number.isFinite(entry.timestamp)
    || !isLogLevel(entry.level)
    || typeof entry.category !== 'string'
    || typeof entry.scope !== 'string'
    || typeof entry.message !== 'string'
  ) {
    return null;
  }
  return entry as ApplicationLogEntry;
};

const readStoredEntries = (): ApplicationLogEntry[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(APPLICATION_LOG_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredEntry).filter((entry): entry is ApplicationLogEntry => !!entry);
  } catch {
    return [];
  }
};

export const filterLogEntriesForRetention = (
  source: readonly ApplicationLogEntry[],
  _retentionDays: number,
  _now = Date.now(),
) => {
  // 只保留最近 100 条日志，错误日志只保留最近 10 条，超过从最远的开始清除
  let result = source.slice(-MAX_LOG_ENTRIES);
  // 在保留的条目中，错误日志只保留最近 10 条
  const errorEntries = result.filter(e => e.level === 'error');
  if (errorEntries.length > MAX_ERROR_LOG_ENTRIES) {
    const oldestErrorIdsToRemove = new Set(
      errorEntries.slice(0, errorEntries.length - MAX_ERROR_LOG_ENTRIES).map(e => e.id),
    );
    result = result.filter(e => !oldestErrorIdsToRemove.has(e.id));
  }
  return result;
};

const logEntries = shallowRef<ApplicationLogEntry[]>(
  filterLogEntriesForRetention(readStoredEntries(), activeConfig.retentionDays),
);

const persistEntries = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(APPLICATION_LOG_STORAGE_KEY, JSON.stringify(logEntries.value));
  } catch {
    logEntries.value = logEntries.value.slice(-Math.floor(MAX_LOG_ENTRIES / 2));
    try {
      localStorage.setItem(APPLICATION_LOG_STORAGE_KEY, JSON.stringify(logEntries.value));
    } catch {
      // Logging must never break the application when storage is unavailable or full.
    }
  }
};

export function installApplicationLogger(_scope = 'main') {
  // 已移除对 console.* 的劫持/过滤/截断，恢复浏览器控制台原生完整输出。
  // 保留空函数签名以兼容 main.ts 调用点。
}

export function configureApplicationLogger(config: LogSettings) {
  activeConfig = {
    minimumLevel: isLogLevel(config.minimumLevel) ? config.minimumLevel : defaultConfig.minimumLevel,
    retentionDays: 1,
    autoAnalyze: Boolean(config.autoAnalyze),
  };
  logEntries.value = filterLogEntriesForRetention(logEntries.value, activeConfig.retentionDays);
  persistEntries();
}

export function clearApplicationLogs() {
  logEntries.value = [];
  persistEntries();
}

export function analyzeApplicationLogs(
  source: readonly ApplicationLogEntry[],
): ApplicationLogAnalysis {
  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  const errorCategories = new Map<string, number>();
  let latestErrorAt: number | null = null;

  source.forEach((entry) => {
    counts[entry.level] += 1;
    if (entry.level === 'error') {
      errorCategories.set(entry.category, (errorCategories.get(entry.category) ?? 0) + 1);
      latestErrorAt = Math.max(latestErrorAt ?? 0, entry.timestamp);
    }
  });

  const topErrorCategory = [...errorCategories.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const status = counts.error > 0 ? 'critical' : counts.warn > 0 ? 'warning' : 'healthy';
  const headline = status === 'critical'
    ? `检测到 ${counts.error} 条错误日志`
    : status === 'warning'
      ? `检测到 ${counts.warn} 条警告日志`
      : '未发现明显异常';
  const findings: string[] = [];

  if (topErrorCategory) findings.push(`错误最集中的功能：${topErrorCategory}`);
  if (counts.error > 0 && counts.warn > counts.error * 2) {
    findings.push('错误发生前伴随较多警告，建议结合时间相邻的警告日志排查。');
  }
  if (source.length >= MAX_LOG_ENTRIES) {
    findings.push(`日志数量已达到本地上限（${MAX_LOG_ENTRIES} 条），较早记录可能已被自动清理。`);
  }
  if (findings.length === 0) {
    findings.push(source.length === 0 ? '当前没有可分析的日志。' : '日志级别分布正常，暂无集中故障特征。');
  }

  return {
    status,
    headline,
    counts,
    total: source.length,
    findings,
    topErrorCategory,
    latestErrorAt,
  };
}

export function formatApplicationLogExport(
  source: readonly ApplicationLogEntry[],
  mode: 'all' | 'error',
  analysis = analyzeApplicationLogs(source),
) {
  const selected = mode === 'error' ? source.filter(entry => entry.level === 'error') : source;
  const header = [
    '弦予音乐调试日志',
    `导出范围：${mode === 'error' ? '错误日志' : '全部日志'}`,
    `导出时间：${new Date().toISOString()}`,
    `日志数量：${selected.length}`,
    `自动分析：${analysis.headline}`,
    ...analysis.findings.map(finding => `分析提示：${finding}`),
    '',
  ];
  const lines = selected.map(entry => (
    `[${new Date(entry.timestamp).toISOString()}] [${entry.level.toUpperCase()}] [${entry.scope}/${entry.category}] ${entry.message}`
  ));
  return [...header, ...lines, ''].join('\n');
}

export function useApplicationLogs() {
  return {
    entries: shallowReadonly(logEntries),
    clearLogs: clearApplicationLogs,
  };
}
