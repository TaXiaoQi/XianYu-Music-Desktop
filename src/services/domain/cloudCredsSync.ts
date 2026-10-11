// 网盘凭据云同步（与移动端 sync_provider.cloud.dart / 腕上端同协议）。
//
// 服务端契约：cloud_creds_upload {user_id, sealed}（1MB 上限）；
// cloud_creds_download {user_id} → data['sealed']。sealed 为账号派生密钥
// （sha256('cloud_creds.v1:' + ciyuanxiId)）密封的凭据 JSON，服务端无明文。
// 本地绑定/解绑后防抖 3s 上传；登录成功后下载合并。

import { signedRequest } from "../auth/authService";
import { getCiyuanxiId } from "./playlistSync";
import { CloudCredentialsStore } from "../cloud/cloudCredentialsStore";

const LOG = "[CloudCredsSync]";
const UPLOAD_DEBOUNCE_MS = 3000;

let uploadTimer: ReturnType<typeof setTimeout> | null = null;
let downloading = false;

/** 凭据变更 → 防抖上传（未登录/无凭据静默跳过）。 */
async function uploadCloudCreds(): Promise<void> {
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) return;
    try {
        const sealed = await CloudCredentialsStore.instance.exportForSync(ciyuanxiId);
        if (!sealed) return;
        await signedRequest("cloud_creds_upload", {
            user_id: ciyuanxiId,
            sealed,
        }, {
            fetchTimeoutMs: 15_000,
            timeoutMs: 20_000,
        });
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

/** 登录成功后拉取云端凭据并合并（单飞；失败静默，下次登录再拉）。 */
export async function downloadCloudCredsOnLogin(): Promise<void> {
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId || downloading) return;
    downloading = true;
    try {
        const data = await signedRequest<{ sealed?: string }>("cloud_creds_download", {
            user_id: ciyuanxiId,
        });
        if (!data?.sealed) return;
        await CloudCredentialsStore.instance.importFromSync(data.sealed, ciyuanxiId);
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
