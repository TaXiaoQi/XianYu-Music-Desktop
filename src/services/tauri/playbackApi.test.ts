import { vi, describe, it, expect, beforeEach } from 'vitest';

// 底层 invoke 整体替换为 mock，专注验证命令名与参数信封。
const invokeDouble = vi.hoisted(() => vi.fn());

vi.mock('./invoke', () => ({
  tauriInvoke: invokeDouble,
}));

import { playbackApi as api } from './playbackApi';

// —— 冻结的夹具数据 ——
const recordPlayFixture = {
  songPath: '/music/demo.flac', listenedMs: 70_000, durationMs: 180_000,
  title: 'Demo', artist: 'Artist', album: 'Album', trackNumber: '1', countAsPlay: true,
};

const localPlayFixture = {
  path: '/music/demo.flac', title: 'Demo', artist: 'Artist', album: 'Album',
  cover: '', duration: 180, outputMode: 'wasapiExclusive',
};

const encryptedPlayFixture = {
  path: 'https://example.test/encrypted.dat', title: 'Encrypted', artist: 'Artist', album: 'Album',
  cover: '', duration: 180, outputMode: 'shared',
  headers: { Referer: 'https://example.test/' }, ekey: 'qmc-ekey', cek: 'cenc-key',
};

const loudnessFixture = {
  enabled: true, songId: 42, songPath: '/music/demo.flac', gainOffsetDb: -2, preventClipping: false,
};

describe('playbackApi command wrappers', () => {
  beforeEach(() => {
    invokeDouble.mockReset();
  });

  it('sends record_play statistics inside a payload envelope', () => {
    api.recordPlay(recordPlayFixture);

    expect(invokeDouble).toHaveBeenCalledWith('record_play', { payload: recordPlayFixture });
  });

  it('forwards the local play request with its output mode', () => {
    api.playAudio(localPlayFixture);

    expect(invokeDouble).toHaveBeenCalledWith('play_audio', localPlayFixture);
  });

  it('forwards plugin stream headers and encrypted keys on play_audio', () => {
    api.playAudio(encryptedPlayFixture);

    expect(invokeDouble).toHaveBeenCalledWith('play_audio', encryptedPlayFixture);
  });

  it('invokes stop_audio without any payload', () => {
    api.stopAudio();

    expect(invokeDouble).toHaveBeenCalledWith('stop_audio');
  });

  it('hands loudness context over to update_loudness_settings', () => {
    api.updateLoudnessSettings(loudnessFixture);

    expect(invokeDouble).toHaveBeenCalledWith('update_loudness_settings', loudnessFixture);
  });
});
