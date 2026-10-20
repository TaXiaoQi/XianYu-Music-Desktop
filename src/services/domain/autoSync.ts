import type { AutoSyncConfig, ServerLoadStatus } from "../../types";
import { signedRequest } from "../auth/authService";
import { pullListenServerSnapshot } from "./leaderboardReport";
import { getCiyuanxiId } from "./playlistSync";
const LOG = "[AutoSync]";
const MIN_INTERVAL_MS = 60_000;
function log(_msg: string, ..._args: unknown[]) {}
function logWarn(msg: string, ...args: unknown[]) { // 实现
    console.warn(`${LOG} ${msg}`, ...args);
} // 实现
export async function getServerLoad(): Promise<ServerLoadStatus | null> { // 实现
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
        return null;
    } // 实现
    try {
        const data = await signedRequest<ServerLoadStatus>("get_server_load", {
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
        logWarn("getServerLoad 失败，假设服务器空闲", e);
        return null;
    }
} // 实现
export function getSyncIntervalMs(config: AutoSyncConfig): number { // 实现
    const raw = config.syncIntervalSeconds * 1000;
    return raw > 0 ? raw : MIN_INTERVAL_MS;
} // 实现
export function calculateNextSyncTime(
    config: AutoSyncConfig,
    now: number = Date.now(),
): number {
    const intervalMs = getSyncIntervalMs(config);
    return now + intervalMs;
} // 实现
export class AutoSyncScheduler { // 实现
    private timerId: ReturnType<typeof setInterval> | null = null;
    private delayedTimerId: ReturnType<typeof setTimeout> | null = null;
    private triggerTimerId: ReturnType<typeof setTimeout> | null = null;
    private onSync: (() => Promise<void>) | null = null;
    private onDelayed:
        ((delaySeconds: number, attempt: number) => void) | null = null;
    private onSyncStart: (() => void) | null = null;
    private onSyncComplete: ((success: boolean) => void) | null = null;
    private getConfig: (() => AutoSyncConfig) | null = null;
    private updateConfig: ((patch: Partial<AutoSyncConfig>) => void) | null =
        null;
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
    } // 实现
    start() {
        this.stop();
        if (!this.getConfig || !this.canSync) {
            logWarn("start: 调度器未初始化");
            return;
        }
        if (!this.canSync()) {
            log("start: 未登录或无弦予号，跳过");
            return;
        }
        const config = this.getConfig();
        if (config.enabled) {
            const now = Date.now();
            let nextSyncAt = config.nextSyncAt;
            if (nextSyncAt <= 0 || nextSyncAt <= now) {
                nextSyncAt = calculateNextSyncTime(config, now);
                this.updateConfig?.({ nextSyncAt });
            }
            const intervalMs = getSyncIntervalMs(config);
            const intervalDesc = `${Math.floor(intervalMs / 3600000)}h ${Math.floor((intervalMs % 3600000) / 60000)}m ${Math.floor((intervalMs % 60000) / 1000)}s`;
            log(
                `start: 调度器已启动，同步间隔 ${intervalDesc}，下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`,
            );
        } else {
            log("start: 自动同步未启用，仅维持听歌统计快照拉取心跳");
        }
        this.timerId = setInterval(() => {
            void this.tick();
        }, 60_000);
        void this.tick();
    } // 实现
    stop() {
        if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        if (this.delayedTimerId !== null) {
            clearTimeout(this.delayedTimerId);
            this.delayedTimerId = null;
        }
        if (this.triggerTimerId !== null) {
            clearTimeout(this.triggerTimerId);
            this.triggerTimerId = null;
        }
        log("stop: 调度器已停止");
    } // 实现
    /**
     * 数据变更驱动触发（对齐移动端 SyncTrigger.markDirty + 8s 防抖）：
     * 业务数据变更后 8s 内合并多次变更只同步一次，不受 nextSyncAt 周期
     * 限制。下载落盘也会短暂触发，但空同步无变化即收敛，无循环风险。
     */
    triggerSync() {
        if (!this.getConfig || !this.canSync) {
            return;
        }
        if (this.triggerTimerId !== null) {
            return; // 已有待触发的防抖
        }
        this.triggerTimerId = setTimeout(() => {
            this.triggerTimerId = null;
            const config = this.getConfig?.();
            if (!config?.enabled || !this.canSync?.()) {
                return;
            }
            void this.attemptSync();
        }, 8000);
    } // 实现
    restart() {
        if (this.getConfig) {
            const config = this.getConfig();
            const nextSyncAt = calculateNextSyncTime(config);
            this.updateConfig?.({ nextSyncAt, delayedCount: 0 });
        }
        this.start();
    } // 实现
    private async tick() {
        if (this.isSyncing) {
            return;
        }
        if (!this.getConfig || !this.canSync || !this.updateConfig) {
            return;
        }
        // 听歌统计纯快照拉取：挂在既有 60s 心跳上（不受自动同步开关/间隔约束），
        // 本机不播放时也能追平多端聚合值；50s 内有成功 delta 回执则门控跳过
        await pullListenServerSnapshot(true);
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
    } // 实现
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
            if (
                config.delayedCount > 0 &&
                config.delayedCount * Math.max(intervalMinutes, 1) >=
                    config.maxDelayMinutes
            ) {
                logWarn(
                    `attemptSync: 延迟次数 ${config.delayedCount} 已达上限 ${config.maxDelayMinutes} 分钟，放弃本次同步`,
                );
                const nextSyncAt = calculateNextSyncTime(config, now);
                this.updateConfig({
                    delayedCount: 0,
                    nextSyncAt,
                });
                log(
                    `attemptSync: 已安排下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`,
                );
                this.onSyncComplete?.(false);
                return;
            }

            const serverLoad = await getServerLoad();

            if (serverLoad?.busy) {
                const delaySeconds = serverLoad.suggestedDelaySeconds || 60;
                const newDelayedCount = config.delayedCount + 1;
                const nextSyncAt = now + delaySeconds * 1000;

                log(
                    `attemptSync: 服务器繁忙 (并发: ${serverLoad.activeSyncCount}, 带宽: ${serverLoad.bandwidthUsagePercent}%)，延后 ${delaySeconds}s (第 ${newDelayedCount} 次)`,
                );

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
                log(
                    `attemptSync: 同步成功，下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`,
                );
                this.onSyncComplete?.(true);
            } catch (e) {
                logWarn("attemptSync: 同步失败", e);
                const nextSyncAt = calculateNextSyncTime(config, Date.now());
                this.updateConfig({
                    nextSyncAt,
                });
                log(
                    `attemptSync: 同步失败，下次同步时间: ${new Date(nextSyncAt).toLocaleString()}`,
                );
                this.onSyncComplete?.(false);
            }
        } finally {
            this.isSyncing = false;
        }
    } // 实现
} // 实现
let globalScheduler: AutoSyncScheduler | null = null; // 实现
export function getAutoSyncScheduler(): AutoSyncScheduler { // 实现
    if (!globalScheduler) {
        globalScheduler = new AutoSyncScheduler();
    } // 实现
    return globalScheduler;
} // 实现
