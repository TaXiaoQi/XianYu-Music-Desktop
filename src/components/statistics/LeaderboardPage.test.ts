import { describe, expect, it } from 'vitest'; // 实现

import source from './LeaderboardPage.vue?raw';

describe('StatisticsPage leaderboard sticky row', () => { // 实现
  it('renders the normal dashboard when the local library is empty', () => { // 实现
    expect(source).not.toContain('stats && stats.total_songs === 0'); // 实现
    expect(source).not.toContain('先去设置中添加音乐库文件夹吧'); // 实现
    expect(source).toContain('v-else-if="stats && behaviorStats"'); // 实现
  });

  it('uses a translucent glass surface when a custom background image is active', () => { // 实现
    expect(source).toContain("theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)"); // 实现
    expect(source).toContain("'leaderboard-row--glass-on-custom-background': hasCustomBackground"); // 实现
    expect(source).toContain('.leaderboard-row.is-sticky.leaderboard-row--glass-on-custom-background'); // 实现
    expect(source).toContain('background: rgba(255, 255, 255, 0.58);'); // 实现
    expect(source).toContain('backdrop-filter: blur(16px) saturate(140%);'); // 实现
  });

  it('reloads public and personal leaderboard state whenever login state changes', () => { // 实现
    expect(source).toContain('const isLeaderboardReady = ref(false);'); // 实现
    expect(source).toContain('watch(() => authStore.isLoggedIn, (isLoggedIn, wasLoggedIn) => {'); // 实现
    expect(source).toContain('if (isLoggedIn !== wasLoggedIn && isLeaderboardReady.value) {'); // 实现
    expect(source).toContain('isLeaderboardReady.value = true;'); // 实现
    expect(source).toContain('if (requestId !== leaderboardRequestId) return;'); // 实现
  });

  it('keeps the public leaderboard visible while showing a logged-out personal row', () => { // 实现
    expect(source).not.toContain("if (!authStore.isLoggedIn) {\n    leaderboard.value = [];"); // 实现
    expect(source).not.toContain('登录后可查看听歌排行榜'); // 实现
    expect(source).toContain('v-else-if="!leaderboardLoading && !authStore.isLoggedIn"'); // 实现
    expect(source).toContain('登录后查看个人排名'); // 实现
  });

  it('opens the login page when the logged-out personal ranking row is clicked', () => { // 实现
    expect(source).toContain("const router = useRouter();"); // 实现
    expect(source).toContain("void router.push('/auth');"); // 实现
    expect(source).toContain('@click="openLoginPage"'); // 实现
    expect(source).toContain(':aria-label="TEXT.loginAria"'); // 实现
    expect(source).toContain("loginAria: 'Go to sign in and view your ranking'"); // 实现
    expect(source).toContain('去登录'); // 实现
    expect(source).toContain("goToLogin: 'Sign In'"); // 实现
  });
});
