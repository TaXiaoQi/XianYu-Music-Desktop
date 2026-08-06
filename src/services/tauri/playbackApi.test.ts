import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tauriInvoke } = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
}));

vi.mock('./invoke', () => ({
  tauriInvoke,
}));

import { playbackApi } from './playbackApi';

describe('playbackApi', () => {
  beforeEach(() => {
    tauriInvoke.mockReset();
  });

  it('wraps record_play payload under the payload key expected by tauri', () => {
    const payload = {
      songPath: '/music/demo.flac',
      listenedMs: 70_000,
      durationMs: 180_000,
      title: 'Demo',
      artist: 'Artist',
      album: 'Album',
      trackNumber: '1',
      countAsPlay: true,
    };

    playbackApi.recordPlay(payload);

    expect(tauriInvoke).toHaveBeenCalledWith('record_play', { payload });
  });

  it('passes audio output mode to play_audio', () => {
    playbackApi.playAudio({
      path: '/music/demo.flac',
      title: 'Demo',
      artist: 'Artist',
      album: 'Album',
      cover: '',
      duration: 180,
      outputMode: 'wasapiExclusive',
    });

    expect(tauriInvoke).toHaveBeenCalledWith('play_audio', {
      path: '/music/demo.flac',
      title: 'Demo',
      artist: 'Artist',
      album: 'Album',
      cover: '',
      duration: 180,
      outputMode: 'wasapiExclusive',
    });
  });
});
