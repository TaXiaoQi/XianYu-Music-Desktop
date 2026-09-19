
import { APP_VERSION } from '../../../version';
import { tauriInvoke } from '../tauri/invoke';

const DEVICE_ID_KEY = 'xy.device.id';

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

export async function syncStableDeviceId(): Promise<void> {
  try {
    const machineGuid = await tauriInvoke('get_machine_id');
    if (!machineGuid) return;
    if (localStorage.getItem(DEVICE_ID_KEY) !== machineGuid) {
      localStorage.setItem(DEVICE_ID_KEY, machineGuid);
    }
  } catch {
    /* 非 Tauri 环境或读取失败时静默，沿用现有 ID */
  }
}

function parseOsVersion(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const m = ua.match(/Windows NT (\d+\.\d+)/);
  if (m) {
    return `Windows NT ${m[1]}`;
  }
  if (/Linux/.test(ua)) {
    return 'Linux';
  }
  if (/Mac OS X (\d+[._]\d+)/.test(ua)) {
    return 'macOS';
  }
  return 'Unknown';
}

function getDeviceModel(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const arch = /WOW64|Win64|x64|x86_64/.test(ua) ? 'x64' : 'x86';
  if (/Macintosh|Mac OS X/.test(ua)) {
    return `Mac (${arch})`;
  }
  if (/Linux/.test(ua)) {
    return `Linux PC (${arch})`;
  }
  return `Windows PC (${arch})`;
}

export interface DeviceInfo {
  device_id: string;
  app_version: string;
  os_version: string;
  device_model: string;
  device_brand: string;
  architecture: string;
  machine_name: string;
}

let cachedDeviceInfo: DeviceInfo | null = null;

export function getDeviceInfo(): DeviceInfo {
  if (!cachedDeviceInfo) {
    cachedDeviceInfo = {
      device_id: getDeviceId(),
      app_version: APP_VERSION,
      os_version: parseOsVersion(),
      device_model: getDeviceModel(),
      device_brand: 'Windows',
      architecture: getArch(),
      machine_name: '',
    };
  }
  return cachedDeviceInfo;
}

function getArch(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /WOW64|Win64|x64|x86_64|aarch64|arm64/.test(ua) ? 'x64' : 'x86';
}

export async function enrichSystemInfo(): Promise<void> {
  try {
    const info = await tauriInvoke('get_system_info');
    if (!cachedDeviceInfo) getDeviceInfo();
    if (cachedDeviceInfo) {
      cachedDeviceInfo = {
        ...cachedDeviceInfo,
        device_brand: info.device_brand || cachedDeviceInfo.device_brand,
        device_model: info.device_model || cachedDeviceInfo.device_model,
        os_version: info.os_version || cachedDeviceInfo.os_version,
        architecture: info.architecture || cachedDeviceInfo.architecture,
        machine_name: info.machine_name || '',
      };
    }
  } catch {
    // 原生命令不可用（如纯浏览器预览）时静默
  }
}