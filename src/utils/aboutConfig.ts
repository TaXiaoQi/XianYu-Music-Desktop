import { ref } from 'vue';
import { signedRequest } from '../services/auth/authService';

export interface AcknowledgementsItem {
  name: string;
  url: string;
}

export interface AboutConfig {
  officialSiteUrl: string;
  updateEnabled: boolean;
  projectUrl: string;
  referenceProjectUrl: string;
  joinGroupUrl: string;
  acknowledgements: AcknowledgementsItem[];
}

export const DEFAULT_ABOUT_CONFIG: AboutConfig = {
  officialSiteUrl: 'https://xianyumusic.cn/',
  updateEnabled: true,
  projectUrl: 'https://github.com/TaXiaoQi/XianYu-Music-Desktop',
  referenceProjectUrl: 'https://github.com/Billy636/LyciaMusic',
  joinGroupUrl: 'https://qm.qq.com/q/kvteWSD8yY',
  acknowledgements: [
    { name: '@Billy636', url: 'https://github.com/Billy636' },
    { name: '@Zencok', url: 'https://github.com/Zencok' },
    { name: '@kiomosu', url: 'https://github.com/kiomosu' },
  ],
};

/** 模块级响应式关于页配置，供关于页等组件共享，服务器下发后即时更新 */
export const aboutConfig = ref<AboutConfig>({ ...DEFAULT_ABOUT_CONFIG });

function asUrl(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asAcknowledgements(value: unknown): AcknowledgementsItem[] {
  if (!Array.isArray(value)) return [...DEFAULT_ABOUT_CONFIG.acknowledgements];
  const items: AcknowledgementsItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name =
      typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : '';
    if (!name) continue;
    const url =
      typeof record.url === 'string' && record.url.trim()
        ? record.url.trim()
        : '';
    items.push({ name, url });
  }
  return items;
}

export async function fetchAboutConfig(): Promise<AboutConfig> {
  try {
    const data = await signedRequest<Record<string, unknown>>(
      'get_about_config',
      { platform: 'desktop' },
      { fetchTimeoutMs: 8_000, timeoutMs: 10_000 },
    );

    return {
      officialSiteUrl: asUrl(data.officialSiteUrl, DEFAULT_ABOUT_CONFIG.officialSiteUrl),
      updateEnabled: typeof data.updateEnabled === 'boolean'
        ? data.updateEnabled
        : DEFAULT_ABOUT_CONFIG.updateEnabled,
      projectUrl: asUrl(data.projectUrl, DEFAULT_ABOUT_CONFIG.projectUrl),
      referenceProjectUrl: asUrl(data.referenceProjectUrl, DEFAULT_ABOUT_CONFIG.referenceProjectUrl),
      joinGroupUrl: asUrl(data.joinGroupUrl, DEFAULT_ABOUT_CONFIG.joinGroupUrl),
      acknowledgements: asAcknowledgements(data.acknowledgements),
    };
  } catch (error) {
    console.warn('[AboutConfig] 获取关于页配置失败，使用默认配置', error);
    return { ...DEFAULT_ABOUT_CONFIG };
  }
}

const POLL_INTERVAL_MS = 30_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** 立即刷新一次关于页配置到响应式对象 */
export async function refreshAboutConfig(): Promise<void> {
  aboutConfig.value = await fetchAboutConfig();
}

/**
 * 启动关于页配置轮询（幂等）。
 * 服务器下发新配置后，客户端会在轮询周期内即时更新，避免停留在旧网址。
 */
export function startAboutConfigPolling(): void {
  if (pollTimer) return;
  void refreshAboutConfig();
  pollTimer = setInterval(() => {
    void refreshAboutConfig();
  }, POLL_INTERVAL_MS);
}

/** 停止关于页配置轮询 */
export function stopAboutConfigPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}