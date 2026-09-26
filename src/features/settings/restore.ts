import {
  LEGACY_DESKTOP_LYRICS_SETTINGS_KEY,
  LEGACY_LYRICS_SETTINGS_KEY,
  normalizeDesktopLyricsSettingsPatch,
  normalizeLyricsSettingsPatch,
} from '../../composables/lyrics/constants';
import { playerStorage } from '../../services/storage/playerStorage';
import type { AppSettings } from '../../types';
import {
  VINYL_MATERIAL_LIGHT_MIGRATION_ID,
  markMigrationApplied,
  migratedVinylMaterial,
  readAppliedMigrationIds,
  type MigrationStorage,
} from './migrations';
import { mergeAppSettings } from './store';

const readLegacyLyricsSettings = <T extends object>(key: string): Partial<T> | null => {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<T>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const resolveLegacyLyricsSettingsPatch = (
  saved: Partial<AppSettings>,
): Partial<Pick<AppSettings, 'lyrics' | 'desktopLyrics'>> => {
  const patch: Partial<Pick<AppSettings, 'lyrics' | 'desktopLyrics'>> = {};

  if (!saved.lyrics) {
    const legacyLyrics = readLegacyLyricsSettings<AppSettings['lyrics']>(LEGACY_LYRICS_SETTINGS_KEY);
    if (legacyLyrics) {
      patch.lyrics = normalizeLyricsSettingsPatch(legacyLyrics);
    }
  }

  if (!saved.desktopLyrics) {
    const legacyDesktopLyrics = readLegacyLyricsSettings<AppSettings['desktopLyrics']>(LEGACY_DESKTOP_LYRICS_SETTINGS_KEY)
      ?? readLegacyLyricsSettings<AppSettings['desktopLyrics']>(LEGACY_LYRICS_SETTINGS_KEY);
    if (legacyDesktopLyrics) {
      patch.desktopLyrics = normalizeDesktopLyricsSettingsPatch(legacyDesktopLyrics);
    }
  }

  return patch;
};

export function restorePersistedAppSettings(
  currentSettings: AppSettings,
  replaceSettings: (settings: AppSettings) => void,
  readSettings: () => AppSettings | null = () => playerStorage.readSettings(),
  migrationStorage: MigrationStorage = playerStorage,
) {
  const storedSettings = readSettings();

  // 迁移判定必须先于写 marker，否则本次会把自己当成「已跑过」；
  // 但即使没有存量设置也要把 id 记下：全新 profile 若在首启会话里显式选了「哑光」，
  // 下次启动就会形成「有存量设置 + 无 marker」，被误判成旧默认值而静默改写
  const appliedMigrationIds = readAppliedMigrationIds(migrationStorage);
  markMigrationApplied(VINYL_MATERIAL_LIGHT_MIGRATION_ID, migrationStorage);

  if (!storedSettings) return;

  try {
    const saved = storedSettings as Partial<typeof currentSettings>;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    type SavedThemeShape = Partial<typeof currentSettings.theme> & {
      enableDynamicBg?: boolean;
      dynamicBgType?: string;
      windowMaterial?: string;
    };

    const savedTheme =
      (saved.theme && typeof saved.theme === 'object' ? saved.theme : {}) as SavedThemeShape;
    const savedSidebar =
      (saved.sidebar && typeof saved.sidebar === 'object' ? saved.sidebar : {}) as Partial<typeof currentSettings.sidebar>;
    const savedCustomBackground =
      savedTheme.customBackground && typeof savedTheme.customBackground === 'object'
        ? savedTheme.customBackground
        : {} as Partial<typeof currentSettings.theme.customBackground>;
    const legacyLyricsSettingsPatch = resolveLegacyLyricsSettingsPatch(saved);

    let dynamicBgType = savedTheme.dynamicBgType;
    if (dynamicBgType === undefined && savedTheme.enableDynamicBg !== undefined) {
      dynamicBgType = savedTheme.enableDynamicBg ? 'flow' : 'none';
    }

    const savedWindowMaterial = typeof savedTheme.windowMaterial === 'string'
      && ['none', 'mica', 'acrylic', 'blur'].includes(savedTheme.windowMaterial)
      ? savedTheme.windowMaterial as typeof currentSettings.theme.windowMaterial
      : currentSettings.theme.windowMaterial;

    // 一次性迁移（见 migrations.ts）：存量设置里的旧默认材质 'matte' 迁到新默认 'light'
    const migratedMaterial = migratedVinylMaterial(savedTheme.playerDetailVinylMaterial, appliedMigrationIds);

    replaceSettings(mergeAppSettings(currentSettings, {
      ...saved,
      ...legacyLyricsSettingsPatch,
      theme: {
        ...savedTheme,
        playerDetailVinylMaterial: migratedMaterial ?? savedTheme.playerDetailVinylMaterial,
        windowMaterial: savedWindowMaterial,
        dynamicBgType:
          savedWindowMaterial !== 'none'
            ? 'none'
            : (dynamicBgType || currentSettings.theme.dynamicBgType),
        customBackground: savedCustomBackground,
      },
      sidebar: savedSidebar,
    }));
  } catch (error) {
    console.error('Failed to parse settings:', error);
  }
}
