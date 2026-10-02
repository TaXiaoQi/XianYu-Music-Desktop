import { describe, expect, it } from 'vitest'; // 实现

import source from './App.vue?raw'; // 实现

describe('App text selection behavior', () => { // 实现
  it('prevents browser text selection across the app shell by default', () => { // 实现
    expect(source).toContain('html,\nbody,\n#app'); // 实现
    expect(source).toContain('-webkit-user-select: none;'); // 实现
    expect(source).toContain('user-select: none;'); // 实现
  });

  it('keeps editable text controls selectable', () => { // 实现
    expect(source).toContain('input,\ntextarea,\n[contenteditable="true"]'); // 实现
    expect(source).toContain('-webkit-user-select: text;'); // 实现
    expect(source).toContain('user-select: text;'); // 实现
  });
});

describe('App imported lyrics fonts registration', () => { // 实现
  it('does not skip registration in the desktop lyrics window', () => { // 实现
    expect(source).not.toContain('if (!isDesktopLyricsWindow)'); // 实现
  });
});

describe('App startup version toast setting', () => {
  it('gates the welcome toast behind the persisted setting', () => {
    expect(source).toContain('if (settings.value.showWelcomeToastOnStartup)');
    expect(source).toContain("showToast(t('toast.welcome', { version }), 'info')");
  });
});
