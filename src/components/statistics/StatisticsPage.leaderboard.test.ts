import { describe, expect, it } from 'vitest';

import source from './StatisticsPage.vue?raw';

describe('StatisticsPage leaderboard sticky row', () => {
  it('renders the normal dashboard when the local library is empty', () => {
    expect(source).not.toContain('stats && stats.total_songs === 0');
    expect(source).not.toContain('先去设置中添加音乐库文件夹吧');
    expect(source).toContain('v-else-if="stats && behaviorStats"');
  });

  it('uses a translucent glass surface when a custom background image is active', () => {
    expect(source).toContain("theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)");
    expect(source).toContain("'leaderboard-row--glass-on-custom-background': hasCustomBackground");
    expect(source).toContain('.leaderboard-row.is-sticky.leaderboard-row--glass-on-custom-background');
    expect(source).toContain('background: rgba(255, 255, 255, 0.58);');
    expect(source).toContain('backdrop-filter: blur(16px) saturate(140%);');
  });

  it('reloads public and personal leaderboard state whenever login state changes', () => {
    expect(source).toContain('const isLeaderboardReady = ref(false);');
    expect(source).toContain('watch(() => authStore.isLoggedIn, (isLoggedIn, wasLoggedIn) => {');
    expect(source).toContain('if (isLoggedIn !== wasLoggedIn && isLeaderboardReady.value) {');
    expect(source).toContain('isLeaderboardReady.value = true;');
    expect(source).toContain('if (requestId !== leaderboardRequestId) return;');
  });

  it('keeps the public leaderboard visible while showing a logged-out personal row', () => {
    expect(source).not.toContain("if (!authStore.isLoggedIn) {\n    leaderboard.value = [];");
    expect(source).not.toContain('登录后可查看听歌排行榜');
    expect(source).toContain('v-else-if="!leaderboardLoading && !authStore.isLoggedIn"');
    expect(source).toContain('登录后查看个人排名');
  });

  it('opens the login page when the logged-out personal ranking row is clicked', () => {
    expect(source).toContain("const router = useRouter();");
    expect(source).toContain("void router.push('/auth');");
    expect(source).toContain('@click="openLoginPage"');
    expect(source).toContain('aria-label="前往登录页面查看个人排名"');
    expect(source).toContain('去登录');
  });
});
