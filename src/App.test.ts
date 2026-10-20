import { describe, it } from 'vitest';

import source from './App.vue?raw';
import { expectSourceContains, expectSourceNotContains } from './testing/sourceText';

describe('App text selection behavior', () => {
  it('prevents browser text selection across the app shell by default', () => {
    expectSourceContains(source, 'html,\nbody,\n#app');
    expectSourceContains(source, '-webkit-user-select: none;');
    expectSourceContains(source, 'user-select: none;');
  });

  it('keeps editable text controls selectable', () => {
    expectSourceContains(source, 'input,\ntextarea,\n[contenteditable="true"]');
    expectSourceContains(source, '-webkit-user-select: text;');
    expectSourceContains(source, 'user-select: text;');
  });
});

describe('App imported lyrics fonts registration', () => {
  it('does not skip registration in the desktop lyrics window', () => {
    expectSourceNotContains(source, 'if (!isDesktopLyricsWindow)');
  });
});

describe('App startup version toast setting', () => {
  it('gates the welcome toast behind the persisted setting', () => {
    expectSourceContains(source, 'if (settings.value.showWelcomeToastOnStartup)');
    expectSourceContains(source, "showToast(t('toast.welcome', { version }), 'info')");
  });
});
