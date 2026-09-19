
import { describe, expect, it } from 'vitest';

import {
  extFromUrl,
  isDegradedLossless,
  resolveActualQuality,
} from './audioQualityVerify';

describe('audioQualityVerify: extFromUrl', () => {
  it('extracts common audio extensions', () => {
    expect(extFromUrl('https://cdn.example.com/song.flac')).toBe('.flac');
    expect(extFromUrl('https://cdn.example.com/song.mp3')).toBe('.mp3');
    expect(extFromUrl('https://cdn.example.com/a/b/song.M4A')).toBe('.m4a');
  });

  it('ignores query strings when inferring the extension', () => {
    expect(extFromUrl('https://cdn.example.com/song.flac?token=abc.mp3')).toBe('.flac');
  });

  it('returns empty for urls without an audio extension', () => {
    expect(extFromUrl('http://m801.music.126.net/20260808/abcdef/jdymusic/obj/wo3')).toBe('');
    expect(extFromUrl('https://cdn.example.com/song.txt')).toBe('');
    expect(extFromUrl('not-a-url')).toBe('');
  });
});

describe('audioQualityVerify: isDegradedLossless', () => {
  it('flags a lossless quality served as a lossy format', () => {
    expect(isDegradedLossless('flac', 'https://cdn.example.com/x.mp3')).toBe(true);
    expect(isDegradedLossless('flac24bit', 'https://cdn.example.com/x.m4a')).toBe(true);
    expect(isDegradedLossless('hires', 'https://cdn.example.com/x.aac')).toBe(true);
    expect(isDegradedLossless('master', 'https://cdn.example.com/x.ogg')).toBe(true);
  });

  it('accepts a lossless quality served as a lossless format', () => {
    expect(isDegradedLossless('flac', 'https://cdn.example.com/x.flac')).toBe(false);
    expect(isDegradedLossless('hires', 'https://cdn.example.com/x.wav')).toBe(false);
    expect(isDegradedLossless('flac24bit', 'https://cdn.example.com/x.ape')).toBe(false);
  });

  it('never flags a lossy quality regardless of extension', () => {
    expect(isDegradedLossless('320k', 'https://cdn.example.com/x.mp3')).toBe(false);
    expect(isDegradedLossless('128k', 'https://cdn.example.com/x.m4a')).toBe(false);
  });

  it('does not presume degradation when the url has no extension', () => {
    expect(isDegradedLossless('flac', 'http://m801.music.126.net/2026/abc/obj/wo3')).toBe(false);
    expect(isDegradedLossless('hires', 'https://cdn.example.com/stream?id=1')).toBe(false);
  });
});

describe('audioQualityVerify: resolveActualQuality', () => {
  it('downgrades a degraded lossless quality to the nearest lossy tier', () => {
    expect(resolveActualQuality('flac', 'https://cdn.example.com/x.mp3')).toBe('320k');
    expect(resolveActualQuality('flac24bit', 'https://cdn.example.com/x.mp3')).toBe('320k');
    expect(resolveActualQuality('hires', 'https://cdn.example.com/x.mp3')).toBe('320k');
  });

  it('keeps the claimed quality when the format matches', () => {
    expect(resolveActualQuality('flac', 'https://cdn.example.com/x.flac')).toBe('flac');
    expect(resolveActualQuality('hires', 'https://cdn.example.com/x.wav')).toBe('hires');
  });

  it('keeps lossy qualities untouched', () => {
    expect(resolveActualQuality('320k', 'https://cdn.example.com/x.mp3')).toBe('320k');
    expect(resolveActualQuality('mgg', 'https://cdn.example.com/x.mp3')).toBe('mgg');
  });

  it('keeps the claimed quality when the url has no extension', () => {
    const url = 'http://m801.music.126.net/2026/abc/obj/wo3';
    expect(resolveActualQuality('flac24bit', url)).toBe('flac24bit');
  });
});
