// settingsSyncService 回归测试：uploadSettingsOnly 的本地快照必须在云端下载 await 返回后读取。
// 复现场景（amll 被回写成 vinyl 的根因）：自动同步进入网络等待期间用户在主题中心切换皮肤，
// 陈旧快照既会在 cloudWon 写回时覆盖本地新值，也会被 localWon 分支当「本地最新」上传污染云端。
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadSettings: vi.fn(),
  uploadSettings: vi.fn(),
  readLocalSectionTs: vi.fn(),
}));

vi.mock('../settingsSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../settingsSync')>();
  return {
    ...actual,
    downloadSettings: mocks.downloadSettings,
    uploadSettings: mocks.uploadSettings,
    readLocalSectionTs: mocks.readLocalSectionTs,
    parseUploadedAtMs: () => 0,
    resolveCloudSectionTs: (_settings: unknown, sectionTs: Record<string, number>) => sectionTs,
  };
});

vi.mock('../../storage/playerStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage/playerStorage')>();
  return {
    ...actual,
    playerStorage: {
      ...actual.playerStorage,
      writeSettings: vi.fn(),
      readEqualizerPresets: () => [],
    },
  };
});

vi.mock('../pluginSync', () => ({
  downloadPlugins: vi.fn(),
  uploadPlugins: vi.fn(),
}));

import { createSettingsSyncFlow, type SettingsSyncPorts } from './settingsSyncService';
import { createDefaultAppSettings } from '../../../features/settings/store';
import type { AppSettings } from '../../../types';

const noop = () => undefined;

function makePorts(live: { current: AppSettings }) {
  const applied: AppSettings[] = [];
  const ports: SettingsSyncPorts = {
    canSync: () => true,
    isAuthed: () => true,
    isSettingsUploadEnabled: () => true,
    isPlaylistUploadEnabled: () => false,
    isPluginUploadEnabled: () => false,
    getSettings: () => live.current,
    replaceSettings: (next) => {
      applied.push(next);
      live.current = next;
    },
    applySectionTimestamps: noop,
    onProgress: noop,
    notify: noop,
    setSyncing: noop,
    setLastResult: noop,
    setLastTime: noop,
    resolveConflict: async () => 'cancel',
    uploadPlaylists: async () => ({ uploaded: false, downloaded: false, errors: [] }),
    downloadPlaylists: async () => ({ uploaded: false, downloaded: false, errors: [] }),
    log: noop,
    logError: noop,
  };
  return { ports, applied };
}

describe('uploadSettingsOnly 快照新鲜度', () => {
  it('网络等待期间的本地变更不被陈旧快照覆盖，也不被陈旧内容上传', async () => {
    const live = { current: createDefaultAppSettings() };
    live.current.theme.playerDetailStyle = 'vinyl';

    const cloud = createDefaultAppSettings();
    cloud.theme.playerDetailStyle = 'vinyl';
    // 云端账本：sidebar 较新（触发 cloudWon 写回路径），theme 较旧
    const cloudSectionTs = { theme: 1_000, sidebar: 9_000_000_000_000 };
    // 本地账本：theme 刚被 patch 打过戳（较新），sidebar 较旧
    mocks.readLocalSectionTs.mockReturnValue({ theme: 5_000_000_000_000, sidebar: 1_000 });

    let resolveDownload!: (value: unknown) => void;
    mocks.downloadSettings.mockImplementation(
      () => new Promise((resolve) => { resolveDownload = resolve; }),
    );
    mocks.uploadSettings.mockResolvedValue({ uploaded: true, errors: [] });

    const { ports, applied } = makePorts(live);
    const flow = createSettingsSyncFlow(ports);
    const pending = flow.uploadSettingsOnly({ silent: true });

    // 让流程进入 downloadSettings 的 await
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.downloadSettings).toHaveBeenCalledTimes(1);

    // 网络等待期间用户切换皮肤（等同主题中心 patchTheme amll）
    live.current = { ...live.current, theme: { ...live.current.theme, playerDetailStyle: 'amll' } };

    resolveDownload({
      settings: cloud,
      uploadedAt: '2026-11-20T00:00:00Z',
      sectionTs: cloudSectionTs,
      result: { errors: [], downloaded: true },
    });
    await pending;

    // cloudWon(sidebar) 触发整份写回：theme 必须保留等待期间的 amll，而非快照里的 vinyl
    expect(applied.length).toBe(1);
    expect(applied[0].theme.playerDetailStyle).toBe('amll');
    // localWon(theme) 上传的 payload 同样必须是鲜活值
    expect(mocks.uploadSettings).toHaveBeenCalledTimes(1);
    const payload = mocks.uploadSettings.mock.calls[0][0] as AppSettings;
    expect(payload.theme.playerDetailStyle).toBe('amll');
  });
});
