import {describe, expect, it} from 'vitest';
import type {Song} from '../../types';
import {
  buildQueueWithInsertedSong,
  clampResumeTimeToPreviewClip,
  getErrorMessage,
  getSmtcTitle,
  isOriginalOnlinePath,
  isQualitySwitchRequest,
  isSameCurrentlyPlayingSong,
  isStaleRequest,
  shouldFadeOnSwitch,
  shouldStopPreviousAudioBeforeOnlineResolve,
} from './playbackPlaySongSupport';

const makeSong = (path: string, overrides: Partial<Song> = {}): Song => ({
  path,
  name: path.split('/').pop() ?? path,
  title: '',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  ...overrides,
});

describe('playbackPlaySongSupport', () => {
  describe('getSmtcTitle', () => {
    it('优先用 title，缺失时退回去掉扩展名的文件名', () => {
      expect(getSmtcTitle(makeSong('/music/a.flac', {title: '  真实标题  '}))).toBe('真实标题');
      expect(getSmtcTitle(makeSong('/music/a.flac', {title: '   '}))).toBe('a');
      expect(getSmtcTitle(makeSong('/music/b.mp3'))).toBe('b');
    });
  });

  describe('getErrorMessage', () => {
    it('Error 取 message，其他类型转字符串', () => {
      expect(getErrorMessage(new Error('boom'))).toBe('boom');
      expect(getErrorMessage('raw')).toBe('raw');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });
  });

  describe('isSameCurrentlyPlayingSong', () => {
    const song = makeSong('/music/a.flac');
    it('同一首歌正在播放且无强制重播时视为重复请求', () => {
      expect(isSameCurrentlyPlayingSong(song, song, true, {})).toBe(true);
    });

    it('暂停中、换歌、带 startTime 或强制重播时不算重复', () => {
      expect(isSameCurrentlyPlayingSong(song, song, false, {})).toBe(false);
      expect(isSameCurrentlyPlayingSong(song, makeSong('/music/b.flac'), true, {})).toBe(false);
      expect(isSameCurrentlyPlayingSong(song, song, true, {startTime: 10})).toBe(false);
      expect(isSameCurrentlyPlayingSong(song, song, true, {forceReplay: true})).toBe(false);
      expect(isSameCurrentlyPlayingSong(song, song, true, {continueStatisticsSession: true})).toBe(false);
      expect(isSameCurrentlyPlayingSong(song, song, true, {
        _sourceSwitchCtx: {originKey: 'k', failedSources: new Set()},
      })).toBe(false);
    });
  });

  describe('isQualitySwitchRequest', () => {
    const song = makeSong('/music/a.flac');
    it('同曲 + 延续统计会话才是换音质', () => {
      expect(isQualitySwitchRequest(song, song, {continueStatisticsSession: true})).toBe(true);
      expect(isQualitySwitchRequest(song, song, {})).toBe(false);
      expect(isQualitySwitchRequest(song, makeSong('/music/b.flac'), {continueStatisticsSession: true})).toBe(false);
      expect(isQualitySwitchRequest(song, null, {continueStatisticsSession: true})).toBe(false);
    });
  });

  describe('isOriginalOnlinePath', () => {
    it('只认 lx:// 与 plugin://', () => {
      expect(isOriginalOnlinePath('lx://a/b')).toBe(true);
      expect(isOriginalOnlinePath('plugin://x/y')).toBe(true);
      expect(isOriginalOnlinePath('/music/a.flac')).toBe(false);
      expect(isOriginalOnlinePath('https://example.test/a.mp3')).toBe(false);
    });
  });

  describe('shouldStopPreviousAudioBeforeOnlineResolve', () => {
    const song = makeSong('plugin://p/new');
    const previous = makeSong('plugin://p/old');
    it('在线新歌且正在播放、且不是同曲续播时需要先停旧音频', () => {
      expect(shouldStopPreviousAudioBeforeOnlineResolve('plugin://p/new', true, false, previous, song, false)).toBe(true);
      expect(shouldStopPreviousAudioBeforeOnlineResolve('plugin://p/new', false, true, previous, song, false)).toBe(true);
    });

    it('本地歌、未在播放、或同曲非换音质时不预停', () => {
      expect(shouldStopPreviousAudioBeforeOnlineResolve('/music/a.flac', true, true, previous, song, false)).toBe(false);
      expect(shouldStopPreviousAudioBeforeOnlineResolve('plugin://p/new', false, false, previous, song, false)).toBe(false);
      expect(shouldStopPreviousAudioBeforeOnlineResolve('plugin://p/new', true, false, song, song, false)).toBe(false);
      expect(shouldStopPreviousAudioBeforeOnlineResolve('plugin://p/new', true, false, song, song, true)).toBe(true);
    });
  });

  describe('shouldFadeOnSwitch', () => {
    const song = makeSong('/music/b.flac');
    const previous = makeSong('/music/a.flac');
    it('开启淡入淡出、正在播放且确实换了歌才淡出', () => {
      expect(shouldFadeOnSwitch(true, true, previous, song)).toBe(true);
      expect(shouldFadeOnSwitch(false, true, previous, song)).toBe(false);
      expect(shouldFadeOnSwitch(true, false, previous, song)).toBe(false);
      expect(shouldFadeOnSwitch(true, true, null, song)).toBe(false);
      expect(shouldFadeOnSwitch(true, true, song, song)).toBe(false);
    });
  });

  describe('buildQueueWithInsertedSong', () => {
    const a = makeSong('/a');
    const b = makeSong('/b');
    const c = makeSong('/c');
    const x = makeSong('/x');

    it('插到当前歌曲之后', () => {
      expect(buildQueueWithInsertedSong(x, b, [a, b, c]).map(s => s.path)).toEqual(['/a', '/b', '/x', '/c']);
    });

    it('同曲时原队列不变', () => {
      expect(buildQueueWithInsertedSong(b, b, [a, b, c]).map(s => s.path)).toEqual(['/a', '/b', '/c']);
    });

    it('无当前歌时只留新歌', () => {
      expect(buildQueueWithInsertedSong(x, null, [a, b]).map(s => s.path)).toEqual(['/x']);
    });

    it('当前歌不在队列时置于队首之后', () => {
      expect(buildQueueWithInsertedSong(x, c, [a, b]).map(s => s.path)).toEqual(['/c', '/x', '/a', '/b']);
    });

    it('新歌原本已在队列中时先摘除再插入，避免重复', () => {
      expect(buildQueueWithInsertedSong(c, a, [a, b, c]).map(s => s.path)).toEqual(['/a', '/c', '/b']);
    });
  });

  describe('clampResumeTimeToPreviewClip', () => {
    it('无片段时原样返回', () => {
      expect(clampResumeTimeToPreviewClip(42, null)).toBe(42);
    });

    it('把时间夹回片段区间内', () => {
      const clip = {start: 30, duration: 20};
      expect(clampResumeTimeToPreviewClip(0, clip)).toBe(30);
      expect(clampResumeTimeToPreviewClip(100, clip)).toBe(49);
      expect(clampResumeTimeToPreviewClip(40, clip)).toBe(40);
    });
  });

  describe('isStaleRequest', () => {
    it('请求号或当前歌曲任一不匹配都算过期', () => {
      expect(isStaleRequest(1, 1, '/a', '/a')).toBe(false);
      expect(isStaleRequest(1, 2, '/a', '/a')).toBe(true);
      expect(isStaleRequest(1, 1, '/b', '/a')).toBe(true);
      expect(isStaleRequest(1, 1, undefined, '/a')).toBe(true);
    });
  });
});
