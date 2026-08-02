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
  it('removes entries outside the configured retention period', () => {
    const now = Date.UTC(2026, 7, 2);
    const entries = [
      createEntry('info', now - 2 * 24 * 60 * 60 * 1000),
      createEntry('warn', now - 12 * 60 * 60 * 1000),
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
