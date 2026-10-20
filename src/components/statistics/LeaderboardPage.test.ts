import { describe, it } from 'vitest';

import source from './LeaderboardPage.vue?raw';
import { expectSourceContains, expectSourceNotContains } from '../../testing/sourceText';

describe('StatisticsPage leaderboard sticky row', () => {
  it('renders the normal dashboard when the local library is empty', () => {
    expectSourceNotContains(source, 'stats && stats.total_songs === 0');
    expectSourceNotContains(source, '先去设置中添加音乐库文件夹吧');
    expectSourceContains(source, 'v-else-if="stats && behaviorStats"');
  });

  it('uses a translucent glass surface when a custom background image is active', () => {
    expectSourceContains(source, "theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)");
    expectSourceContains(source, "'leaderboard-row--glass-on-custom-background': hasCustomBackground");
    expectSourceContains(source, '.leaderboard-row.is-sticky.leaderboard-row--glass-on-custom-background');
    expectSourceContains(source, 'background: rgba(255, 255, 255, 0.58);');
    expectSourceContains(source, 'backdrop-filter: blur(16px) saturate(140%);');
  });

  it('reloads public and personal leaderboard state whenever login state changes', () => {
    expectSourceContains(source, 'const isLeaderboardReady = ref(false);');
    expectSourceContains(source, 'watch(() => authStore.isLoggedIn, (isLoggedIn, wasLoggedIn) => {');
    expectSourceContains(source, 'if (isLoggedIn !== wasLoggedIn && isLeaderboardReady.value) {');
    expectSourceContains(source, 'isLeaderboardReady.value = true;');
    expectSourceContains(source, 'if (requestId !== leaderboardRequestId) return;');
  });

  it('keeps the public leaderboard visible while showing a logged-out personal row', () => {
    expectSourceNotContains(source, "if (!authStore.isLoggedIn) {\n    leaderboard.value = [];");
    expectSourceNotContains(source, '登录后可查看听歌排行榜');
    expectSourceContains(source, 'v-else-if="!leaderboardLoading && !authStore.isLoggedIn"');
    expectSourceContains(source, '登录后查看个人排名');
  });

  it('opens the login page when the logged-out personal ranking row is clicked', () => {
    expectSourceContains(source, "const router = useRouter();");
    expectSourceContains(source, "void router.push('/auth');");
    expectSourceContains(source, '@click="openLoginPage"');
    expectSourceContains(source, ':aria-label="TEXT.loginAria"');
    expectSourceContains(source, "loginAria: 'Go to sign in and view your ranking'");
    expectSourceContains(source, '去登录');
    expectSourceContains(source, "goToLogin: 'Sign In'");
  });
});
