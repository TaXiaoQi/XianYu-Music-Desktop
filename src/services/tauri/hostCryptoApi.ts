/**
 * 宿主侧平台签名/加密 API（Rust host_crypto 命令封装）
 *
 * 前端不再自带 crypto-js 实现平台签名，统一走 Rust 后端计算：
 *   - QQ 音乐 zzcSign / 酷狗 MD5 签名 / 咪咕搜索签名
 *   - 网易云 linuxapi（AES-ECB）/ weapi（AES-CBC + RSA）
 *   - 通用 SHA256（插件脚本哈希）
 */

import { tauriInvoke } from './invoke';

/** QQ 音乐 DoSearchForQQMusicDesktop 请求签名 */
export function hostZzcSign(text: string): Promise<string> {
  return tauriInvoke('host_zzc_sign', { text });
}

/** 酷狗参数签名（platform: 'web' 用 web 盐，其余用 android 盐） */
export function hostKugouSign(params: string, platform: string, body = ''): Promise<string> {
  return tauriInvoke('host_kugou_sign', { params, platform, body });
}

/** 咪咕搜索签名（返回 sign + deviceId） */
export function hostMiguSign(text: string, time: string): Promise<{ sign: string; deviceId: string }> {
  return tauriInvoke('host_migu_sign', { text, time });
}

/** 网易云 linuxapi 加密（payload 为 JSON 字符串） */
export function hostLinuxapiEncrypt(payload: string): Promise<string> {
  return tauriInvoke('host_linuxapi_encrypt', { payload });
}

/** 网易云 weapi 加密（payload 为 JSON 字符串，返回 params + encSecKey） */
export function hostWeapiEncrypt(payload: string): Promise<{ params: string; encSecKey: string }> {
  return tauriInvoke('host_weapi_encrypt', { payload });
}

/** 通用 SHA256 hex（小写） */
export function hostSha256Hex(text: string): Promise<string> {
  return tauriInvoke('host_sha256_hex', { text });
}
