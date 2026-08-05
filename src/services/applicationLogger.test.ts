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
  it('removes entries from before today (only keeps same-day logs)', () => {
    // 使用当天中午作为 now，确保 cutoff 是当天 00:00
    const now = Date.UTC(2026, 7, 2, 12, 0, 0);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = startOfToday.getTime();

    const entries = [
      createEntry('info', cutoff - 2 * 60 * 60 * 1000), // 前一天 22:00
      createEntry('warn', cutoff + 6 * 60 * 60 * 1000), // 当天 06:00
    ];

    expect(filterLogEntriesForRetention(entries, 1, now)).toEqual([entries[1]]);
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
