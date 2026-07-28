import { describe, expect, it } from 'vitest';
import { isRemoteSong, parseIntervalToSeconds } from './remoteSong';

describe('isRemoteSong', () => {
  it('returns true for songs marked as remote by source_type', () => {
    expect(isRemoteSong({ path: 'C:/Music/demo.flac', source_type: 'remote' })).toBe(true);
  });

  it('returns true for remote uri songs without source_type', () => {
    expect(isRemoteSong({ path: 'remote://source/demo.flac' })).toBe(true);
  });

  it('returns false for local songs', () => {
    expect(isRemoteSong({ path: 'C:/Music/demo.flac', source_type: 'local' })).toBe(false);
  });
});

describe('parseIntervalToSeconds', () => {
  it('parses mm:ss format', () => {
    expect(parseIntervalToSeconds('04:23')).toBe(263);
    expect(parseIntervalToSeconds('00:00')).toBe(0);
    expect(parseIntervalToSeconds('03:07')).toBe(187);
  });

  it('parses hh:mm:ss format', () => {
    expect(parseIntervalToSeconds('01:02:03')).toBe(3723);
    expect(parseIntervalToSeconds('02:00:00')).toBe(7200);
  });

  it('parses bare seconds string', () => {
    expect(parseIntervalToSeconds('263')).toBe(263);
  });

  it('handles mm:ss with minutes over 60', () => {
    expect(parseIntervalToSeconds('75:30')).toBe(4530);
  });

  it('returns 0 for empty/undefined/invalid input', () => {
    expect(parseIntervalToSeconds(undefined)).toBe(0);
    expect(parseIntervalToSeconds(null)).toBe(0);
    expect(parseIntervalToSeconds('')).toBe(0);
    expect(parseIntervalToSeconds('abc')).toBe(0);
    expect(parseIntervalToSeconds('12:xx')).toBe(0);
  });
});
