/**
 * 自动同步调度服务
 *
 * 负责根据用户的自动同步配置，按设定间隔自动触发同步操作。
 * 包含服务器负载检测机制：当服务器带宽繁忙时自动延后同步并提示用户。
 *
 * 核心流程：
 * 1. 定时器每分钟检查是否到达同步时间
 * 2. 到达同步时间时，先查询服务器负载状态
 * 3. 如果服务器繁忙，按建议延迟时间自动延后
 * 4. 如果延迟次数超过上限，放弃本次同步并通知用户
 * 5. 服务器空闲时执行同步，同步完成后重置延迟计数并安排下一次
 */

import type { AutoSyncConfig, ServerLoadStatus } from '../../types';
import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';

const LOG = '[AutoSync]';

/** 最小同步间隔（毫秒），防止用户设置 0 导致无限循环 */
const MIN_INTERVAL_MS = 60_000; // 1 分钟

function log(_msg: string, ..._args: unknown[]) {
}

function logWarn(msg: string, ...args: unknown[]) {
  console.warn(`${LOG} ${msg}`, ...args);
}

/** 查询服务器负载状态 */
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

/**
 * 计算同步间隔总毫秒数
 * 如果用户设置的间隔为 0，返回最小间隔（1 分钟）
 */
export function getSyncIntervalMs(config: AutoSyncConfig): number {
  const raw = config.syncIntervalSeconds * 1000;
  return raw > 0 ? raw : MIN_INTERVAL_MS;
}

/**
 * 计算下一次同步时间戳
 * 始终返回 now + 间隔（至少 1 分钟后）
 */
export function calculateNextSyncTime(config: AutoSyncConfig, now: number = Date.now()): number {
  const intervalMs = getSyncIntervalMs(config);
  return now + intervalMs;
}

/** 自动同步调度器 */
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

  /**
   * 初始化调度器
   * @param callbacks 回调函数集合
   */
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

  /** 启动调度器 */
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

    // 如果没有设置下次同步时间，或已过期，重新计算
    const now = Date.now();
    let nextSyncAt = config.nextSyncAt;
    if (nextSyncAt <= 0 || nextSyncAt <= now) {
      nextSyncAt = calculateNextSyncTime(config, now);
      this.updateConfig?.({ nextSyncAt });
    }

    const intervalMs = getSyncIntervalMs(config);
    const intervalDesc = `${Math.floor(intervalMs / 3600000)}h ${Math.floor((intervalMs % 3600000) / 60000)}m ${Math.floor((intervalMs % 60000) / 1000)}s`;
    log(`start: 调度器已启动，同步间隔 ${intervalDesc}，下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`);

    // 每分钟检查一次
    this.timerId = setInterval(() => {
      void this.tick();
    }, 60_000);

    // 启动时也立即检查一次
    void this.tick();
  }

  /** 停止调度器 */
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

  /** 重启调度器（配置变更后调用） */
  restart() {
    // 配置变更时重置下次同步时间
    if (this.getConfig) {
      const config = this.getConfig();
      const nextSyncAt = calculateNextSyncTime(config);
      this.updateConfig?.({ nextSyncAt, delayedCount: 0 });
    }
    this.start();
  }

  /** 每分钟检查 */
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

    // 检查是否到达同步时间
    if (config.nextSyncAt > 0 && now < config.nextSyncAt) {
      return;
    }

    // 到达同步时间，执行同步
    await this.attemptSync();
  }

  /** 尝试执行同步（含服务器负载检测） */
  private async attemptSync() {
    if (this.isSyncing) {
      return;
    }

    if (!this.getConfig || !this.updateConfig) {
      return;
    }

    const config = this.getConfig();
    const now = Date.now();

    // 记录同步尝试
    this.updateConfig({
      lastSyncAttemptAt: now,
    });

    // 检查延迟次数是否超过上限
    const intervalMs = getSyncIntervalMs(config);
    const intervalMinutes = intervalMs / 60000;
    if (config.delayedCount > 0 && config.delayedCount * Math.max(intervalMinutes, 1) >= config.maxDelayMinutes) {
      logWarn(`attemptSync: 延迟次数 ${config.delayedCount} 已达上限 ${config.maxDelayMinutes} 分钟，放弃本次同步`);
      // 重置延迟计数，安排下一次同步
      const nextSyncAt = calculateNextSyncTime(config, now);
      this.updateConfig({
        delayedCount: 0,
        nextSyncAt,
      });
      log(`attemptSync: 已安排下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`);
      this.onSyncComplete?.(false);
      return;
    }

    // 查询服务器负载
    const serverLoad = await getServerLoad();

    if (serverLoad?.busy) {
      // 服务器繁忙，自动延后
      const delaySeconds = serverLoad.suggestedDelaySeconds || 60;
      const newDelayedCount = config.delayedCount + 1;
      const nextSyncAt = now + delaySeconds * 1000;

      log(`attemptSync: 服务器繁忙 (并发: ${serverLoad.activeSyncCount}, 带宽: ${serverLoad.bandwidthUsagePercent}%)，延后 ${delaySeconds}s (第 ${newDelayedCount} 次)`);

      this.updateConfig({
        delayedCount: newDelayedCount,
        nextSyncAt,
      });

      this.onDelayed?.(delaySeconds, newDelayedCount);

      // 设置延迟后的重试定时器
      if (this.delayedTimerId !== null) {
        clearTimeout(this.delayedTimerId);
      }
      this.delayedTimerId = setTimeout(() => {
        this.delayedTimerId = null;
        void this.attemptSync();
      }, delaySeconds * 1000);

      return;
    }

    // 服务器空闲，执行同步
    this.isSyncing = true;
    this.onSyncStart?.();

    try {
      if (this.onSync) {
        await this.onSync();
      }
      // 同步成功，重置延迟计数，安排下一次同步
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
      // 同步失败也要安排下一次同步时间，避免不断重试
      const nextSyncAt = calculateNextSyncTime(config, Date.now());
      this.updateConfig({
        nextSyncAt,
      });
      log(`attemptSync: 同步失败，下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`);
      this.onSyncComplete?.(false);
    } finally {
      this.isSyncing = false;
    }
  }
}

/** 全局调度器实例 */
let globalScheduler: AutoSyncScheduler | null = null;

/** 获取全局调度器实例 */
export function getAutoSyncScheduler(): AutoSyncScheduler {
  if (!globalScheduler) {
    globalScheduler = new AutoSyncScheduler();
  }
  return globalScheduler;
}
