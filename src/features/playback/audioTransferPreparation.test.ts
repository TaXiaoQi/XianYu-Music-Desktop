import { describe, expect, it, vi } from 'vitest';
import { prepareAudioTransfer } from './audioTransferPreparation';

describe('audio transfer preparation', () => {
  it('passes through ordinary audio URLs without downloading', async () => {
    const downloadAudioToTemp = vi.fn();
    const result = await prepareAudioTransfer(
      'https://example.test/audio.mp3',
      null,
      {
        downloadAudioToTemp,
        getBilibiliCookies: vi.fn(),
      },
    );

    expect(result).toEqual({
      audioPath: 'https://example.test/audio.mp3',
      usedTempFile: false,
    });
    expect(downloadAudioToTemp).not.toHaveBeenCalled();
  });

  it('adds effective Bilibili headers and downloads m4s audio', async () => {
    const downloadAudioToTemp = vi.fn().mockResolvedValue('C:/temp/audio.m4s');
    const getBilibiliCookies = vi.fn().mockResolvedValue('SESSDATA=test');
    const source = 'https://upos-sz-mirrorali.bilivideo.com/audio.m4s';

    const result = await prepareAudioTransfer(source, { referer: 'invalid', 'X-Test': '1' }, {
      downloadAudioToTemp,
      getBilibiliCookies,
    });

    expect(result).toEqual({ audioPath: 'C:/temp/audio.m4s', usedTempFile: true });
    expect(downloadAudioToTemp).toHaveBeenCalledWith(source, {
      'X-Test': '1',
      Referer: 'https://www.bilibili.com',
      Origin: 'https://www.bilibili.com',
      Cookie: 'SESSDATA=test',
    });
  });
});
