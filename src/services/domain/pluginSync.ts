import type { PluginSource } from "../../types";
import { signedRequest } from "../auth/authService";
import { getCiyuanxiId } from "./playlistSync";
import {
    getStoredPlugins,
    getPluginScript,
    restorePluginFromSync,
    loadPlugins,
    getSubscriptions,
    mergeSubscriptionsFromCloud,
    removeSubscriptionsByUrls,
    removePluginSource,
    getPluginUserVariableValues,
    setPluginUserVariableValues,
} from "./pluginEngine";
import {
    setSyncedPluginIds,
    addSyncedPluginIds,
    removeSyncedPluginIds,
    getDownloadSkipIds,
    removeDownloadSkipIds,
    getUploadSkipIds,
    clearPluginSyncTombstones,
} from "./pluginSyncState";
const LOG = "[PluginSync]";
function logSync(_msg: string, ..._args: unknown[]) {}
function logSyncError(msg: string, ...args: unknown[]) {
    console.error(`${LOG} ${msg}`, ...args);
}
function encodeBase64(str: string): string {
    try {
        const bytes = new TextEncoder().encode(str);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).split("").reverse().join("");
    } catch {
        return btoa(unescape(encodeURIComponent(str)))
            .split("")
            .reverse()
            .join("");
    }
}
function decodeBase64(b64: string): string {
    try {
        const reversed = b64.split("").reverse().join("");
        const binary = atob(reversed);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    } catch {
        return decodeURIComponent(
            escape(atob(b64.split("").reverse().join(""))),
        );
    }
}
// ==================== 用户变量 AES 加密 ====================
interface EncryptedUserVars {
    iv: string;
    data: string;
}
function b64FromBytes(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
function bytesFromB64(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function userVarKeyFor(ciyuanxiId: string): Promise<CryptoKey> {
    const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ciyuanxiId),
    );
    return globalThis.crypto.subtle.importKey(
        "raw",
        digest,
        { name: "AES-CBC" },
        false,
        ["encrypt", "decrypt"],
    );
}

async function encryptUserVars(
    ciyuanxiId: string,
    values: Record<string, string>,
): Promise<EncryptedUserVars> {
    const key = await userVarKeyFor(ciyuanxiId);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const ct = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
            { name: "AES-CBC", iv },
            key,
            new TextEncoder().encode(JSON.stringify(values)),
        ),
    );
    return { iv: b64FromBytes(iv), data: b64FromBytes(ct) };
}
async function decryptUserVars(
    ciyuanxiId: string,
    enc: EncryptedUserVars,
): Promise<Record<string, string> | undefined> {
    try {
        const key = await userVarKeyFor(ciyuanxiId);
        const pt = await globalThis.crypto.subtle.decrypt(
            { name: "AES-CBC", iv: bytesFromB64(enc.iv) },
            key,
            bytesFromB64(enc.data),
        );
        const parsed = JSON.parse(new TextDecoder().decode(pt));
        return typeof parsed === "object" && parsed
            ? (parsed as Record<string, string>)
            : undefined;
    } catch {
        return undefined;
    }
}
// ==================== 类型定义 ====================
interface PluginSyncItem extends PluginSource {
    script: string;
    scriptEncoded?: boolean;
    userVariablesEncrypted?: EncryptedUserVars;
}
interface PluginSyncDownloadData {
    version: number;
    uploaded_at: string;
    timestamp: number;
    stats: {
        plugin_count: number;
        subscription_count?: number;
    };
    plugins: PluginSyncItem[];
    subscriptions?: CloudSubscriptionItem[];
    /** 删除广播账本：其他端「删除全部/删除云端」的插件 id / 订阅 url（旧服务端缺省为空） */
    deleted_plugin_ids?: string[];
    deleted_subscription_urls?: string[];
}
interface CloudSubscriptionItem {
    id?: string;
    name?: string;
    url: string;
    addedAt?: number;
    [key: string]: unknown;
}
export interface PluginSyncResult {
    uploadedPlugins: number;
    downloadedPlugins: number;
    syncedSubscriptions: number;
    errors: string[];
}
// ==================== 上传 ====================
/** onStep：逐插件进度回调（done 从 1 计），供同步进度提示展示计数 */
export type PluginSyncStepCallback = (
    done: number,
    total: number,
    label: string,
) => void;

/** 取消检查点：手动同步 toast 的取消按钮触发 abort 后，循环步骤短路返回
 * 部分结果（已完成的插件保留），正在执行的请求不受影响 */
function abortGuard(signal: AbortSignal | undefined, where: string): boolean {
    if (!signal?.aborted) return false;
    logSync(`${where}: 收到取消信号，停止后续插件处理`);
    return true;
}

export async function uploadPlugins(
    options?: { overwrite?: boolean },
    onStep?: PluginSyncStepCallback,
    signal?: AbortSignal,
): Promise<PluginSyncResult> {
    // 覆盖上传（手动「同步至服务器」）：本地用户插件全集即云端目标状态，
    // 先清掉云端多出的插件/订阅再全量上传；自动同步不带 options，仍走合并
    const overwrite = options?.overwrite === true;
    const result: PluginSyncResult = {
        uploadedPlugins: 0,
        downloadedPlugins: 0,
        syncedSubscriptions: 0,
        errors: [],
    };

    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
        logSyncError("uploadPlugins: 未获取到弦予号");
        result.errors.push("未登录或未获取到弦予号");
        return result;
    }
    await loadPlugins();
    const plugins = getStoredPlugins();
    const userPlugins = plugins.filter((p) => !p.isBuiltin);
    // 覆盖上传：忽略「仅保留本地」墓碑，全部用户插件参与上传
    const toUpload = overwrite
        ? userPlugins
        : userPlugins.filter((p) => !getUploadSkipIds().has(p.id));
    if (!overwrite) {
        const uploadSkip = getUploadSkipIds();
        for (const skipped of userPlugins) {
            if (uploadSkip.has(skipped.id)) {
                logSync(
                    `uploadPlugins: 跳过 "${skipped.name}" - 处于仅保留本地墓碑中`,
                );
            }
        }
    }
    const subscriptions = getSubscriptions();
    logSync(
        `uploadPlugins: 本地用户插件 ${userPlugins.length} 个, 订阅 ${subscriptions.length} 个`,
    );
    if (overwrite) {
        // 覆盖上传：以本地为准清理云端多余插件/订阅；清理失败则中止，
        // 否则继续上传会得到既非本地也非云端的混合状态
        try {
            const cloud = await signedRequest<PluginSyncDownloadData>(
                "plugin_sync_download",
                { user_id: ciyuanxiId },
                { fetchTimeoutMs: 55_000, timeoutMs: 60_000 },
            );
            const localIds = new Set(userPlugins.map((p) => p.id));
            const cloudOnlyIds = (cloud?.plugins ?? [])
                .map((p) => p.id)
                .filter((id) => !localIds.has(id));
            const localSubUrls = new Set(subscriptions.map((s) => s.url));
            const cloudOnlySubUrls = (cloud?.subscriptions ?? [])
                .map((s) => s.url)
                .filter((u) => !localSubUrls.has(u));
            let cleanupOk = true;
            if (cloudOnlyIds.length > 0) {
                const ok = await deleteCloudPlugins(cloudOnlyIds);
                logSync(
                    `uploadPlugins(overwrite): 清理云端多余插件 ${cloudOnlyIds.length} 个, 成功=${ok}`,
                );
                if (!ok) {
                    result.errors.push(
                        `云端多余插件清理失败（${cloudOnlyIds.length} 个）`,
                    );
                    cleanupOk = false;
                }
            }
            if (cloudOnlySubUrls.length > 0) {
                const ok = await deleteCloudSubscriptions(cloudOnlySubUrls);
                logSync(
                    `uploadPlugins(overwrite): 清理云端多余订阅 ${cloudOnlySubUrls.length} 个, 成功=${ok}`,
                );
                if (!ok) {
                    result.errors.push(
                        `云端多余订阅清理失败（${cloudOnlySubUrls.length} 个）`,
                    );
                    cleanupOk = false;
                }
            }
            if (!cleanupOk) return result;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logSyncError("uploadPlugins(overwrite): 云端清理失败:", msg);
            result.errors.push(`覆盖上传云端清理失败: ${msg}`);
            return result;
        }
    }
    if (toUpload.length === 0) {
        if (subscriptions.length > 0) {
            try {
                await signedRequest<{ plugin_count: number }>(
                    "plugin_sync_upload_one",
                    {
                        user_id: ciyuanxiId,
                        plugin: {},
                        is_first: true,
                        subscriptions,
                    },
                    {
                        fetchTimeoutMs: 55_000,
                        timeoutMs: 60_000,
                    },
                );
                logSync("uploadPlugins: 已单独上传订阅链接");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logSyncError("uploadPlugins: 订阅上传失败:", msg);
                result.errors.push(`订阅链接上传失败: ${msg}`);
            }
        } else {
            logSync("uploadPlugins: 无用户插件需要上传");
        }
        setSyncedPluginIds([]);
        return result;
    }
    const uploadedIds: string[] = [];
    for (let i = 0; i < toUpload.length; i++) {
        if (abortGuard(signal, "uploadPlugins")) break;
        const plugin = toUpload[i];
        onStep?.(i + 1, toUpload.length, plugin.name);
        logSync(
            `uploadPlugins: [${i + 1}/${toUpload.length}] 上传插件 "${plugin.name}"`,
        );
        try {
            const script = await getPluginScript(plugin.id);
            if (!script) {
                logSync(`uploadPlugins: 跳过 "${plugin.name}" - 无法获取脚本`);
                result.errors.push(
                    `插件 "${plugin.name}" 脚本读取失败，已跳过`,
                );
                continue;
            }
            const syncItem: PluginSyncItem = {
                ...plugin,
                script: encodeBase64(script),
                scriptEncoded: true,
            };

            const userVars = getPluginUserVariableValues(plugin.id);
            if (Object.keys(userVars).length > 0) {
                try {
                    syncItem.userVariablesEncrypted = await encryptUserVars(
                        ciyuanxiId,
                        userVars,
                    );
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    logSyncError(
                        `uploadPlugins: 插件 "${plugin.name}" 用户变量加密失败:`,
                        msg,
                    );
                    result.errors.push(
                        `插件 "${plugin.name}" 用户变量加密失败，变量未同步`,
                    );
                }
            }
            const data = await signedRequest<{ plugin_count: number }>(
                "plugin_sync_upload_one",
                {
                    user_id: ciyuanxiId,
                    plugin: syncItem,
                    is_first: i === 0,
                    subscriptions,
                },
                {
                    fetchTimeoutMs: 55_000,
                    timeoutMs: 60_000,
                },
            );

            result.uploadedPlugins++;
            uploadedIds.push(plugin.id);
            logSync(
                `uploadPlugins: [${i + 1}/${toUpload.length}] "${plugin.name}" 上传成功 (云端共 ${data.plugin_count ?? "?"} 个)`,
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logSyncError(`uploadPlugins: 上传插件 "${plugin.name}" 失败:`, msg);
            result.errors.push(`插件 "${plugin.name}" 上传失败: ${msg}`);
        }
    }
    setSyncedPluginIds(uploadedIds);
    logSync(
        `uploadPlugins ← 完成: 成功 ${result.uploadedPlugins}/${toUpload.length} 个, ${result.errors.length} 个错误`,
    );
    return result;
}
// ==================== 下载 ====================

/** 云端删除广播裁剪：按 id 卸载插件、按 url 移除订阅。
 * 本机「仅保留本地」(uploadSkip) 或已删 (downloadSkip) 墓碑中的插件跳过；
 * 裁剪后从 syncedIds 清除，避免下次删除弹窗误判「已同步到云端」。 */
function trimCloudDeletedPlugins(
    pluginIds: string[],
    subUrls: string[],
    result: PluginSyncResult,
): void {
    if (pluginIds.length > 0) {
        const uploadSkip = getUploadSkipIds();
        const downloadSkip = getDownloadSkipIds();
        const victims = pluginIds.filter(
            (id) => !uploadSkip.has(id) && !downloadSkip.has(id),
        );
        for (const id of victims) {
            try {
                removePluginSource(id);
                removeSyncedPluginIds([id]);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logSyncError(`trimCloudDeletedPlugins: 裁剪插件 ${id} 失败:`, msg);
                result.errors.push(`插件 ${id} 云端删除裁剪失败`);
            }
        }
        if (victims.length > 0) {
            logSync(
                `trimCloudDeletedPlugins: 按云端删除账本裁剪 ${victims.length} 个插件`,
            );
        }
    }
    if (subUrls.length > 0) {
        removeSubscriptionsByUrls(subUrls);
    }
}

export async function downloadPlugins(
    options?: { overwrite?: boolean },
    onStep?: PluginSyncStepCallback,
    signal?: AbortSignal,
): Promise<PluginSyncResult> {
    // 覆盖下载（手动「更新至本地」）：清空本地用户插件与订阅后按云端快照重装，
    // 不应用墓碑/删除账本；云端为空时结果即本地清空
    const overwrite = options?.overwrite === true;
    const result: PluginSyncResult = {
        uploadedPlugins: 0,
        downloadedPlugins: 0,
        syncedSubscriptions: 0,
        errors: [],
    };

    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
        logSyncError("downloadPlugins: 未获取到弦予号");
        result.errors.push("未登录或未获取到弦予号");
        return result;
    }
    logSync("downloadPlugins: 开始从云端下载插件");
    try {
        const downloadData = await signedRequest<PluginSyncDownloadData>(
            "plugin_sync_download",
            {
                user_id: ciyuanxiId,
            },
        );

        // 云端删除广播裁剪：其他端「删除全部/删除云端」的插件与订阅真删本地
        // （覆盖下载不裁剪：云端快照即本地目标状态，账本无意义）
        const deletedPluginIds = (downloadData?.deleted_plugin_ids ?? []).filter(
            (id): id is string => typeof id === "string" && id.length > 0,
        );
        const deletedSubUrls = (downloadData?.deleted_subscription_urls ?? []).filter(
            (u): u is string => typeof u === "string" && u.length > 0,
        );
        if (
            !overwrite &&
            (deletedPluginIds.length > 0 || deletedSubUrls.length > 0)
        ) {
            trimCloudDeletedPlugins(deletedPluginIds, deletedSubUrls, result);
        }

        if (overwrite) {
            // 覆盖下载：先清空本地用户插件与订阅（不记墓碑），随后按云端重装
            await loadPlugins();
            const localUserPlugins = getStoredPlugins().filter(
                (p) => !p.isBuiltin,
            );
            for (const p of localUserPlugins) {
                try {
                    removePluginSource(p.id);
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    logSyncError(
                        `downloadPlugins(overwrite): 移除本地插件 "${p.name}" 失败:`,
                        msg,
                    );
                }
            }
            const localSubs = getSubscriptions();
            if (localSubs.length > 0) {
                removeSubscriptionsByUrls(localSubs.map((s) => s.url));
            }
            logSync(
                `downloadPlugins(overwrite): 已清空本地插件 ${localUserPlugins.length} 个, 订阅 ${localSubs.length} 个`,
            );
        }

        const cloudSubs = downloadData?.subscriptions;
        if (Array.isArray(cloudSubs) && cloudSubs.length > 0) {
            const added = mergeSubscriptionsFromCloud(cloudSubs);
            result.syncedSubscriptions = added;
            logSync(
                `downloadPlugins: 订阅${overwrite ? "替换" : "合并"}完成, 新增 ${added} 个`,
            );
        }
        if (
            !overwrite &&
            (!downloadData ||
                !downloadData.plugins ||
                downloadData.plugins.length === 0)
        ) {
            logSync("downloadPlugins: 云端无插件数据");
            return result;
        } // 清点结束
        const cloudPlugins = downloadData?.plugins ?? [];
        logSync(`downloadPlugins: 云端共 ${cloudPlugins.length} 个插件`);

        if (!overwrite) {
            await loadPlugins();
        }

        const downloadSkip = overwrite ? new Set<string>() : getDownloadSkipIds();
        const restoredIds: string[] = [];
        for (let i = 0; i < cloudPlugins.length; i++) {
            if (abortGuard(signal, "downloadPlugins")) break;
            const item = cloudPlugins[i];
            if (downloadSkip.has(item.id)) {
                logSync(
                    `downloadPlugins: [${i + 1}/${cloudPlugins.length}] 跳过 "${item.name}" - 处于仅删本地墓碑中`,
                );
                continue;
            }
            logSync(
                `downloadPlugins: [${i + 1}/${cloudPlugins.length}] 恢复插件 "${item.name}" (${item.format})`,
            );
            onStep?.(i + 1, cloudPlugins.length, item.name);

            try {
                const script = item.scriptEncoded
                    ? decodeBase64(item.script)
                    : item.script;
                const ok = await restorePluginFromSync(item, script);
                if (ok) {
                    if (item.userVariablesEncrypted) {
                        const values = await decryptUserVars(
                            ciyuanxiId,
                            item.userVariablesEncrypted,
                        );
                        if (values && Object.keys(values).length > 0) {
                            setPluginUserVariableValues(item.id, values);
                        } else {
                            result.errors.push(
                                `插件 "${item.name}" 用户变量解密失败`,
                            );
                        }
                    }
                    result.downloadedPlugins++;
                    restoredIds.push(item.id);
                } else {
                    result.errors.push(`插件 "${item.name}" 恢复失败`);
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logSyncError(
                    `downloadPlugins: 恢复插件 "${item.name}" 失败:`,
                    msg,
                );
                result.errors.push(`插件 "${item.name}" 恢复失败: ${msg}`);
            }
        }
        if (overwrite) {
            // 覆盖下载后本机与云端一致：同步账本重置为云端快照，并清掉这些插件
            // 的「仅保留本地/仅删本地」墓碑残留，避免阻断后续同步
            setSyncedPluginIds(restoredIds);
            clearPluginSyncTombstones(restoredIds);
        } else {
            addSyncedPluginIds(restoredIds);
        }
        logSync(
            `downloadPlugins ← 完成: 恢复 ${result.downloadedPlugins} 个插件, ${result.errors.length} 个错误`,
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`downloadPlugins: 下载失败:`, e);
        result.errors.push(`下载失败: ${msg}`);
    }
    return result;
}
// ==================== 云端删除 ====================

export async function deleteCloudPlugins(
    pluginIds: string[],
): Promise<boolean> {
    if (pluginIds.length === 0) return true;
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
        logSyncError("deleteCloudPlugins: 未获取到弦予号");
        return false;
    }
    try {
        await signedRequest<{ deleted: number; plugin_count: number }>(
            "plugin_sync_delete",
            {
                user_id: ciyuanxiId,
                plugin_ids: pluginIds,
            },
            {
                fetchTimeoutMs: 55_000,
                timeoutMs: 60_000,
            },
        );
        logSync(`deleteCloudPlugins: 云端删除 ${pluginIds.length} 个插件成功`);
        removeSyncedPluginIds(pluginIds);
        removeDownloadSkipIds(pluginIds);
        return true;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`deleteCloudPlugins: 云端删除失败:`, msg);
        return false;
    }
}

/** 云端订阅链接显式删除（url 维度）。云端订阅为各端并集，本地移除时须调用否则会被其他端重新合并回来。 */
export async function deleteCloudSubscriptions(
    urls: string[],
): Promise<boolean> {
    if (urls.length === 0) return true;
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
        logSyncError("deleteCloudSubscriptions: 未获取到弦予号");
        return false;
    }
    try {
        await signedRequest<{ deleted_subscriptions: number }>(
            "plugin_sync_delete",
            {
                user_id: ciyuanxiId,
                subscription_urls: urls,
            },
            {
                fetchTimeoutMs: 55_000,
                timeoutMs: 60_000,
            },
        );
        logSync(`deleteCloudSubscriptions: 云端删除 ${urls.length} 个订阅成功`);
        return true;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`deleteCloudSubscriptions: 云端删除失败:`, msg);
        return false;
    }
}
