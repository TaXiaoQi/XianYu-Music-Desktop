/**
 * 使用统计 · 设备标识与设备信息（叶子，无依赖）。
 */

import { APP_VERSION } from '../../../version';

const DEVICE_ID_KEY = 'xy.device.id';

/** 生成 RFC4122 v4 UUID */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** 获取（或首次生成并持久化）稳定的设备标识 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generateUuid();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

/** 从 navigator.userAgent 解析操作系统版本（项目仅支持 Windows） */
function parseOsVersion(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const m = ua.match(/Windows NT (\d+\.\d+)/);
  if (m) {
    return `Windows NT ${m[1]}`;
  }
  return 'Windows';
}

function getDeviceModel(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const arch = /WOW64|Win64|x64/.test(ua) ? 'x64' : 'x86';
  return `Windows PC (${arch})`;
}

export interface DeviceInfo {
  device_id: string;
  app_version: string;
  os_version: string;
  device_model: string;
}

let cachedDeviceInfo: DeviceInfo | null = null;

export function getDeviceInfo(): DeviceInfo {
  if (!cachedDeviceInfo) {
    cachedDeviceInfo = {
      device_id: getDeviceId(),
      app_version: APP_VERSION,
      os_version: parseOsVersion(),
      device_model: getDeviceModel(),
    };
  }
  return cachedDeviceInfo;
}