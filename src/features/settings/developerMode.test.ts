import { describe, expect, it } from 'vitest'; // 实现

import aboutSource from '../../components/settings/SettingsAbout.vue?raw'; // 实现
import advancedSource from '../../components/settings/SettingsAdvanced.vue?raw'; // 实现
import debugSource from '../../components/settings/SettingsDebug.vue?raw'; // 实现
import logExportSource from '../../components/settings/LogExportActions.vue?raw'; // 实现
import settingsSource from '../../views/Settings.vue?raw'; // 实现
import { expectSourceContains, expectSourceNotContains } from '../../testing/sourceText';
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
    expectSourceContains(aboutSource, 'DEVELOPER_MODE_CLICK_COUNT = 5');
    expectSourceContains(aboutSource, '@click="handleDeveloperModeClick"');
    expectSourceContains(aboutSource, '@pointerdown.stop.prevent="handleDeveloperModeClick"');
    expectSourceContains(aboutSource, 'class="glass-about__version"');
    expectSourceContains(aboutSource, 'class="glass-about__facts-version"');
    expectSourceContains(aboutSource, '@pointerdown.stop.prevent="handleDeveloperModeClick"');
    expectSourceContains(aboutSource, '将音乐给予你');
    expectSourceContains(aboutSource, "showToast(isEnglish.value ? 'Developer mode enabled' : '已进入开发者模式', 'success')");
    expectSourceContains(aboutSource, '再点击 ${remaining} 次即可进入开发者模式');
  });

  it('shows Debug only in developer mode and allows exiting it', () => { // 实现
    expectSourceContains(settingsSource, "{ id: 'debug' as const, name: t('settings.debug') }");
    expectSourceContains(settingsSource, "activeTab === 'debug'");
    expectSourceContains(settingsSource, 'if (!isDeveloperMode.value) return baseTabs.value;');
    expectSourceContains(debugSource, '@click="disableDeveloperMode"');
    expectSourceContains(debugSource, '退出开发者模式');
    expectSourceContains(debugSource, '播放初始化动画');
    expectSourceContains(debugSource, '@click="triggerOnboarding"');
    expectSourceContains(advancedSource, 'showDeleteConfirmation');
    expectSourceContains(advancedSource, '确认删除全部日志');
    expectSourceContains(advancedSource, 'const entryCount = ref');
    expectSourceContains(advancedSource, "{ flush: 'post' }");
    expectSourceNotContains(advancedSource, '{ deep: true }');
  });

  it('shows advanced settings to regular users and keeps log export there', () => { // 实现
    expectSourceContains(settingsSource, "{ id: 'advanced', name: t('settings.advanced') }");
    expectSourceContains(settingsSource, "activeTab === 'advanced'");
    expectSourceContains(advancedSource, '<LogExportActions />');
    expectSourceNotContains(debugSource, '<LogExportActions />');
    expectSourceContains(logExportSource, '导出日志');
    expectSourceContains(advancedSource, '删除全部日志');
    expectSourceContains(advancedSource, '应用备份');
    expectSourceContains(advancedSource, 'showDeleteConfirmation');
    expectSourceNotContains(advancedSource, '从 BakaMusic、MusicFree 或洛雪音乐导入歌单');
    expectSourceContains(advancedSource, 'preparePluginBackupImport');
    expectSourceContains(advancedSource, '<BackupImportResultModal');
  });
});
