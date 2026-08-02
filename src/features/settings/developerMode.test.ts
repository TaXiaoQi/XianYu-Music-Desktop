import { describe, expect, it } from 'vitest';

import aboutSource from '../../components/settings/SettingsAbout.vue?raw';
import debugSource from '../../components/settings/SettingsDebug.vue?raw';
import settingsSource from '../../views/Settings.vue?raw';
import { disableDeveloperMode, enableDeveloperMode, useDeveloperMode } from './developerMode';

describe('developer mode settings entry', () => {
  it('persists a shared developer mode state', () => {
    disableDeveloperMode();
    expect(useDeveloperMode().isDeveloperMode.value).toBe(false);
    enableDeveloperMode();
    expect(useDeveloperMode().isDeveloperMode.value).toBe(true);
    disableDeveloperMode();
  });

  it('requires five consecutive clicks on the about-page phrase', () => {
    expect(aboutSource).toContain('DEVELOPER_MODE_CLICK_COUNT = 5');
    expect(aboutSource).toContain('@click="handleDeveloperModeClick"');
    expect(aboutSource).toContain('将音乐给予你');
    expect(aboutSource).toContain("showToast('已进入开发者模式', 'success')");
  });

  it('shows Debug only in developer mode and allows exiting it', () => {
    expect(settingsSource).toContain("{ id: 'debug' as const, name: '调试' }");
    expect(settingsSource).toContain("activeTab === 'debug'");
    expect(settingsSource).toContain('if (!isDeveloperMode.value) return baseTabs;');
    expect(debugSource).toContain('@click="disableDeveloperMode"');
    expect(debugSource).toContain('退出开发者模式');
    expect(debugSource).toContain('播放初始化动画');
    expect(debugSource).toContain('@click="triggerOnboarding"');
  });
});
