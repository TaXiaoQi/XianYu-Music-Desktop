import { describe, expect, it, vi } from 'vitest';

import type { Song } from '../../types';
import { prepareOnlinePlayback } from './onlinePlaybackFacade';

const song = { path: 'lx://wy/123', name: 'Demo', duration: 180 } as Song;

const makeDeps = (overrides: Partial<Parameters<typeof prepareOnlinePlayback>[1]> = {}) => ({
  checkDownloaded: vi.fn().mockResolvedValue(null),
  findFuzzyDownloaded: vi.fn().mockResolvedValue(null),
  getAvailableQualities: vi.fn().mockResolvedValue(null),
  resolveAudio: vi.fn(),
  ...overrides,
});

describe('online playback preparation facade', () => {
  it('uses an existing downloaded file without probing or resolving online audio', async () => {
    const deps = makeDeps({
      checkDownloaded: vi.fn().mockResolvedValue({ filePath: 'C:/Music/demo.flac' }),
    });

    await expect(prepareOnlinePlayback({
      audioFilePath: song.path,
      song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
    }, deps)).resolves.toEqual({
      audioFilePath: 'C:/Music/demo.flac',
      usingDownloadedAudioFile: true,
      availableQualities: null,
      resolvedOnlineAudio: null,
    });
    expect(deps.findFuzzyDownloaded).not.toHaveBeenCalled();
    expect(deps.getAvailableQualities).not.toHaveBeenCalled();
    expect(deps.resolveAudio).not.toHaveBeenCalled();
  });

  it('falls back to a fuzzy matched downloaded file when the exact key misses', async () => {
    const deps = makeDeps({
      findFuzzyDownloaded: vi.fn().mockResolvedValue('C:/Music/other-source.flac'),
    });

    await expect(prepareOnlinePlayback({
      audioFilePath: song.path,
      song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
    }, deps)).resolves.toEqual({
      audioFilePath: 'C:/Music/other-source.flac',
      usingDownloadedAudioFile: true,
      availableQualities: null,
      resolvedOnlineAudio: null,
    });
    expect(deps.findFuzzyDownloaded).toHaveBeenCalledWith({
      title: 'Demo',
      artist: undefined,
      durationMs: 180000,
      excludeSongPath: 'lx://wy/123',
    });
    expect(deps.getAvailableQualities).not.toHaveBeenCalled();
    expect(deps.resolveAudio).not.toHaveBeenCalled();
  });

  it('keeps resolving online audio when fuzzy matching misses', async () => {
    const resolvedOnlineAudio = {
      audioFilePath: 'https://example.test/demo.mp3',
      pluginHeaders: null,
      currentPlayingQuality: '320k',
      currentPlayingAudioUrl: 'https://example.test/demo.mp3',
    };
    const deps = makeDeps({
      resolveAudio: vi.fn().mockResolvedValue(resolvedOnlineAudio),
    });

    await expect(prepareOnlinePlayback({
      audioFilePath: song.path,
      song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
    }, deps)).resolves.toEqual({
      audioFilePath: resolvedOnlineAudio.audioFilePath,
      usingDownloadedAudioFile: false,
      availableQualities: null,
      resolvedOnlineAudio,
    });
    expect(deps.findFuzzyDownloaded).toHaveBeenCalledTimes(1);
  });

  it('skips fuzzy matching for local files', async () => {
    const deps = makeDeps({
      resolveAudio: vi.fn().mockResolvedValue({
        audioFilePath: 'D:/Music/local.mp3',
        pluginHeaders: null,
        currentPlayingQuality: null,
        currentPlayingAudioUrl: null,
      }),
    });

    await prepareOnlinePlayback({
      audioFilePath: 'D:/Music/local.mp3',
      song: { ...song, path: 'D:/Music/local.mp3' } as Song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
    }, deps);

    expect(deps.findFuzzyDownloaded).not.toHaveBeenCalled();
  });

  it('continues to online resolve when fuzzy lookup throws', async () => {
    const resolvedOnlineAudio = {
      audioFilePath: 'https://example.test/demo.mp3',
      pluginHeaders: null,
      currentPlayingQuality: '320k',
      currentPlayingAudioUrl: 'https://example.test/demo.mp3',
    };
    const deps = makeDeps({
      findFuzzyDownloaded: vi.fn().mockRejectedValue(new Error('history broken')),
      resolveAudio: vi.fn().mockResolvedValue(resolvedOnlineAudio),
    });

    await expect(prepareOnlinePlayback({
      audioFilePath: song.path,
      song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
    }, deps)).resolves.toMatchObject({
      audioFilePath: resolvedOnlineAudio.audioFilePath,
      usingDownloadedAudioFile: false,
    });
  });

  it('continues when quality probing fails and resolves the requested audio', async () => {
    const resolvedOnlineAudio = {
      audioFilePath: 'https://example.test/demo.mp3',
      pluginHeaders: null,
      currentPlayingQuality: '320k',
      currentPlayingAudioUrl: 'https://example.test/demo.mp3',
    };
    const deps = makeDeps({
      getAvailableQualities: vi.fn().mockRejectedValue(new Error('probe failed')),
      resolveAudio: vi.fn().mockResolvedValue(resolvedOnlineAudio),
    });

    await expect(prepareOnlinePlayback({
      audioFilePath: song.path,
      song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
      preFetchedUrl: 'https://example.test/prefetched.mp3',
    }, deps)).resolves.toEqual({
      audioFilePath: resolvedOnlineAudio.audioFilePath,
      usingDownloadedAudioFile: false,
      availableQualities: null,
      resolvedOnlineAudio,
    });
    expect(deps.resolveAudio).toHaveBeenCalledWith(expect.objectContaining({
      availableQualities: null,
      preFetchedUrl: 'https://example.test/prefetched.mp3',
    }));
  });

  it('passes available qualities into the online resolver', async () => {
    const deps = makeDeps({
      getAvailableQualities: vi.fn().mockResolvedValue(['128k', '320k']),
      resolveAudio: vi.fn().mockResolvedValue({
        audioFilePath: 'https://example.test/demo.mp3',
        pluginHeaders: null,
        currentPlayingQuality: '320k',
        currentPlayingAudioUrl: null,
      }),
    });

    await prepareOnlinePlayback({
      audioFilePath: song.path,
      song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
    }, deps);

    expect(deps.resolveAudio).toHaveBeenCalledWith(expect.objectContaining({
      availableQualities: ['128k', '320k'],
    }));
  });

  it('propagates resolver failures to the player failure path', async () => {
    const error = new Error('resolver failed');
    const deps = makeDeps({
      resolveAudio: vi.fn().mockRejectedValue(error),
    });

    await expect(prepareOnlinePlayback({
      audioFilePath: song.path,
      song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
    }, deps)).rejects.toBe(error);
  });
});
