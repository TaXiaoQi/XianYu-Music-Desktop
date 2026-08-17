import { appApi } from '../../services/tauri/appApi';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import type { AppLanguage } from '../../types';

const SUPPORTED: AppLanguage[] = ['zh-CN', 'zh-TW', 'en-US'];
let latestRequestedLanguage: AppLanguage | null = null;
let installerSyncQueue: Promise<void> = Promise.resolve();

function isSupported(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (SUPPORTED as string[]).includes(value);
}

/**
 * 启动时消费安装器写入的语言。
 *
 * 安装器（installer-hooks.nsh）每次安装都会把用户选择的语言写入注册表的
 * AppLanguage 值。主程序启动时读取它：若与本地记录的“已消费值”不同，说明是
 * 新安装（或重新安装）写入的语言，应采用它并更新界面语言。
 *
 * 用户在设置里手动改语言时会通过 syncLanguageToInstaller 写回注册表并更新
 * 已消费标记，因此用户改动不会在下次启动被误判为新安装值而回滚。
 *
 * @returns 若应采用安装语言，返回该语言码；否则返回 null。
 */
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
    // 已消费过同一安装值，不重复应用（尊重用户后续修改）。
    return null;
  }

  playerStorage.setString(playerStorageKeys.consumedInstallLanguage, installLanguage);
  return installLanguage;
}

/**
 * 把主程序当前语言同步到注册表：
 * - 写回 AppLanguage / Installer Language，使卸载器语言跟随主程序当前语言；
 * - 更新本地“已消费值”，避免下次启动把用户选择误判为新安装值。
 */
export function syncLanguageToInstaller(language: AppLanguage): Promise<void> {
  if (!isSupported(language)) return Promise.resolve();

  latestRequestedLanguage = language;
  playerStorage.setString(playerStorageKeys.consumedInstallLanguage, language);

  // 注册表写入必须串行。快速连续切换时，旧请求即使较慢，也不能在新请求之后完成并覆盖最终值。
  const task = installerSyncQueue.then(async () => {
    // 尚未开始的旧请求可直接跳过，只写入用户最新选择。
    if (latestRequestedLanguage !== language) return;
    try {
      await appApi.setInstallLanguage(language);
    } catch {
      /* 非 Windows 或写入失败时静默忽略，不影响界面语言 */
    }
  });

  // 即使单次同步异常，后续语言切换仍应继续执行。
  installerSyncQueue = task.catch(() => {});
  return task;
}
