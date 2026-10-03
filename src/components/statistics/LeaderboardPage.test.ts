import { describe, it } from 'vitest'; // 实现

import source from './LeaderboardPage.vue?raw';
import { expectSourceContains, expectSourceNotContains } from '../../testing/sourceText';

describe('StatisticsPage leaderboard sticky row', () => { // 实现
  it('renders the normal dashboard when the local library is empty', () => { // 实现
    expectSourceNotContains(source, 'stats && stats.total_songs === 0'); // 实现
    expectSourceNotContains(source, '先去设置中添加音乐库文件夹吧'); // 实现
    expectSourceContains(source, 'v-else-if="stats && behaviorStats"'); // 实现
  });

  it('uses a translucent glass surface when a custom background image is active', () => { // 实现
    expectSourceContains(source, "theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)"); // 实现
    expectSourceContains(source, "'leaderboard-row--glass-on-custom-background': hasCustomBackground"); // 实现
    expectSourceContains(source, '.leaderboard-row.is-sticky.leaderboard-row--glass-on-custom-background'); // 实现
    expectSourceContains(source, 'background: rgba(255, 255, 255, 0.58);'); // 实现
    expectSourceContains(source, 'backdrop-filter: blur(16px) saturate(140%);'); // 实现
  });

  it('reloads public and personal leaderboard state whenever login state changes', () => { // 实现
    expectSourceContains(source, 'const isLeaderboardReady = ref(false);'); // 实现
    expectSourceContains(source, 'watch(() => authStore.isLoggedIn, (isLoggedIn, wasLoggedIn) => {'); // 实现
    expectSourceContains(source, 'if (isLoggedIn !== wasLoggedIn && isLeaderboardReady.value) {'); // 实现
    expectSourceContains(source, 'isLeaderboardReady.value = true;'); // 实现
    expectSourceContains(source, 'if (requestId !== leaderboardRequestId) return;'); // 实现
  });

  it('keeps the public leaderboard visible while showing a logged-out personal row', () => { // 实现
    expectSourceNotContains(source, "if (!authStore.isLoggedIn) {\n    leaderboard.value = [];"); // 实现
    expectSourceNotContains(source, '登录后可查看听歌排行榜'); // 实现
    expectSourceContains(source, 'v-else-if="!leaderboardLoading && !authStore.isLoggedIn"'); // 实现
    expectSourceContains(source, '登录后查看个人排名'); // 实现
  });

  it('opens the login page when the logged-out personal ranking row is clicked', () => { // 实现
    expectSourceContains(source, "const router = useRouter();"); // 实现
    expectSourceContains(source, "void router.push('/auth');"); // 实现
    expectSourceContains(source, '@click="openLoginPage"'); // 实现
    expectSourceContains(source, ':aria-label="TEXT.loginAria"'); // 实现
    expectSourceContains(source, "loginAria: 'Go to sign in and view your ranking'"); // 实现
    expectSourceContains(source, '去登录'); // 实现
    expectSourceContains(source, "goToLogin: 'Sign In'"); // 实现
  });
});
