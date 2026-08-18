import { describe, expect, it, vi } from 'vitest';

import { translate, resolveLanguage } from './index';

describe('i18n', () => {
  it('translates interface text and interpolates parameters', () => {
    expect(translate('zh-CN', 'settings.general')).toBe('常规');
    expect(translate('en-US', 'settings.general')).toBe('General');
    expect(translate('en-US', 'settings.results', { count: 3 })).toBe('3 settings found');
  });

  it('resolves "system" to a supported language based on navigator.language', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(resolveLanguage('system')).toBe('en-US');
    expect(translate('system', 'settings.general')).toBe('General');

    vi.stubGlobal('navigator', { language: 'zh-TW' });
    expect(resolveLanguage('system')).toBe('zh-TW');

    vi.stubGlobal('navigator', { language: 'zh-CN' });
    expect(resolveLanguage('system')).toBe('zh-CN');

    vi.stubGlobal('navigator', { language: 'ja-JP' });
    expect(resolveLanguage('system')).toBe('zh-CN');

    vi.unstubAllGlobals();
  });
});
