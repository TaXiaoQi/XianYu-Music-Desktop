import { describe, it } from 'vitest'; // 实现

import source from './App.vue?raw'; // 实现
import { expectSourceContains, expectSourceNotContains } from './testing/sourceText';

describe('App text selection behavior', () => { // 实现
  it('prevents browser text selection across the app shell by default', () => { // 实现
    expectSourceContains(source, 'html,\nbody,\n#app'); // 实现
    expectSourceContains(source, '-webkit-user-select: none;'); // 实现
    expectSourceContains(source, 'user-select: none;'); // 实现
  });

  it('keeps editable text controls selectable', () => { // 实现
    expectSourceContains(source, 'input,\ntextarea,\n[contenteditable="true"]'); // 实现
    expectSourceContains(source, '-webkit-user-select: text;'); // 实现
    expectSourceContains(source, 'user-select: text;'); // 实现
  });
});

describe('App imported lyrics fonts registration', () => { // 实现
  it('does not skip registration in the desktop lyrics window', () => { // 实现
    expectSourceNotContains(source, 'if (!isDesktopLyricsWindow)'); // 实现
  });
});

describe('App startup version toast setting', () => {
  it('gates the welcome toast behind the persisted setting', () => {
    expectSourceContains(source, 'if (settings.value.showWelcomeToastOnStartup)');
    expectSourceContains(source, "showToast(t('toast.welcome', { version }), 'info')");
  });
});
