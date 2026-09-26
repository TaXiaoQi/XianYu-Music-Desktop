import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import type { VinylPlinthMaterial } from '../../types';

/**
 * 设置的一次性迁移。
 *
 * 每条迁移只跑一次：跑过的 id 记在 playerStorageKeys.settingsMigrations（JSON 数组）里。
 * 之所以记 id、而不是单纯判断「某字段是否等于旧默认值」，是因为用户可能在迁移之后
 * 主动把值改回旧的 —— 那种情况不该被再迁一次。
 */

/** 底座材质的默认值由「哑光深灰」改为「浅灰」 */
export const VINYL_MATERIAL_LIGHT_MIGRATION_ID = 'vinyl-material-light-default';

/** 迁移只用到这两个存储方法，抽成参数便于测试 */
export type MigrationStorage = Pick<typeof playerStorage, 'getString' | 'setString'>;

/** 已应用过的迁移 id；内容损坏或不是数组时按「都没跑过」处理 */
export function readAppliedMigrationIds(storage: MigrationStorage = playerStorage): string[] {
  const raw = storage.getString(playerStorageKeys.settingsMigrations);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/** 记下某条迁移已跑过（重复调用不会写第二遍；写失败不影响调用方） */
export function markMigrationApplied(id: string, storage: MigrationStorage = playerStorage) {
  try {
    const applied = readAppliedMigrationIds(storage);
    if (applied.includes(id)) return;
    storage.setString(playerStorageKeys.settingsMigrations, JSON.stringify([...applied, id]));
  } catch (error) {
    // localStorage 写满时 setString 会抛（setJson 才有淘汰重试路径）。marker 写不进去
    // 只会让迁移在下次启动再判定一次，不能因此打断设置恢复、也不该报成解析失败。
    console.error('[settings] 记录迁移 id 失败:', id, error);
  }
}

/**
 * 存量设置里的 'matte' 是「当时的默认值」，几乎都不是主动选择，按新默认迁到 'light'。
 * 主动选过哑光的用户会被同样迁移一次（新旧值无法区分），在设置里改回来即可，改回后
 * 不会再被迁移。
 *
 * 返回需要改写的值；不需要迁移时返回 undefined（调用方保持原值）。
 */
export function migratedVinylMaterial(
  savedMaterial: unknown,
  appliedIds: readonly string[] = readAppliedMigrationIds(),
): VinylPlinthMaterial | undefined {
  if (appliedIds.includes(VINYL_MATERIAL_LIGHT_MIGRATION_ID)) return undefined;
  return savedMaterial === 'matte' ? 'light' : undefined;
}
