import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { createDefaultAppSettings, useSettingsStore } from './store';
import { restorePersistedAppSettings } from './restore';
import {
  VINYL_MATERIAL_LIGHT_MIGRATION_ID,
  markMigrationApplied,
  migratedVinylMaterial,
  readAppliedMigrationIds,
} from './migrations';
import { playerStorageKeys } from '../../services/storage/playerStorage';
import type { AppSettings } from '../../types';

/** 迁移只依赖 getString/setString，用内存实现替代 localStorage（测试环境没有 localStorage） */
const createMemoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getString: (key: string) => map.get(key) ?? null,
    setString: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

describe('settings migrations', () => {
  it('migrates the legacy matte material to light', () => {
    expect(migratedVinylMaterial('matte', [])).toBe('light');
    expect(migratedVinylMaterial('marble', [])).toBeUndefined();
    expect(migratedVinylMaterial(undefined, [])).toBeUndefined();
  });

  it('does not migrate again once the id is recorded', () => {
    expect(migratedVinylMaterial('matte', [VINYL_MATERIAL_LIGHT_MIGRATION_ID])).toBeUndefined();
  });

  it('records applied ids once and tolerates a corrupted value', () => {
    const storage = createMemoryStorage();
    expect(readAppliedMigrationIds(storage)).toEqual([]);

    markMigrationApplied(VINYL_MATERIAL_LIGHT_MIGRATION_ID, storage);
    markMigrationApplied(VINYL_MATERIAL_LIGHT_MIGRATION_ID, storage);
    expect(readAppliedMigrationIds(storage)).toEqual([VINYL_MATERIAL_LIGHT_MIGRATION_ID]);

    storage.setString(playerStorageKeys.settingsMigrations, '{not json');
    expect(readAppliedMigrationIds(storage)).toEqual([]);
  });

  describe('restore integration', () => {
    beforeEach(() => {
      setActivePinia(createPinia());
    });

    /** 走一次完整恢复流程（读入指定材质），返回恢复后的 store 与迁移存储 */
    const restoreWithMaterial = (material: unknown, storage = createMemoryStorage()) => {
      const settingsStore = useSettingsStore();
      const defaults = createDefaultAppSettings();
      const persisted = {
        ...defaults,
        theme: { ...defaults.theme, playerDetailVinylMaterial: material },
      } as unknown as AppSettings;

      restorePersistedAppSettings(
        settingsStore.settings,
        settingsStore.replaceSettings,
        () => persisted,
        storage,
      );
      return { settingsStore, storage };
    };

    it('rewrites a stored matte material to light and records the migration', () => {
      const { settingsStore, storage } = restoreWithMaterial('matte');
      expect(settingsStore.settings.theme.playerDetailVinylMaterial).toBe('light');
      expect(readAppliedMigrationIds(storage)).toEqual([VINYL_MATERIAL_LIGHT_MIGRATION_ID]);
    });

    it('keeps an explicitly chosen material', () => {
      const { settingsStore } = restoreWithMaterial('marble');
      expect(settingsStore.settings.theme.playerDetailVinylMaterial).toBe('marble');
    });

    it('leaves matte alone when the migration already ran', () => {
      const storage = createMemoryStorage();
      restoreWithMaterial('matte', storage);
      const { settingsStore } = restoreWithMaterial('matte', storage);
      expect(settingsStore.settings.theme.playerDetailVinylMaterial).toBe('matte');
    });

    it('records the migration on a fresh profile with no stored settings', () => {
      const storage = createMemoryStorage();
      const settingsStore = useSettingsStore();

      // 全新 profile：没有任何存量设置
      restorePersistedAppSettings(
        settingsStore.settings,
        settingsStore.replaceSettings,
        () => null,
        storage,
      );
      expect(readAppliedMigrationIds(storage)).toEqual([VINYL_MATERIAL_LIGHT_MIGRATION_ID]);

      // 首启会话里用户显式选了哑光 → 下次启动不该被静默改写
      const { settingsStore: nextStore } = restoreWithMaterial('matte', storage);
      expect(nextStore.settings.theme.playerDetailVinylMaterial).toBe('matte');
    });
  });
});
