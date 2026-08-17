import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setInstallLanguage: vi.fn(),
  setString: vi.fn(),
}));

vi.mock('../../services/tauri/appApi', () => ({
  appApi: {
    getInstallLanguage: vi.fn(),
    setInstallLanguage: mocks.setInstallLanguage,
  },
}));

vi.mock('../../services/storage/playerStorage', () => ({
  playerStorageKeys: { consumedInstallLanguage: 'consumed-language' },
  playerStorage: {
    getString: vi.fn(),
    setString: mocks.setString,
  },
}));

import { syncLanguageToInstaller } from './installLanguage';

describe('installer language synchronization', () => {
  beforeEach(() => {
    mocks.setInstallLanguage.mockReset();
    mocks.setString.mockReset();
  });

  it('serializes rapid changes so the latest language is written last', async () => {
    let finishFirst!: () => void;
    mocks.setInstallLanguage
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishFirst = resolve;
      }))
      .mockResolvedValueOnce(undefined);

    const first = syncLanguageToInstaller('en-US');
    await Promise.resolve();
    expect(mocks.setInstallLanguage).toHaveBeenCalledTimes(1);

    const second = syncLanguageToInstaller('zh-CN');
    expect(mocks.setInstallLanguage).toHaveBeenCalledTimes(1);

    finishFirst();
    await Promise.all([first, second]);

    expect(mocks.setInstallLanguage.mock.calls).toEqual([
      ['en-US'],
      ['zh-CN'],
    ]);
    expect(mocks.setString).toHaveBeenLastCalledWith('consumed-language', 'zh-CN');
  });
});
