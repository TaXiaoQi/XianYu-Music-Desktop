import { describe, expect, it } from 'vitest';

import aboutSource from '../../components/settings/SettingsAbout.vue?raw';
import advancedSource from '../../components/settings/SettingsAdvanced.vue?raw';
import debugSource from '../../components/settings/SettingsDebug.vue?raw';
import logExportSource from '../../components/settings/LogExportActions.vue?raw';
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
    expect(debugSource).toContain('showClearConfirmation');
    expect(debugSource).toContain('确认清空全部日志');
    expect(debugSource).toContain('const entryCount = computed');
    expect(debugSource).toContain("{ flush: 'post' }");
    expect(debugSource).not.toContain('{ deep: true }');
  });

  it('shows advanced settings to regular users and keeps log export there', () => {
    expect(settingsSource).toContain("{ id: 'advanced', name: '高级设置' }");
    expect(settingsSource).toContain("activeTab === 'advanced'");
    expect(advancedSource).toContain('<LogExportActions />');
    expect(debugSource).toContain('<LogExportActions />');
    expect(logExportSource).toContain('导出全部日志');
    expect(logExportSource).toContain('导出错误日志');
    expect(advancedSource).toContain('删除全部日志');
    expect(advancedSource).toContain('应用备份');
    expect(advancedSource).toContain('showDeleteConfirmation');
    expect(advancedSource).toContain('从 BakaMusic 或 MusicFree 软件导入歌单');
    expect(advancedSource).toContain('preparePluginBackupFile');
    expect(advancedSource).toContain('<BackupImportResultModal');
  });
});
