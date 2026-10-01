import { describe, expect, it, vi } from 'vitest';

import type { Song } from '../../types';
import { prepareOnlinePlayback } from './onlinePlaybackFacade';

const song = { path: 'lx://wy/123', name: 'Demo', duration: 180 } as Song;

describe('online playback preparation facade', () => {
  it('uses an existing downloaded file without probing or resolving online audio', async () => {
    const deps = {
      checkDownloaded: vi.fn().mockResolvedValue({ filePath: 'C:/Music/demo.flac' }),
      getAvailableQualities: vi.fn(),
      resolveAudio: vi.fn(),
    };

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
    expect(deps.getAvailableQualities).not.toHaveBeenCalled();
    expect(deps.resolveAudio).not.toHaveBeenCalled();
  });

  it('continues when quality probing fails and resolves the requested audio', async () => {
    const resolvedOnlineAudio = {
      audioFilePath: 'https://example.test/demo.mp3',
      pluginHeaders: null,
      currentPlayingQuality: '320k',
      currentPlayingAudioUrl: 'https://example.test/demo.mp3',
    };
    const deps = {
      checkDownloaded: vi.fn().mockResolvedValue(null),
      getAvailableQualities: vi.fn().mockRejectedValue(new Error('probe failed')),
      resolveAudio: vi.fn().mockResolvedValue(resolvedOnlineAudio),
    };

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
    const deps = {
      checkDownloaded: vi.fn().mockResolvedValue(null),
      getAvailableQualities: vi.fn().mockResolvedValue(['128k', '320k']),
      resolveAudio: vi.fn().mockResolvedValue({
        audioFilePath: 'https://example.test/demo.mp3',
        pluginHeaders: null,
        currentPlayingQuality: '320k',
        currentPlayingAudioUrl: null,
      }),
    };

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
    const deps = {
      checkDownloaded: vi.fn().mockResolvedValue(null),
      getAvailableQualities: vi.fn().mockResolvedValue(null),
      resolveAudio: vi.fn().mockRejectedValue(error),
    };

    await expect(prepareOnlinePlayback({
      audioFilePath: song.path,
      song,
      requestedQuality: '320k',
      fallbackBehavior: 'lower',
    }, deps)).rejects.toBe(error);
  });
});
