
import type { AutoSyncConfig, ServerLoadStatus } from '../../types';
import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';

const LOG = '[AutoSync]';

const MIN_INTERVAL_MS = 60_000;

function log(_msg: string, ..._args: unknown[]) {
}

function logWarn(msg: string, ...args: unknown[]) {
  console.warn(`${LOG} ${msg}`, ...args);
}

export async function getServerLoad(): Promise<ServerLoadStatus | null> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    return null;
  }

  try {
    const data = await signedRequest<ServerLoadStatus>('get_server_load', {
      user_id: ciyuanxiId,
    });

    return {
      rateLimited: data.rateLimited ?? false,
      activeSyncCount: data.activeSyncCount ?? 0,
      busy: data.busy ?? false,
      suggestedDelaySeconds: data.suggestedDelaySeconds ?? 0,
      bandwidthUsagePercent: data.bandwidthUsagePercent ?? 0,
    };
  } catch (e) {
    logWarn('getServerLoad 失败，假设服务器空闲', e);
    return null;
  }
}

export function getSyncIntervalMs(config: AutoSyncConfig): number {
  const raw = config.syncIntervalSeconds * 1000;
  return raw > 0 ? raw : MIN_INTERVAL_MS;
}

export function calculateNextSyncTime(config: AutoSyncConfig, now: number = Date.now()): number {
  const intervalMs = getSyncIntervalMs(config);
  return now + intervalMs;
}

export class AutoSyncScheduler {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private delayedTimerId: ReturnType<typeof setTimeout> | null = null;
  private onSync: (() => Promise<void>) | null = null;
  private onDelayed: ((delaySeconds: number, attempt: number) => void) | null = null;
  private onSyncStart: (() => void) | null = null;
  private onSyncComplete: ((success: boolean) => void) | null = null;
  private getConfig: (() => AutoSyncConfig) | null = null;
  private updateConfig: ((patch: Partial<AutoSyncConfig>) => void) | null = null;
  private canSync: (() => boolean) | null = null;
  private isSyncing = false;

  init(callbacks: {
    getConfig: () => AutoSyncConfig;
    updateConfig: (patch: Partial<AutoSyncConfig>) => void;
    canSync: () => boolean;
    onSync: () => Promise<void>;
    onSyncStart?: () => void;
    onSyncComplete?: (success: boolean) => void;
    onDelayed?: (delaySeconds: number, attempt: number) => void;
  }) {
    this.getConfig = callbacks.getConfig;
    this.updateConfig = callbacks.updateConfig;
    this.canSync = callbacks.canSync;
    this.onSync = callbacks.onSync;
    this.onSyncStart = callbacks.onSyncStart ?? null;
    this.onSyncComplete = callbacks.onSyncComplete ?? null;
    this.onDelayed = callbacks.onDelayed ?? null;
  }

  start() {
    this.stop();

    if (!this.getConfig || !this.canSync) {
      logWarn('start: 调度器未初始化');
      return;
    }

    const config = this.getConfig();
    if (!config.enabled) {
      log('start: 自动同步未启用，跳过');
      return;
    }

    if (!this.canSync()) {
      log('start: 未登录或无弦予号，跳过');
      return;
    }

    const now = Date.now();
    let nextSyncAt = config.nextSyncAt;
    if (nextSyncAt <= 0 || nextSyncAt <= now) {
      nextSyncAt = calculateNextSyncTime(config, now);
      this.updateConfig?.({ nextSyncAt });
    }

    const intervalMs = getSyncIntervalMs(config);
    const intervalDesc = `${Math.floor(intervalMs / 3600000)}h ${Math.floor((intervalMs % 3600000) / 60000)}m ${Math.floor((intervalMs % 60000) / 1000)}s`;
    log(`start: 调度器已启动，同步间隔 ${intervalDesc}，下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`);

    this.timerId = setInterval(() => {
      void this.tick();
    }, 60_000);

    void this.tick();
  }

  stop() {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.delayedTimerId !== null) {
      clearTimeout(this.delayedTimerId);
      this.delayedTimerId = null;
    }
    log('stop: 调度器已停止');
  }

  restart() {
    if (this.getConfig) {
      const config = this.getConfig();
      const nextSyncAt = calculateNextSyncTime(config);
      this.updateConfig?.({ nextSyncAt, delayedCount: 0 });
    }
    this.start();
  }

  private async tick() {
    if (this.isSyncing) {
      return;
    }

    if (!this.getConfig || !this.canSync || !this.updateConfig) {
      return;
    }

    const config = this.getConfig();
    if (!config.enabled) {
      return;
    }

    if (!this.canSync()) {
      return;
    }

    const now = Date.now();

    if (config.nextSyncAt > 0 && now < config.nextSyncAt) {
      return;
    }

    await this.attemptSync();
  }

  private async attemptSync() {
    if (this.isSyncing) {
      return;
    }

    if (!this.getConfig || !this.updateConfig) {
      return;
    }

    this.isSyncing = true;
    this.onSyncStart?.();

    try {
      const config = this.getConfig();
      const now = Date.now();

      this.updateConfig({
        lastSyncAttemptAt: now,
      });

      const intervalMs = getSyncIntervalMs(config);
      const intervalMinutes = intervalMs / 60000;
      if (config.delayedCount > 0 && config.delayedCount * Math.max(intervalMinutes, 1) >= config.maxDelayMinutes) {
        logWarn(`attemptSync: 延迟次数 ${config.delayedCount} 已达上限 ${config.maxDelayMinutes} 分钟，放弃本次同步`);
        const nextSyncAt = calculateNextSyncTime(config, now);
        this.updateConfig({
          delayedCount: 0,
          nextSyncAt,
        });
        log(`attemptSync: 已安排下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`);
        this.onSyncComplete?.(false);
        return;
      }

      const serverLoad = await getServerLoad();

      if (serverLoad?.busy) {
        const delaySeconds = serverLoad.suggestedDelaySeconds || 60;
        const newDelayedCount = config.delayedCount + 1;
        const nextSyncAt = now + delaySeconds * 1000;

        log(`attemptSync: 服务器繁忙 (并发: ${serverLoad.activeSyncCount}, 带宽: ${serverLoad.bandwidthUsagePercent}%)，延后 ${delaySeconds}s (第 ${newDelayedCount} 次)`);

        this.updateConfig({
          delayedCount: newDelayedCount,
          nextSyncAt,
        });

        this.onDelayed?.(delaySeconds, newDelayedCount);

        if (this.delayedTimerId !== null) {
          clearTimeout(this.delayedTimerId);
        }
        this.delayedTimerId = setTimeout(() => {
          this.delayedTimerId = null;
          void this.attemptSync();
        }, delaySeconds * 1000);

        return;
      }

      try {
        if (this.onSync) {
          await this.onSync();
        }
        const nextSyncAt = calculateNextSyncTime(config, Date.now());
        this.updateConfig({
          delayedCount: 0,
          lastSyncSuccessAt: Date.now(),
          nextSyncAt,
        });
        log(`attemptSync: 同步成功，下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`);
        this.onSyncComplete?.(true);
      } catch (e) {
        logWarn('attemptSync: 同步失败', e);
        const nextSyncAt = calculateNextSyncTime(config, Date.now());
        this.updateConfig({
          nextSyncAt,
        });
        log(`attemptSync: 同步失败，下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`);
        this.onSyncComplete?.(false);
      }
    } finally {
      this.isSyncing = false;
    }
  }
}

let globalScheduler: AutoSyncScheduler | null = null;

export function getAutoSyncScheduler(): AutoSyncScheduler {
  if (!globalScheduler) {
    globalScheduler = new AutoSyncScheduler();
  }
  return globalScheduler;
}
