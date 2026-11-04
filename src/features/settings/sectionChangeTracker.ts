import { localStore } from '../../services/storage/localStore';
import { playerStorageKeys } from '../../services/storage/playerStorage';

/**
 * 设置分节（AppSettings 顶层字段）最近一次本地变更时间戳账本。
 *
 * 同步语义：设置按分节做 LWW（新者优先）——本端 patch 过的分节记为「本地较新」，
 * 上传时账本随载荷（__sectionTs__）带到云端；下载时逐分节对比时间戳，
 * 云端较新的分节才落地本地，避免旧端全量上传反向覆盖他端新改的设置。
 *
 * 刻意不覆盖「启动恢复」（restore.ts）路径：从磁盘快照恢复不算本地变更，
 * 否则每次启动都会把全部分节标成新改，反向覆盖其他端。
 */

const SECTION_TS_KEY = playerStorageKeys.settingsSectionTs;

/** 设备本地字段：值随端不同，不参与跨端同步，恒以本端为准 */
export const SETTINGS_DEVICE_LOCAL_KEYS: readonly string[] = ['upload', 'organizeRoot'];

export function isSyncableSettingSection(key: string): boolean {
  return !SETTINGS_DEVICE_LOCAL_KEYS.includes(key);
}

export function readSectionTimestamps(): Record<string, number> {
  const parsed = localStore.getJson<unknown>(SECTION_TS_KEY);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const table: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) table[key] = value;
  }
  return table;
}

/** 记录分节本地变更（同一批 keys 共用同一时间戳）；keys 为空时不动账本 */
export function markSectionsChanged(keys: readonly string[], at = Date.now()): void {
  if (keys.length === 0) return;
  const table = readSectionTimestamps();
  for (const key of keys) {
    if (typeof key === 'string' && key !== '') table[key] = at;
  }
  localStore.setJson(SECTION_TS_KEY, table);
}

/** 按映射写入分节时间戳（合并语义，用于同步后对齐账本）；非法值忽略 */
export function writeSectionTimestamps(table: Record<string, number>): void {
  const entries = Object.entries(table).filter(
    ([key, value]) => key !== '' && typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );
  if (entries.length === 0) return;
  localStore.setJson(SECTION_TS_KEY, { ...readSectionTimestamps(), ...Object.fromEntries(entries) });
}
