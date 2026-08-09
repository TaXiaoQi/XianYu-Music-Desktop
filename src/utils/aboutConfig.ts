import { signedRequest } from '../services/auth/authService';

export interface AboutConfig {
  officialSiteUrl: string;
  officialSiteText: string;
  updateEnabled: boolean;
  updateText: string;
  projectUrl: string;
  projectText: string;
  referenceProjectUrl: string;
  referenceProjectText: string;
}

export const DEFAULT_ABOUT_CONFIG: AboutConfig = {
  officialSiteUrl: 'https://xy.zh2026.cn/ciyuanxi/',
  officialSiteText: '前往官网',
  updateEnabled: true,
  updateText: '检查更新',
  projectUrl: 'https://github.com/TaXiaoQi/XianYu-Music-Desktop',
  projectText: '开源地址',
  referenceProjectUrl: 'https://github.com/Billy636/XianYuMusic',
  referenceProjectText: '参考项目',
};

function asText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export async function fetchAboutConfig(): Promise<AboutConfig> {
  try {
    const data = await signedRequest<Record<string, unknown>>(
      'get_about_config',
      {},
      { fetchTimeoutMs: 8_000, timeoutMs: 10_000 },
    );

    return {
      officialSiteUrl: asText(data.officialSiteUrl, DEFAULT_ABOUT_CONFIG.officialSiteUrl),
      officialSiteText: asText(data.officialSiteText, DEFAULT_ABOUT_CONFIG.officialSiteText),
      updateEnabled: typeof data.updateEnabled === 'boolean'
        ? data.updateEnabled
        : DEFAULT_ABOUT_CONFIG.updateEnabled,
      updateText: asText(data.updateText, DEFAULT_ABOUT_CONFIG.updateText),
      projectUrl: asText(data.projectUrl, DEFAULT_ABOUT_CONFIG.projectUrl),
      projectText: asText(data.projectText, DEFAULT_ABOUT_CONFIG.projectText),
      referenceProjectUrl: asText(data.referenceProjectUrl, DEFAULT_ABOUT_CONFIG.referenceProjectUrl),
      referenceProjectText: asText(data.referenceProjectText, DEFAULT_ABOUT_CONFIG.referenceProjectText),
    };
  } catch (error) {
    console.warn('[AboutConfig] 获取关于页配置失败，使用默认配置', error);
    return DEFAULT_ABOUT_CONFIG;
  }
}
