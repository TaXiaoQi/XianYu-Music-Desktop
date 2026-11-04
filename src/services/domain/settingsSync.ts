import type { AppSettings } from "../../types";
import { signedRequest } from "../auth/authService";
import { getCiyuanxiId } from "./playlistSync";
import {
  isSyncableSettingSection,
  readSectionTimestamps,
} from "../../features/settings/sectionChangeTracker";
// ==================== 设置比较 ====================

function stableStringify(obj: unknown): string {
    return JSON.stringify(obj, (_key, value) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const sorted: Record<string, unknown> = {};
            for (const k of Object.keys(value).sort()) {
                sorted[k] = (value as Record<string, unknown>)[k];
            }
            return sorted;
        }
        return value;
    });
}
function normalizeSettingsForComparison(
    settings: AppSettings,
): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(settings)) as Record<
        string,
        unknown
    >;
    if (cloned.download && typeof cloned.download === "object") {
        (cloned.download as Record<string, unknown>).downloadPath = "";
    }
    (cloned as Record<string, unknown>).organizeRoot = "";
    delete (cloned as Record<string, unknown>).upload;
    // 分节时间戳账本是同步元数据，不参与内容比较
    delete (cloned as Record<string, unknown>).__sectionTs__;
    if (cloned.autoSync && typeof cloned.autoSync === "object") {
        const autoSync = cloned.autoSync as Record<string, unknown>;
        delete autoSync.delayedCount;
        delete autoSync.lastSyncAttemptAt;
        delete autoSync.lastSyncSuccessAt;
        delete autoSync.nextSyncAt;
    }
    return cloned;
}
export function areSettingsEqual(
    local: AppSettings,
    cloud: AppSettings,
): boolean {
    const normalizedLocal = normalizeSettingsForComparison(local);
    const normalizedCloud = normalizeSettingsForComparison(cloud);
    return (
        stableStringify(normalizedLocal) === stableStringify(normalizedCloud)
    );
}
const LOG = "[SettingsSync]";
function logSync(_msg: string, ..._args: unknown[]) {}
function logSyncError(msg: string, ...args: unknown[]) {
    console.error(`${LOG} ${msg}`, ...args);
}
interface SettingsSyncDownloadData {
    version: number;
    uploaded_at: string;
    timestamp: number;
    /** 云端快照可能携带其他端写入的分节时间戳账本（__sectionTs__），读取后剥离 */
    settings: AppSettings & { __sectionTs__?: Record<string, number> };
}
export interface SettingsSyncResult {
    uploaded: boolean;
    downloaded: boolean;
    errors: string[];
}

/** 云端快照里的分节时间戳账本（宽松清洗，非法条目丢弃） */
function sanitizeSectionTs(
    candidate: unknown,
): Record<string, number> | null {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return null;
    }
    const table: Record<string, number> = {};
    for (const [key, value] of Object.entries(candidate)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            table[key] = value;
        }
    }
    return Object.keys(table).length > 0 ? table : null;
}
// ==================== 上传 ====================
export async function uploadSettings(
    settings: AppSettings,
    options?: { sectionTs?: Record<string, number> },
): Promise<SettingsSyncResult> {
    const result: SettingsSyncResult = {
        uploaded: false,
        downloaded: false,
        errors: [],
    };
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
        logSyncError("uploadSettings: 未获取到弦予号");
        result.errors.push("未登录或未获取到弦予号");
        return result;
    }
    logSync("uploadSettings: 开始上传本地设置");

    try {
        // 分节时间戳账本随载荷上云（服务端按不透明 JSON 存取），供其他端按分节 LWW
        const settingsToUpload = {
            ...settings,
            download: {
                ...settings.download,
                downloadPath: "",
            },
            ...(options?.sectionTs ? { __sectionTs__: options.sectionTs } : {}),
        };

        await signedRequest(
            "settings_sync_upload",
            {
                user_id: ciyuanxiId,
                platform: "desktop",
                settings: settingsToUpload,
            },
            {
                fetchTimeoutMs: 15_000,
                timeoutMs: 20_000,
            },
        );

        result.uploaded = true;
        logSync("uploadSettings: 上传成功");
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`uploadSettings: 上传失败: ${msg}`);
        result.errors.push(`上传失败: ${msg}`);
    } // 错误归集
    return result;
}
// ==================== 下载 ====================
export async function downloadSettings(): Promise<{
    settings: AppSettings | null;
    uploadedAt: string | null;
    /** 云端分节时间戳账本（旧版端上传的快照缺省为 null） */
    sectionTs: Record<string, number> | null;
    result: SettingsSyncResult;
}> {
    const result: SettingsSyncResult = {
        uploaded: false,
        downloaded: false,
        errors: [],
    };
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
        logSyncError("downloadSettings: 未获取到弦予号");
        result.errors.push("未登录或未获取到弦予号");
        return { settings: null, uploadedAt: null, sectionTs: null, result };
    }
    logSync("downloadSettings: 开始从云端下载设置");

    try {
        const downloadData = await signedRequest<SettingsSyncDownloadData>(
            "settings_sync_download",
            {
                user_id: ciyuanxiId,
                platform: "desktop",
            },
        );

        if (!downloadData || !downloadData.settings) {
            logSync("downloadSettings: 云端无设置数据");
            return { settings: null, uploadedAt: null, sectionTs: null, result };
        }

        result.downloaded = true;
        const sectionTs = sanitizeSectionTs(downloadData.settings.__sectionTs__);
        logSync(
            `downloadSettings: 下载成功, uploaded_at=${downloadData.uploaded_at}, sectionTs=${sectionTs ? Object.keys(sectionTs).length : 0} 项`,
        );
        // 账本剥离后再交给合并/比较逻辑
        const { __sectionTs__: _ignored, ...settings } = downloadData.settings;
        return {
            settings: settings as AppSettings,
            uploadedAt: downloadData.uploaded_at ?? null,
            sectionTs,
            result,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`downloadSettings: 下载失败: ${msg}`);
        result.errors.push(`下载失败: ${msg}`);
        return { settings: null, uploadedAt: null, sectionTs: null, result };
    }
}

// ==================== 分节 LWW 合并 ====================

export interface SettingsSectionMergeResult {
    /** 合并后的完整设置（云端较新分节已被采纳，设备本地字段未处理） */
    merged: AppSettings;
    /** 云端较新的分节（需落地本地） */
    cloudWonSections: string[];
    /** 本地较新的分节（需上传云端） */
    localWonSections: string[];
    /** 合并后各分节的时间戳账本（上传时随载荷带上、落地后写回本地账本） */
    mergedSectionTs: Record<string, number>;
}

/** 云端分节有效时间戳：账本缺失的分节回落到整包 uploaded_at（旧版端上传的快照） */
export function resolveCloudSectionTs(
    settings: AppSettings,
    cloudSectionTs: Record<string, number> | null,
    uploadedAtMs: number,
): Record<string, number> {
    const resolved: Record<string, number> = {};
    for (const key of Object.keys(settings)) {
        if (!isSyncableSettingSection(key)) continue;
        resolved[key] = cloudSectionTs?.[key] ?? uploadedAtMs;
    }
    return resolved;
}

export function parseUploadedAtMs(uploadedAt: string | null): number {
    if (!uploadedAt) return 0;
    const ms = new Date(uploadedAt).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

/**
 * 按分节 LWW 合并本地与云端设置：cloudTs > localTs 采纳云端分节，
 * localTs > cloudTs 记为待上传分节，持平保持本端值。
 * localTs / cloudTs 缺失的分节按 0 处理（全新设备优先采纳云端；旧数据不反覆盖云端）。
 */
export function mergeSettingsBySection(
    local: AppSettings,
    cloud: AppSettings,
    localTs: Record<string, number>,
    cloudTs: Record<string, number>,
): SettingsSectionMergeResult {
    const localRecord = local as unknown as Record<string, unknown>;
    const cloudRecord = cloud as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...localRecord };
    const cloudWonSections: string[] = [];
    const localWonSections: string[] = [];
    const mergedSectionTs: Record<string, number> = {};

    const sectionKeys = new Set([
        ...Object.keys(localRecord),
        ...Object.keys(cloudRecord),
    ]);
    for (const key of sectionKeys) {
        if (!isSyncableSettingSection(key)) continue;
        const cts = cloudTs[key] ?? 0;
        const lts = localTs[key] ?? 0;
        if (cts > lts && key in cloudRecord) {
            merged[key] = cloudRecord[key];
            mergedSectionTs[key] = cts;
            cloudWonSections.push(key);
        } else {
            mergedSectionTs[key] = lts;
            if (lts > cts) localWonSections.push(key);
        }
    }
    return {
        merged: merged as unknown as AppSettings,
        cloudWonSections,
        localWonSections,
        mergedSectionTs,
    };
}

/** 全分节时间戳（本端时刻），用于「保留本地」整体上传前对齐账本 */
export function buildFullSectionTs(
    settings: AppSettings,
    at = Date.now(),
): Record<string, number> {
    const table: Record<string, number> = {};
    for (const key of Object.keys(settings)) {
        if (isSyncableSettingSection(key)) table[key] = at;
    }
    return table;
}

/** 本地分节时间戳账本的只读快照（供同步流程对比） */
export function readLocalSectionTs(): Record<string, number> {
    return readSectionTimestamps();
}
