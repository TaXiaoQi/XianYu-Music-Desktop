// 网盘凭据云同步（与移动端 sync_provider.cloud.dart / 腕上端同协议）。
//
// 服务端契约：cloud_creds_upload {user_id, sealed}（1MB 上限）；
// cloud_creds_download {user_id} → data['sealed']。sealed 为账号派生密钥
// （sha256('cloud_creds.v1:' + ciyuanxiId)）密封的凭据 JSON，服务端无明文。
// 协议 v2（LWW）：密封串顶层带 `__ts__`（产生端的本地变更时刻）。下载时与
// 本地 changeAt 对比，云端较新整体替换、本地较新跳过下发；上传仅在有未同步
// 变更（changeAt != syncedAt）时进行，成功后 syncedAt 对齐，防抖 3s。

import { signedRequest } from "../auth/authService";
import { getCiyuanxiId } from "./playlistSync";
import { CloudCredentialsStore } from "../cloud/cloudCredentialsStore";

const LOG = "[CloudCredsSync]";
const UPLOAD_DEBOUNCE_MS = 3000;

let uploadTimer: ReturnType<typeof setTimeout> | null = null;
let downloading = false;

/** 凭据变更 → 防抖上传（未登录静默跳过；无未同步变更时不发空请求）。 */
async function uploadCloudCreds(): Promise<void> {
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) return;
    const store = CloudCredentialsStore.instance;
    const meta = await store.syncMeta();
    if (meta.changeAt == null || meta.changeAt === meta.syncedAt) {
        console.info(`${LOG} 无变化，跳过上传`);
        return;
    }
    try {
        const sealed = await store.exportForSync(ciyuanxiId);
        if (!sealed) {
            console.info(`${LOG} 无变化，跳过上传`);
            return;
        }
        await signedRequest("cloud_creds_upload", {
            user_id: ciyuanxiId,
            sealed,
        }, {
            fetchTimeoutMs: 15_000,
            timeoutMs: 20_000,
        });
        await store.markSynced(meta.changeAt);
        console.info(`${LOG} 已上传同步包（ts=${meta.changeAt}）`);
    } catch (e) {
        console.warn(`${LOG} 上传失败:`, e);
    }
}

function scheduleCloudCredsUpload(): void {
    if (uploadTimer) clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => {
        uploadTimer = null;
        void uploadCloudCreds();
    }, UPLOAD_DEBOUNCE_MS);
}

/** 登录成功后拉取云端凭据并按 LWW 应用（单飞；失败静默，下次登录再拉）。 */
export async function downloadCloudCredsOnLogin(): Promise<void> {
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId || downloading) return;
    downloading = true;
    try {
        const data = await signedRequest<{ sealed?: string }>("cloud_creds_download", {
            user_id: ciyuanxiId,
        });
        if (!data?.sealed) return;
        const res = await CloudCredentialsStore.instance.importFromSync(data.sealed, ciyuanxiId);
        if (!res.applied) {
            console.info(`${LOG} 本地较新，跳过下发`);
        } else if (res.changed) {
            console.info(`${LOG} 云端较新，已应用`);
        } else {
            console.info(`${LOG} 云端与本地一致，无需改动`);
        }
    } catch (e) {
        console.warn(`${LOG} 下载失败:`, e);
    } finally {
        downloading = false;
    }
}

let installed = false;

/** 启动时挂载：凭据本地变更 → 自动上传（幂等）。 */
export function installCloudCredsSync(): void {
    if (installed) return;
    installed = true;
    CloudCredentialsStore.onPersisted = scheduleCloudCredsUpload;
}
