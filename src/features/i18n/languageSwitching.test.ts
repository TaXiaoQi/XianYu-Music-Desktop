import { describe, expect, it } from 'vitest';

import appSource from '../../App.vue?raw';
import settingsGeneralSource from '../../components/settings/SettingsGeneral.vue?raw';

describe('language switching reliability', () => {
  it('switches the active interface language without reloading the page', () => {
    expect(appSource).not.toContain('previousLanguage');
    expect(appSource).not.toContain('window.location.reload()');
    expect(appSource).toContain('document.documentElement.dataset.language = value');
  });

  it('recreates the rendered interface so legacy DOM translations cannot leak across languages', () => {
    expect(appSource).toContain('<MainShell v-else :key="language"');
    expect(appSource).toContain('<DesktopLyricsWindow v-if="isDesktopLyricsWindow" :key="language"');
    expect(appSource).toContain('<MiniPlayerWindow v-else-if="isMiniPlayerWindow" :key="language"');
  });

  it('persists a manual language choice synchronously', () => {
    expect(settingsGeneralSource).toContain('patchSettings({ language: value })');
    expect(settingsGeneralSource).toContain('playerStorage.writeSettings(settings.value)');
  });

  it('does not let a delayed installer read overwrite a manual choice', () => {
    expect(appSource).toContain('const languageBeforeInstallRead = settings.value.language');
    expect(appSource).toContain('settings.value.language === languageBeforeInstallRead');
    expect(appSource).toContain('settings.value.language !== languageBeforeInstallRead');
  });
});
