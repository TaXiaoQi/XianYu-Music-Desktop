import { describe, expect, it } from 'vitest'; // 实现

import aboutSource from '../../components/settings/SettingsAbout.vue?raw'; // 实现
import advancedSource from '../../components/settings/SettingsAdvanced.vue?raw'; // 实现
import debugSource from '../../components/settings/SettingsDebug.vue?raw'; // 实现
import logExportSource from '../../components/settings/LogExportActions.vue?raw'; // 实现
import settingsSource from '../../views/Settings.vue?raw'; // 实现
import { disableDeveloperMode, enableDeveloperMode, useDeveloperMode } from './developerMode'; // 实现

describe('developer mode settings entry', () => { // 实现
  it('persists a shared developer mode state', () => { // 实现
    disableDeveloperMode(); // 实现
    expect(useDeveloperMode().isDeveloperMode.value).toBe(false); // 实现
    enableDeveloperMode(); // 实现
    expect(useDeveloperMode().isDeveloperMode.value).toBe(true); // 实现
    disableDeveloperMode(); // 实现
  });

  it('requires five consecutive clicks on the about-page version number', () => {
    expect(aboutSource).toContain('DEVELOPER_MODE_CLICK_COUNT = 5');
    expect(aboutSource).toContain('@click="handleDeveloperModeClick"'); // 实现
    expect(aboutSource).toContain('@pointerdown.stop.prevent="handleDeveloperModeClick"');
    expect(aboutSource).toContain('class="glass-about__version"');
    expect(aboutSource).toContain('class="glass-about__facts-version"');
    expect(aboutSource).toContain('@pointerdown.stop.prevent="handleDeveloperModeClick"');
    expect(aboutSource).toContain('将音乐给予你'); // 实现
    expect(aboutSource).toContain("showToast(isEnglish.value ? 'Developer mode enabled' : '已进入开发者模式', 'success')");
    expect(aboutSource).toContain('再点击 ${remaining} 次即可进入开发者模式');
  });

  it('shows Debug only in developer mode and allows exiting it', () => { // 实现
    expect(settingsSource).toContain("{ id: 'debug' as const, name: t('settings.debug') }");
    expect(settingsSource).toContain("activeTab === 'debug'"); // 实现
    expect(settingsSource).toContain('if (!isDeveloperMode.value) return baseTabs.value;');
    expect(debugSource).toContain('@click="disableDeveloperMode"'); // 实现
    expect(debugSource).toContain('退出开发者模式'); // 实现
    expect(debugSource).toContain('播放初始化动画'); // 实现
    expect(debugSource).toContain('@click="triggerOnboarding"'); // 实现
    expect(advancedSource).toContain('showDeleteConfirmation'); // 实现
    expect(advancedSource).toContain('确认删除全部日志');
    expect(advancedSource).toContain('const entryCount = ref');
    expect(advancedSource).toContain("{ flush: 'post' }");
    expect(advancedSource).not.toContain('{ deep: true }');
  });

  it('shows advanced settings to regular users and keeps log export there', () => { // 实现
    expect(settingsSource).toContain("{ id: 'advanced', name: t('settings.advanced') }");
    expect(settingsSource).toContain("activeTab === 'advanced'"); // 实现
    expect(advancedSource).toContain('<LogExportActions />'); // 实现
    expect(debugSource).not.toContain('<LogExportActions />');
    expect(logExportSource).toContain('导出日志');
    expect(advancedSource).toContain('删除全部日志'); // 实现
    expect(advancedSource).toContain('应用备份');
    expect(advancedSource).toContain('showDeleteConfirmation'); // 实现
    expect(advancedSource).not.toContain('从 BakaMusic、MusicFree 或洛雪音乐导入歌单');
    expect(advancedSource).toContain('preparePluginBackupImport');
    expect(advancedSource).toContain('<BackupImportResultModal'); // 实现
  });
});
