import { tauriInvoke } from './invoke';

export const authApi = {
  setAuthBaseUrl: (baseUrl: string) => tauriInvoke('set_auth_base_url', { baseUrl }),
  setAuthApiSecret: (apiSecret: string) => tauriInvoke('set_auth_api_secret', { apiSecret }),
  getAuthCredentials: () => tauriInvoke('get_auth_credentials'),
  getAuthBaseUrl: () => tauriInvoke('get_auth_base_url'),
  getAuthApiSecret: () => tauriInvoke('get_auth_api_secret'),
  saveAuthCredentials: (token: string, user: unknown) =>
    tauriInvoke('save_auth_credentials', { token, user }),
  clearAuthCredentials: () => tauriInvoke('clear_auth_credentials'),
  authedRequest: (
    action: string,
    body: Record<string, unknown>,
    fetchTimeoutMs?: number,
  ) => tauriInvoke('authed_request', { action, body, fetchTimeoutMs }),
  signedPostJson: (
    url: string,
    body: Record<string, unknown>,
    fetchTimeoutMs?: number,
  ) => tauriInvoke('signed_post_json', { url, body, fetchTimeoutMs }),
};
