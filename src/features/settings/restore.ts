import type { AppSettings } from '../../types'; // 实现
import { playerStorage } from '../../services/storage/playerStorage';
import { LEGACY_LYRICS_SETTINGS_KEY, LEGACY_DESKTOP_LYRICS_SETTINGS_KEY } from '../../composables/lyrics/constants';
import { normalizeLyricsSettingsPatch, normalizeDesktopLyricsSettingsPatch } from '../../composables/lyrics/constants';
import {
  markMigrationApplied,
  migratedVinylMaterial,
  readAppliedMigrationIds,
  VINYL_MATERIAL_LIGHT_MIGRATION_ID,
  type MigrationStorage,
} from './migrations';
import { mergeAppSettings } from './store'; // 实现

/** 宽松的对象判定：非 null/undefined 的 object 即成立（数组是否放行由调用方决定） */
const isObjectLike = (value: unknown): boolean => !!value && typeof value === 'object';

/**
 * 旧版本把歌词与桌面歌词配置单独存在 localStorage 的键里。
 * 恢复设置时若新结构缺少对应字段，就从旧键读取并迁移进来；
 * 内容不是合法 JSON、不是普通对象时一律视为不存在。
 */
function readLegacyJsonEntry<T extends object>(storageKey: string): Partial<T> | null {
  const rawText = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey);

  let decoded: Partial<T> | null = null;
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText) as Partial<T>;
      decoded = isObjectLike(parsed) && !Array.isArray(parsed) ? parsed : null;
    } catch (parseFailure) {
      decoded = null;
    }
  }

  return decoded;
}

function collectLegacyLyricsPatch(
  saved: Partial<AppSettings>, // 实现
): Partial<Pick<AppSettings, 'lyrics' | 'desktopLyrics'>> {
  const legacyPatch: Partial<Pick<AppSettings, 'lyrics' | 'desktopLyrics'>> = {};

  // 桌面歌词先查自己的旧键，查不到再借普通歌词的旧键
  const missingLyrics = !saved.lyrics;
  const missingDesktopLyrics = !saved.desktopLyrics;

  if (missingLyrics) {
    const legacyEntry = readLegacyJsonEntry<AppSettings['lyrics']>(LEGACY_LYRICS_SETTINGS_KEY);
    if (legacyEntry) legacyPatch.lyrics = normalizeLyricsSettingsPatch(legacyEntry);
  }

  if (missingDesktopLyrics) {
    const legacyEntry = readLegacyJsonEntry<AppSettings['desktopLyrics']>(LEGACY_DESKTOP_LYRICS_SETTINGS_KEY)
      ?? readLegacyJsonEntry<AppSettings['desktopLyrics']>(LEGACY_LYRICS_SETTINGS_KEY);
    if (legacyEntry) legacyPatch.desktopLyrics = normalizeDesktopLyricsSettingsPatch(legacyEntry);
  }

  return legacyPatch;
}

/** 窗口材质只接受这四个值；旧数据中的其它字符串一律回落到当前默认值 */
const ALLOWED_WINDOW_MATERIALS: readonly string[] = ['none', 'mica', 'acrylic', 'blur'];

// 存量主题快照可能携带早已废弃的旧字段（enableDynamicBg），动态背景等字段历史上是宽泛字符串
type StoredThemeSnapshot = Partial<AppSettings['theme']> & {
  windowMaterial?: string; dynamicBgType?: string; enableDynamicBg?: boolean;
};

const readPersistedPlayerSettings = (): AppSettings | null => playerStorage.readSettings();

/** 把存量快照并入当前默认值后整体替换 store 设置；解析或合并抛错由调用方兜底 */
function applyPersistedSnapshot(
  currentSettings: AppSettings, // 实现
  replaceSettings: (settings: AppSettings) => void, // 实现
  persistedSnapshot: AppSettings,
  appliedMigrationIds: readonly string[],
) {
  const saved = persistedSnapshot as Partial<typeof currentSettings>;
  if (!isObjectLike(saved) || Array.isArray(saved)) return;

  const themeSnapshot = (isObjectLike(saved.theme) ? saved.theme : {}) as StoredThemeSnapshot;
  const sidebarSnapshot = (isObjectLike(saved.sidebar) ? saved.sidebar : {}) as Partial<AppSettings['sidebar']>;
  const customBackgroundSnapshot = (isObjectLike(themeSnapshot.customBackground)
    ? themeSnapshot.customBackground
    : {}) as Partial<AppSettings['theme']['customBackground']>;

  // 旧字段 enableDynamicBg 是 dynamicBgType 的前身：仅在后者缺失时用它推一个初始值
  let resolvedDynamicBgType = themeSnapshot.dynamicBgType;
  if (resolvedDynamicBgType === undefined && themeSnapshot.enableDynamicBg !== undefined) {
    resolvedDynamicBgType = themeSnapshot.enableDynamicBg ? 'flow' : 'none';
  }

  const resolvedWindowMaterial = typeof themeSnapshot.windowMaterial === 'string'
    && ALLOWED_WINDOW_MATERIALS.includes(themeSnapshot.windowMaterial)
    ? themeSnapshot.windowMaterial
    : currentSettings.theme.windowMaterial;

  // 一次性迁移（见 migrations.ts）：存量里的旧默认材质 'matte' 改写为新默认 'light'
  const migratedVinyl = migratedVinylMaterial(themeSnapshot.playerDetailVinylMaterial, appliedMigrationIds);
  const nextVinylMaterial = migratedVinyl ?? themeSnapshot.playerDetailVinylMaterial;

  // 非 none 的窗口材质会压制流光/模糊等动态背景
  const restoredTheme = {
    ...themeSnapshot,
    playerDetailVinylMaterial: nextVinylMaterial,
    windowMaterial: resolvedWindowMaterial,
    customBackground: customBackgroundSnapshot,
    dynamicBgType: resolvedWindowMaterial !== 'none' ? 'none' as const
      : (resolvedDynamicBgType || currentSettings.theme.dynamicBgType),
  };

  const restoredSettings = mergeAppSettings(currentSettings, {
    ...saved,
    ...collectLegacyLyricsPatch(saved),
    sidebar: sidebarSnapshot,
    theme: restoredTheme,
  });
  replaceSettings(restoredSettings);
}

export function restorePersistedAppSettings(
  currentSettings: AppSettings, replaceSettings: (settings: AppSettings) => void,
  readSettings: () => AppSettings | null = readPersistedPlayerSettings,
  migrationStorage: MigrationStorage = playerStorage,
) {
  const persistedSnapshot = readSettings();

  // 迁移判定必须先于写入 marker，否则本次恢复会被自己刚记下的 marker 骗过；
  // 就算没有存量设置也要落 marker：全新 profile 若首启就显式选了「哑光」，
  // 不记 id 的话，下次启动会因「有存量 + 无 marker」被误判成旧默认值而遭静默改写。
  const appliedMigrationIds = readAppliedMigrationIds(migrationStorage);
  markMigrationApplied(VINYL_MATERIAL_LIGHT_MIGRATION_ID, migrationStorage);

  if (!persistedSnapshot) return;

  try {
    applyPersistedSnapshot(currentSettings, replaceSettings, persistedSnapshot, appliedMigrationIds);
  } catch (restoreFailure) {
    console.error('Failed to parse settings:', restoreFailure);
  }
}
