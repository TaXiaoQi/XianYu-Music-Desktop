import { describe, expect, it } from 'vitest';

import { translate } from './index';

describe('i18n', () => {
  it('translates interface text and interpolates parameters', () => {
    expect(translate('zh-CN', 'settings.general')).toBe('常规');
    expect(translate('en-US', 'settings.general')).toBe('General');
    expect(translate('en-US', 'settings.results', { count: 3 })).toBe('3 settings found');
  });
});
