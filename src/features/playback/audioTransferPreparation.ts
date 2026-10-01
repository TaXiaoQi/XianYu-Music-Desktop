import {pluginApi} from '../../services/tauri/pluginApi';
import {getPluginBilibiliCookies} from '../../services/domain/pluginCookieStore';

export interface AudioTransferPreparationDeps {
  downloadAudioToTemp: typeof pluginApi.downloadAudioToTemp;
  getBilibiliCookies: typeof getPluginBilibiliCookies;
}

const defaultDeps: AudioTransferPreparationDeps = {
  downloadAudioToTemp: pluginApi.downloadAudioToTemp,
  getBilibiliCookies: getPluginBilibiliCookies,
};

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function prepareAudioTransfer(
  audioPath: string,
  pluginHeaders: Record<string, string> | null,
  deps: AudioTransferPreparationDeps = defaultDeps,
): Promise<{audioPath: string; usedTempFile: boolean}> {
  const isNetworkAudio = /^https?:\/\//.test(audioPath);
  const requiresDownload = isNetworkAudio
    && (audioPath.includes('.m4s') || audioPath.includes('bilivideo.com') || audioPath.includes('bilivideo.cn'));
  if (!requiresDownload) return {audioPath, usedTempFile: false};

  try {
    const headers: Record<string, string> = {...(pluginHeaders ?? {})};
    const ensureEffectiveHeader = (name: string, value: string) => {
      const lower = name.toLowerCase();
      let foundKey: string | null = null;
      let foundValue = '';
      for (const [key, headerValue] of Object.entries(headers)) {
        if (key.toLowerCase() === lower) {
          foundKey = key;
          foundValue = String(headerValue ?? '');
          break;
        }
      }
      if (!foundKey || !/^https?:\/\//i.test(foundValue)) {
        if (foundKey) delete headers[foundKey];
        headers[name] = value;
      }
    };
    ensureEffectiveHeader('Referer', 'https://www.bilibili.com');
    ensureEffectiveHeader('Origin', 'https://www.bilibili.com');
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'cookie')) {
      const cookies = await deps.getBilibiliCookies();
      if (cookies) headers.Cookie = cookies;
    }
    const tempPath = await deps.downloadAudioToTemp(audioPath, headers);
    return tempPath ? {audioPath: tempPath, usedTempFile: true} : {audioPath, usedTempFile: false};
  } catch (error) {
    console.warn('[Audio] m4s 下载到临时文件失败:', getErrorMessage(error));
    return {audioPath, usedTempFile: false};
  }
}
