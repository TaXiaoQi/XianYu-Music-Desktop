import { invoke, isTauri } from '@tauri-apps/api/core';

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

export function compareVersions(left: string, right: string): number {
  const leftParts = extractVersion(left).split('.').map(part => Number.parseInt(part, 10) || 0);
  const rightParts = extractVersion(right).split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

export async function fetchLatestRelease(owner: string, repo: string): Promise<ReleaseInfo> {
  let payload: any;

  if (isTauri()) {
    try {
      const rawJson = await invoke<string>('check_update_by_rust', { owner, repo });
      payload = JSON.parse(rawJson);
    } catch (error) {
      throw new Error(`[Rust Backend] ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  } else {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
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

// --- 自建后台版本更新检查 ---
// 桌面端「检查更新」改用自建后台（xy.zh2026.cn），由后台「版本管理」页顶部卡片配置。
// 接口为免签公开读取，返回 {code, msg, data}，data 为最新启用版本或 null。
const SERVER_VERSION_URL = 'https://xy.zh2026.cn/chaoguan/public/api/version.php';

export interface ServerUpdateInfo {
  version: string;
  downloadUrl: string;
  updateContent: string;
  updatedAt?: string;
}

export async function fetchServerUpdate(): Promise<ServerUpdateInfo | null> {
  try {
    const response = await fetch(SERVER_VERSION_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error('[Update] HTTP 状态异常:', response.status);
      return null;
    }

    const payload = await response.json();
    if (!payload || payload.code !== 200 || !payload.data) {
      return null;
    }

    const data = payload.data;
    if (!data || !data.version) {
      return null;
    }

    return {
      version: data.version,
      downloadUrl: data.downloadUrl ?? '',
      updateContent: data.updateContent ?? '',
      updatedAt: data.updatedAt,
    };
  } catch (error) {
    console.error('[Update] 获取版本信息失败:', error);
    return null;
  }
}
