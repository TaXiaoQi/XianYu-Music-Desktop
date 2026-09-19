
import { tauriInvoke } from './invoke';

export function hostZzcSign(text: string): Promise<string> {
  return tauriInvoke('host_zzc_sign', { text });
}

export function hostKugouSign(params: string, platform: string, body = ''): Promise<string> {
  return tauriInvoke('host_kugou_sign', { params, platform, body });
}

export function hostKugouRequestKey(): Promise<string> {
  return tauriInvoke('host_kugou_request_key');
}

export function hostMiguSign(text: string, time: string): Promise<{ sign: string; deviceId: string }> {
  return tauriInvoke('host_migu_sign', { text, time });
}

export function hostLinuxapiEncrypt(payload: string): Promise<string> {
  return tauriInvoke('host_linuxapi_encrypt', { payload });
}

export function hostWeapiEncrypt(payload: string): Promise<{ params: string; encSecKey: string }> {
  return tauriInvoke('host_weapi_encrypt', { payload });
}

export function hostSha256Hex(text: string): Promise<string> {
  return tauriInvoke('host_sha256_hex', { text });
}
