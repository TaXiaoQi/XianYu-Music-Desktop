import { describe, expect, it } from 'vitest';

import source from './StatisticsPage.vue?raw';

describe('StatisticsPage leaderboard sticky row', () => {
  it('uses a translucent glass surface when a custom background image is active', () => {
    expect(source).toContain("theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)");
    expect(source).toContain("'leaderboard-row--glass-on-custom-background': hasCustomBackground");
    expect(source).toContain('.leaderboard-row.is-sticky.leaderboard-row--glass-on-custom-background');
    expect(source).toContain('background: rgba(255, 255, 255, 0.58);');
    expect(source).toContain('backdrop-filter: blur(16px) saturate(140%);');
  });

  it('retries loading after the asynchronously restored login state becomes available', () => {
    expect(source).toContain('const isLeaderboardReady = ref(false);');
    expect(source).toContain('watch(() => authStore.isLoggedIn, (isLoggedIn, wasLoggedIn) => {');
    expect(source).toContain('if (isLoggedIn && !wasLoggedIn && isLeaderboardReady.value) {');
    expect(source).toContain('isLeaderboardReady.value = true;');
  });
});
