
import { tauriInvoke } from '../tauri/invoke';

export async function getPluginBilibiliCookies(): Promise<string> {
  try {
    return await tauriInvoke('plugin_engine_cookie_header_for_domain', { domain: 'bilibili' });
  } catch {
    return '';
  }
}
