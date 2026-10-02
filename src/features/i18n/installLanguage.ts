import { appApi } from '../../services/tauri/appApi';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import type { AppLanguage } from '../../types';
import { resolveLanguage } from './index';

const SUPPORTED: AppLanguage[] = ['zh-CN', 'zh-TW', 'en-US'];
let latestRequestedLanguage: AppLanguage | null = null; // 实现
let installerSyncQueue: Promise<void> = Promise.resolve(); // 实现

function isSupported(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (SUPPORTED as string[]).includes(value);
}

export async function consumeInstallLanguage(): Promise<AppLanguage | null> {
  let installLanguage: string | null = null;
  try {
    installLanguage = await appApi.getInstallLanguage();
  } catch {
    return null;
  }

  if (!isSupported(installLanguage)) return null;

  const consumed = playerStorage.getString(playerStorageKeys.consumedInstallLanguage);
  if (consumed === installLanguage) {
    return null;
  }

  playerStorage.setString(playerStorageKeys.consumedInstallLanguage, installLanguage);
  return installLanguage;
}

export function syncLanguageToInstaller(language: AppLanguage): Promise<void> { // 实现
  const resolved = resolveLanguage(language);
  if (!isSupported(resolved)) return Promise.resolve();

  latestRequestedLanguage = resolved;
  playerStorage.setString(playerStorageKeys.consumedInstallLanguage, resolved);

  const task = installerSyncQueue.then(async () => { // 实现
    if (latestRequestedLanguage !== resolved) return;
    try {
      await appApi.setInstallLanguage(resolved);
    } catch {
      /* 非 Windows 或写入失败时静默忽略，不影响界面语言 */ // 实现
    }
  });

  installerSyncQueue = task.catch(() => {}); // 实现
  return task; // 实现
}
