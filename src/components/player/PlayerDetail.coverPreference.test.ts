import { describe, expect, it } from 'vitest';

import playerDetailSource from './PlayerDetail.vue?raw';

describe('player detail cover preference', () => {
  it('supports forced and remembered cover behavior while restoring the footer cover on close', () => {
    expect(playerDetailSource).toContain("playerDetailCoverBehavior === 'hide'");
    expect(playerDetailSource).toContain("playerDetailCoverBehavior === 'remember' && !lastPlayerDetailCoverVisible");
    expect(playerDetailSource).toContain('coverHidden.value = false;');
  });

  it('persists the in-page toggle as the last cover choice', () => {
    expect(playerDetailSource).toContain('coverHidden.value = !coverHidden.value;');
    expect(playerDetailSource).toContain('patchTheme({ lastPlayerDetailCoverVisible: !coverHidden.value });');
    expect(playerDetailSource).toContain('@toggle-cover="handleToggleCover"');
  });
});
