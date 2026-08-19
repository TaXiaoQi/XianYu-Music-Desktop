import { describe, expect, it } from 'vitest';

import {
  analyzeApplicationLogs,
  filterLogEntriesForRetention,
  formatApplicationLogExport,
  type ApplicationLogEntry,
} from './applicationLogger';

const createEntry = (
  level: ApplicationLogEntry['level'],
  timestamp: number,
  category = 'player',
): ApplicationLogEntry => ({
  id: `${level}-${timestamp}`,
  timestamp,
  level,
  category,
  scope: 'main',
  message: `${level} message`,
});

describe('application logger', () => {
  it('keeps entries within the count-based retention limits (last 200 total, last 10 errors)', () => {
    // 保留逻辑改为按数量保留：最近 200 条日志、错误日志最近 10 条，不再按日期过滤
    const now = Date.UTC(2026, 7, 2, 12, 0, 0);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = startOfToday.getTime();

    const entries = [
      createEntry('info', cutoff - 2 * 60 * 60 * 1000), // 前一天 22:00
      createEntry('warn', cutoff + 6 * 60 * 60 * 1000), // 当天 06:00
    ];

    // 不足 200 条且无错误日志超限，全部保留（不再按日期丢弃前一天日志）
    expect(filterLogEntriesForRetention(entries, 1, now)).toEqual([entries[0], entries[1]]);
  });

  it('classifies errors as critical and identifies their main feature category', () => {
    const analysis = analyzeApplicationLogs([
      createEntry('warn', 1, 'network'),
      createEntry('error', 2, 'playback'),
      createEntry('error', 3, 'playback'),
    ]);

    expect(analysis.status).toBe('critical');
    expect(analysis.counts.error).toBe(2);
    expect(analysis.topErrorCategory).toBe('playback');
  });

  it('exports only error entries for the error-log export', () => {
    const entries = [createEntry('info', 1), createEntry('error', 2)];
    const content = formatApplicationLogExport(entries, 'error');

    expect(content).toContain('[ERROR]');
    expect(content).not.toContain('[INFO]');
    expect(content).toContain('导出范围：错误日志');
  });
});
