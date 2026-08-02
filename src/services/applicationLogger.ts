import { readonly, ref } from 'vue';

import type { LogLevel, LogSettings } from '../types';

export const APPLICATION_LOG_STORAGE_KEY = 'lycia_application_logs_v1';
export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const MAX_LOG_ENTRIES = 3000;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

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
  retentionDays: 14,
  autoAnalyze: true,
};

let activeConfig: LogSettings = { ...defaultConfig };
let installed = false;
let sequence = 0;

const isLogLevel = (value: unknown): value is LogLevel => (
  typeof value === 'string' && LOG_LEVELS.includes(value as LogLevel)
);

const sanitizeText = (value: string) => value
  .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
  .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
  .replace(/((?:password|token|secret|cookie)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');

const serializeLogValue = (value: unknown): string => {
  if (typeof value === 'string') return sanitizeText(value);
  if (value instanceof Error) return sanitizeText(value.stack || `${value.name}: ${value.message}`);
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;

  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (key, nestedValue: unknown) => {
      if (/(password|token|secret|authorization|cookie|credential)/i.test(key)) {
        return '[REDACTED]';
      }
      if (nestedValue && typeof nestedValue === 'object') {
        if (seen.has(nestedValue as object)) return '[Circular]';
        seen.add(nestedValue as object);
      }
      return nestedValue;
    });
    return sanitizeText(serialized ?? String(value));
  } catch {
    return sanitizeText(String(value));
  }
};

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
  retentionDays: number,
  now = Date.now(),
) => {
  const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  return source
    .filter(entry => entry.timestamp >= cutoff)
    .slice(-MAX_LOG_ENTRIES);
};

const logEntries = ref<ApplicationLogEntry[]>(
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

const resolveCategory = (args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string') {
    const taggedCategory = first.match(/^\[([^\]]{1,48})\]/)?.[1]?.trim();
    if (taggedCategory) return taggedCategory;
  }
  if (first instanceof Error && first.name) return first.name;
  return 'application';
};

const recordLog = (level: LogLevel, scope: string, args: unknown[]) => {
  if (LEVEL_RANK[level] < LEVEL_RANK[activeConfig.minimumLevel]) return;

  const now = Date.now();
  const entry: ApplicationLogEntry = {
    id: `${now}-${sequence++}`,
    timestamp: now,
    level,
    category: resolveCategory(args),
    scope,
    message: args.map(serializeLogValue).join(' '),
  };

  logEntries.value = filterLogEntriesForRetention(
    [...logEntries.value, entry],
    activeConfig.retentionDays,
    now,
  );
  persistEntries();
};

export function installApplicationLogger(scope = 'main') {
  if (installed || typeof console === 'undefined') return;
  installed = true;

  const original = {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    recordLog('debug', scope, args);
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    recordLog('info', scope, args);
  };
  console.log = (...args: unknown[]) => {
    original.log(...args);
    recordLog('info', scope, args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    recordLog('warn', scope, args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    recordLog('error', scope, args);
  };
}

export function configureApplicationLogger(config: LogSettings) {
  activeConfig = {
    minimumLevel: isLogLevel(config.minimumLevel) ? config.minimumLevel : defaultConfig.minimumLevel,
    retentionDays: Number.isFinite(config.retentionDays)
      ? Math.min(365, Math.max(1, Math.round(config.retentionDays)))
      : defaultConfig.retentionDays,
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
    findings.push('日志数量已达到本地上限，较早记录可能已被自动清理。');
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
    entries: readonly(logEntries),
    clearLogs: clearApplicationLogs,
  };
}
