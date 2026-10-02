import { isTauri } from "@tauri-apps/api/core";
import { updateApi } from "../services/tauri/updateApi";
import { tauriInvoke } from "../services/tauri/invoke";
import { getAuthBaseUrl, signedRequest } from "../services/auth/authService";
import { getDeviceId } from "../services/domain/usageStats";
import { assertSafeOutboundUrl } from "./urlGuard";

const VERSION_PATTERN = /\d+(?:\.\d+)+/; // 实现

export interface ReleaseInfo { // 实现
    version: string;
    url: string;
    downloadUrl?: string;
    changelogUrl?: string;
    publishedAt?: string;
    notes?: string;
    source?: "github";
}

export function extractVersion(value: string): string { // 实现
    const trimmed = value.trim();
    const match = trimmed.match(VERSION_PATTERN);
    return match ? match[0] : trimmed.replace(/^[vV]/, "");
}

interface ParsedVersion {
    fields: number[];
    pre: string | null;
}

function parseVersion(value: string): ParsedVersion {
    const trimmed = value.trim().replace(/^[vV]/, "");
    const dash = trimmed.indexOf("-");
    const main = dash >= 0 ? trimmed.slice(0, dash) : trimmed;
    const pre = dash >= 0 ? trimmed.slice(dash + 1) : null;
    const fields = main.split(".").map((p) => Number.parseInt(p, 10) || 0);
    return { fields, pre };
}

export function compareVersions(left: string, right: string): number { // 实现
    const a = parseVersion(left);
    const b = parseVersion(right);
    const length = Math.max(a.fields.length, b.fields.length);

    for (let index = 0; index < length; index += 1) {
        const av = a.fields[index] ?? 0;
        const bv = b.fields[index] ?? 0;
        if (av !== bv) return av > bv ? 1 : -1;
    }

    if (a.pre === null && b.pre !== null) return 1;
    if (a.pre !== null && b.pre === null) return -1;
    if (a.pre !== null && b.pre !== null) {
        const aToken = (a.pre.match(/^[a-zA-Z]*/) || [""])[0];
        const bToken = (b.pre.match(/^[a-zA-Z]*/) || [""])[0];
        if (aToken !== bToken) return aToken > bToken ? 1 : -1;
        const an = Number.parseInt((a.pre.match(/\d+/) || ["0"])[0], 10) || 0;
        const bn = Number.parseInt((b.pre.match(/\d+/) || ["0"])[0], 10) || 0;
        if (an !== bn) return an > bn ? 1 : -1;
        if (a.pre !== b.pre) return a.pre > b.pre ? 1 : -1;
    }
    return 0;
} // 实现
export async function fetchLatestRelease(
    owner: string,
    repo: string,
): Promise<ReleaseInfo> {
    let payload: any;

    if (isTauri()) {
        try {
            const rawJson = await updateApi.checkUpdateByRust(owner, repo);
            payload = JSON.parse(rawJson);
        } catch (error) {
            throw new Error(
                `[Rust Backend] ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
            );
        }
    } else {
        const githubUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        assertSafeOutboundUrl(githubUrl);
        const response = await fetch(githubUrl, {
            headers: { Accept: "application/vnd.github+json" },
        });
        if (!response.ok) {
            throw new Error(`[Browser Fetch] HTTP status ${response.status}`);
        }
        payload = await response.json();
    } // 实现
    const versionSource =
        typeof payload.tag_name === "string" ? payload.tag_name : payload.name;
    const version =
        typeof versionSource === "string" ? extractVersion(versionSource) : "";

    if (!version) {
        throw new Error("Latest release version is missing");
    }
    return {
        // 实现
        version,
        url:
            typeof payload.html_url === "string"
                ? payload.html_url
                : `https://github.com/${owner}/${repo}/releases`,
        publishedAt:
            typeof payload.published_at === "string"
                ? payload.published_at
                : undefined,
        notes: typeof payload.body === "string" ? payload.body : undefined,
        source: "github",
    }; // 实现
} // 实现
export interface ServerUpdateInfo {
    // 实现
    version: string;
    downloadUrl: string;
    updateContent: string;
    updatedAt?: string;
} // 实现
export async function fetchServerUpdate(): Promise<ServerUpdateInfo | null> {
    // 实现
    try {
        const data = await signedRequest<Record<string, unknown>>(
            "get_latest_version",
            { platform: "desktop", device_id: getDeviceId() },
            { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
        );
        if (!data || !data.version) {
            return null;
        }

        const downloadUrl = String(data.downloadUrl ?? data.download_url ?? "");

        return {
            version: String(data.version || ""),
            downloadUrl: absoluteDownloadUrl(downloadUrl),
            updateContent: String(
                data.updateContent ?? data.content ?? data.update_content ?? "",
            ),
            updatedAt:
                typeof data.updatedAt === "string" ? data.updatedAt : undefined,
        };
    } catch (error) { // 实现
        console.error("[Update] 获取版本信息失败:", error);
        return null;
    } // 实现
} // 实现

/** 已验签内测资格响应的本地缓存键（fail-closed：断网凭缓存放行，无缓存/过期则锁）。 */
const BETA_ACCESS_CACHE_KEY = "xy.beta_access_signed_payload_v1";

async function readCachedBetaAccess(
    deviceId: string,
): Promise<{ allowed: boolean; pending: boolean } | null> {
    try {
        const raw = localStorage.getItem(BETA_ACCESS_CACHE_KEY);
        if (!raw) return null;
        const decoded = JSON.parse(raw);
        if (!decoded || typeof decoded !== "object") return null;
        return await parseSignedBetaAccess(decoded, deviceId);
    } catch {
        return null;
    }
}

/** 解析并验签一份 check_beta_access 响应。不可信返回 null。 */
async function parseSignedBetaAccess(
    payload: Record<string, unknown>,
    deviceId: string,
): Promise<{ allowed: boolean; pending: boolean } | null> {
    const payloadDevice = String(payload.device_id ?? "").trim();
    if (!payloadDevice || payloadDevice !== deviceId) return null;
    const exp = Number(payload.exp ?? 0);
    if (!Number.isFinite(exp) || Math.floor(exp) <= Date.now() / 1000) return null;
    const signature = String(payload.sig ?? "");
    if (!signature) return null;
    const allowed = payload.allowed === true;
    const pending = payload.pending === true;
    try {
        const ok = await tauriInvoke("verify_beta_access_signature", {
            deviceId,
            allowed,
            pending,
            exp: Math.floor(exp),
            signature,
        });
        if (ok) return { allowed, pending };
    } catch {
        // 落到下方 null
    }
    return null;
}

/**
 * 内测资格验证（fail-closed，供启动锁使用）：
 * 1) 联网请求 check_beta_access 并验签（ed25519，绑定 device_id + 过期时间），
 *    验签通过则更新本地缓存；
 * 2) 网络失败或响应不可信（无签名/验签失败/设备不匹配/已过期）时回退本地缓存，
 *    缓存同样经完整验签；
 * 3) 两者皆不可用返回 null，调用方应锁定（无法验证 ≠ 放行）。
 */
export async function verifyBetaAccess(): Promise<{
    allowed: boolean;
    pending: boolean;
} | null> {
    const deviceId = getDeviceId().trim();
    try {
        const data = await signedRequest<Record<string, unknown>>(
            "check_beta_access",
            { device_id: deviceId },
            { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
        );
        if (data && typeof data === "object") {
            const parsed = await parseSignedBetaAccess(data, deviceId);
            if (parsed) {
                try {
                    localStorage.setItem(
                        BETA_ACCESS_CACHE_KEY,
                        JSON.stringify(data),
                    );
                } catch {
                    // 缓存写入失败不影响放行
                }
                return parsed;
            }
        }
    } catch {
        // 网络失败走缓存回退
    }
    return readCachedBetaAccess(deviceId);
}

function absoluteDownloadUrl(url: string): string {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    const base = getAuthBaseUrl();
    if (!base) return url;
    const parsed = /^([a-z]+:\/\/([^/]+))(\/.*)?$/i.exec(base);
    if (!parsed) return url;
    const origin = parsed[1];
    let root = parsed[3] || "";
    if (root.endsWith("/api")) {
        root = root.slice(0, -"/api".length);
    }
    return `${origin}${root}${url}`;
}
