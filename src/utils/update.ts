import { isTauri } from '@tauri-apps/api/core';
import { updateApi } from '../services/tauri/updateApi';
import { getAuthBaseUrl, signedRequest } from '../services/auth/authService';
import { getDeviceId } from '../services/domain/usageStats';
import { assertSafeOutboundUrl } from './urlGuard';

const VERSION_PATTERN = /\d+(?:\.\d+)+/;

export interface ReleaseInfo {
  version: string;
  url: string;
  downloadUrl?: string;
  changelogUrl?: string;
  publishedAt?: string;
  notes?: string;
  source?: 'github';
}

export function extractVersion(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(VERSION_PATTERN);
  return match ? match[0] : trimmed.replace(/^[vV]/, '');
}

interface ParsedVersion {
  fields: number[];
  pre: string | null;
}

/** 解析主版本 + 预发布段（如 `2.0.0-beta5` → [2,0,0] + `beta5`）。 */
function parseVersion(value: string): ParsedVersion {
  const trimmed = value.trim().replace(/^[vV]/, '');
  const dash = trimmed.indexOf('-');
  const main = dash >= 0 ? trimmed.slice(0, dash) : trimmed;
  const pre = dash >= 0 ? trimmed.slice(dash + 1) : null;
  const fields = main.split('.').map((p) => Number.parseInt(p, 10) || 0);
  return { fields, pre };
}

/**
 * 版本号比较（支持 `-betaN`/`-alphaN` 等预发布后缀）：
 * 主版本数字逐段比较；相等时正式版 > 预发布版；
 * 预发布之间按前缀（字母）再数字比较，避免 `beta5` 与 `beta4` 被判为相等。
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.fields.length, b.fields.length);

  for (let index = 0; index < length; index += 1) {
    const av = a.fields[index] ?? 0;
    const bv = b.fields[index] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }

  // 主版本相等：正式版 > 预发布版。
  if (a.pre === null && b.pre !== null) return 1;
  if (a.pre !== null && b.pre === null) return -1;
  if (a.pre !== null && b.pre !== null) {
    const aToken = (a.pre.match(/^[a-zA-Z]*/) || [''])[0];
    const bToken = (b.pre.match(/^[a-zA-Z]*/) || [''])[0];
    if (aToken !== bToken) return aToken > bToken ? 1 : -1;
    const an = Number.parseInt((a.pre.match(/\d+/) || ['0'])[0], 10) || 0;
    const bn = Number.parseInt((b.pre.match(/\d+/) || ['0'])[0], 10) || 0;
    if (an !== bn) return an > bn ? 1 : -1;
    if (a.pre !== b.pre) return a.pre > b.pre ? 1 : -1;
  }

  return 0;
}

export async function fetchLatestRelease(owner: string, repo: string): Promise<ReleaseInfo> {
  let payload: any;

  if (isTauri()) {
    try {
      const rawJson = await updateApi.checkUpdateByRust(owner, repo);
      payload = JSON.parse(rawJson);
    } catch (error) {
      throw new Error(`[Rust Backend] ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  } else {
    const githubUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    // 非 Tauri 环境（浏览器预览）直连 GitHub 前做出站校验（host 须为 api.github.com）
    assertSafeOutboundUrl(githubUrl);
    const response = await fetch(githubUrl, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) {
      throw new Error(`[Browser Fetch] HTTP status ${response.status}`);
    }
    payload = await response.json();
  }

  const versionSource = typeof payload.tag_name === 'string' ? payload.tag_name : payload.name;
  const version = typeof versionSource === 'string' ? extractVersion(versionSource) : '';

  if (!version) {
    throw new Error('Latest release version is missing');
  }

  return {
    version,
    url: typeof payload.html_url === 'string' ? payload.html_url : `https://github.com/${owner}/${repo}/releases`,
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : undefined,
    notes: typeof payload.body === 'string' ? payload.body : undefined,
    source: 'github'
  };
}

export interface ServerUpdateInfo {
  version: string;
  downloadUrl: string;
  updateContent: string;
  updatedAt?: string;
}

export async function fetchServerUpdate(): Promise<ServerUpdateInfo | null> {
  try {
    // 携带设备ID：服务端据此判断是否下发测试版（内测名单设备专属）
    const data = await signedRequest<Record<string, unknown>>(
      'get_latest_version',
      { platform: 'desktop', device_id: getDeviceId() },
      { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
    );
    if (!data || !data.version) {
      return null;
    }

    const downloadUrl = String(data.downloadUrl ?? data.download_url ?? '');

    return {
      version: String(data.version || ''),
      downloadUrl: absoluteDownloadUrl(downloadUrl),
      updateContent: String(data.updateContent ?? data.content ?? data.update_content ?? ''),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    };
  } catch (error) {
    console.error('[Update] 获取版本信息失败:', error);
    return null;
  }
}

/**
 * 内测资格检查：当前设备是否在内测名单中。
 * 仅在本地版本号为 beta 构建时调用；调用方需 try/catch（旧服务器无此接口时 fail-open）。
 */
export async function fetchBetaAccess(): Promise<{ allowed: boolean; pending: boolean }> {
  const data = await signedRequest<{ allowed?: boolean; pending?: boolean }>(
    'check_beta_access',
    { platform: 'desktop', device_id: getDeviceId() },
    { fetchTimeoutMs: 15_000, timeoutMs: 18_000 },
  );
  return {
    allowed: data?.allowed === true,
    pending: data?.pending === true,
  };
}

/**
 * 把服务端返回的相对下载链接（如 `/uploads/packages/...`）拼成可打开的绝对地址。
 * 默认 server 的 API 前缀为 /api，而静态文件 /uploads 挂在站点根下，需去掉前缀。
 */
function absoluteDownloadUrl(url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const base = getAuthBaseUrl();
  if (!base) return url;
  const parsed = /^([a-z]+:\/\/([^/]+))(\/.*)?$/i.exec(base);
  if (!parsed) return url;
  const origin = parsed[1]; // scheme://host[:port]
  let root = parsed[3] || '';
  if (root.endsWith('/api')) {
    root = root.slice(0, -'/api'.length);
  }
  return `${origin}${root}${url}`;
}
